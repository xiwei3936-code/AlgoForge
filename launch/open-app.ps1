# 等本地服务就绪后，用 Chromium 系浏览器的「应用模式」打开（无地址栏，像桌面应用）
# 由 start-hot100.ps1 在后台隐藏调用。
param(
    [string]$Url = 'http://localhost:5178/',
    [int]$TimeoutSec = 70,
    [int]$ParentPid = 0          # 发起者 PID：它一消失（用户关了服务窗口）本脚本立即退出
)

$logDir = Join-Path $env:LOCALAPPDATA 'Hot100Trainer'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$log = Join-Path $logDir 'opener.log'
function Write-Log([string]$m) {
    try { Add-Content -LiteralPath $log -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -Encoding UTF8 } catch { }
}

function Get-BrowserExe {
    # 优先跟随系统默认浏览器，其次 Chrome，再次 Edge
    $prog = ''
    $k = 'HKCU:\SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice'
    if (Test-Path -LiteralPath $k) { $prog = (Get-ItemProperty $k -ErrorAction SilentlyContinue).ProgId }

    $order = if ($prog -match 'Chrome') { @('chrome.exe', 'msedge.exe') }
             elseif ($prog -match 'MSEdge') { @('msedge.exe', 'chrome.exe') }
             else { @('chrome.exe', 'msedge.exe') }

    foreach ($exe in $order) {
        # App Paths 注册表最可靠（不受安装目录影响）
        foreach ($hive in @('HKLM:', 'HKCU:')) {
            $p = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe"
            if (Test-Path -LiteralPath $p) {
                $path = (Get-ItemProperty $p -ErrorAction SilentlyContinue).'(default)'
                if ($path -and (Test-Path -LiteralPath $path)) { return $path }
            }
        }
        # 退回到常见安装位置（含 Program Files (x86) 与用户目录）
        $subs = @{ 'chrome.exe' = 'Google\Chrome\Application\chrome.exe'; 'msedge.exe' = 'Microsoft\Edge\Application\msedge.exe' }
        foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
            if (-not $base) { continue }
            $cand = Join-Path $base $subs[$exe]
            if (Test-Path -LiteralPath $cand) { return $cand }
        }
    }
    return $null
}

# ══════════ 快路径：不等服务，立刻用本地动画页开窗 ══════════
# 以前这里是「等服务就绪 -> 再开窗」，于是启动动画只能在所有事情干完之后才开始，
# 人要对着空白干等 4~5 秒。现在先把窗口开出来（指向 launch\boot.html，
# 一个**不需要服务器**的本地文件），动画和「起服务」并行跑；
# boot.html 自己探测服务、自己跳转、服务起不来时自己给人话。
#
# ⚠ URL 必须用 [System.Uri].AbsoluteUri 做百分号编码：包的目录名就是
#   「AlgoForge v2.0.0」，含空格和中文，解压时还常见 (1) 这种右括号。
#   编码之后参数里**没有空格**，正好绕开本项目栽过两次的
#   「Start-Process -ArgumentList 不给含空格元素加引号」那个坑。
#   真机验过：带空格+中文+右括号的路径，Chrome 收到的命令行原样正确，
#   而且从 file:// 跳到 http:// 是**同窗跳转、仍是应用模式**（标题没有浏览器后缀）。
#
# 任何一步不成立（没有 Chromium / 没有 boot.html / 开窗抛异常）都退回下面的老流程，
# 那条路已经用了很久，是可靠的兜底。
$bootPage = Join-Path $PSScriptRoot 'boot.html'
$fastExe = Get-BrowserExe
if ($fastExe -and (Test-Path -LiteralPath $bootPage)) {
    try {
        $bootUrl = (New-Object System.Uri($bootPage)).AbsoluteUri
        $profileDir = Join-Path $env:LOCALAPPDATA 'Hot100Trainer\browser-profile'
        Write-Log "先开启动动画页（不等服务）：$bootUrl"
        Start-Process $fastExe -ArgumentList @(
            "--app=$bootUrl",
            "--user-data-dir=`"$profileDir`"",
            '--window-size=1560,980',
            '--no-first-run',
            '--no-default-browser-check'
        )
        exit 0
    } catch {
        Write-Log "启动动画页开窗失败，回退到老流程：$($_.Exception.Message)"
    }
} else {
    Write-Log '没有可用的 Chromium 或缺少 boot.html，走「等服务就绪再打开」的老流程'
}

# 等多久：只要**发起者还活着**就接着等。
# 固定 70 秒是不对的 —— 控制台模式下本脚本是在服务开始启动之前就被发起的，
# 首次运行还要先 npm install + 打包，几分钟很正常。发起者一旦退出，下面的循环立刻收工。
# 硬上限只用来防止发起者变僵尸时这个进程永远挂着。
$HardCeilingSec = 900
$limitSec = $TimeoutSec
if ($ParentPid -gt 0) { $limitSec = $HardCeilingSec }
$startedAt = (Get-Date)
$deadline = $startedAt.AddSeconds($limitSec)
$ticks = 0
while ((Get-Date) -lt $deadline) {
    # 发起者已经退出（用户关掉了服务窗口）→ 不要过一会儿再凭空弹窗
    if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
        Write-Log '发起进程已退出，opener 结束'
        exit 1
    }
    $ready = $false
    try {
        $ready = ((Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200)
    } catch {
        # 拿到任何 HTTP 响应都说明服务已经在听（404/500 也算起来了）
        if ($_.Exception.Response) { $ready = $true }
    }
    if ($ready) {
        $exe = Get-BrowserExe
        if ($exe) {
            # --app 去掉地址栏/标签栏；独立 user-data-dir 让它有自己的窗口与任务栏图标
            $profileDir = Join-Path $env:LOCALAPPDATA 'Hot100Trainer\browser-profile'
            Write-Log "用应用模式打开：$exe"
            Start-Process $exe -ArgumentList @(
                "--app=$Url",
                "--user-data-dir=`"$profileDir`"",
                '--window-size=1560,980',
                '--no-first-run',
                '--no-default-browser-check'
            )
        } else {
            Write-Log '没找到 Chrome/Edge，退回系统默认浏览器'
            Start-Process $Url
        }
        exit 0
    }
    Start-Sleep -Milliseconds 600
    $ticks++
    if ($ticks % 50 -eq 0) { Write-Log ("已等待约 {0} 秒，服务仍未就绪（首次运行要装依赖+打包，属正常）" -f [int]($ticks * 0.6)) }
}

# 等到头还是没起来：**绝不**去打开这个地址。
# 刚刚连续探测了这么久都连不上，打开只会得到一个"无法访问此网站"的页面，
# 看上去像是应用本身坏了 —— 这比什么都不做更糟。
# 改成把「发生了什么、日志在哪、怎么重试」说清楚。
$elapsed = [int]((Get-Date) - $startedAt).TotalSeconds
Write-Log "等待 $elapsed 秒仍未就绪，放弃打开（不去打开一个必然连不上的地址）"
$msg = @"
本地服务在 $elapsed 秒内没有起来，界面就不打开了 ——
现在打开也只会显示"无法访问此网站"，反而像是应用坏了。

可以按顺序查这几个日志：
  1. 服务输出：$(Join-Path $logDir 'server.log')
  2. 启动过程：$(Join-Path $logDir 'launcher.log')
  3. 首次运行还有：$(Join-Path $logDir 'npm-install.log')
                   $(Join-Path $logDir 'npm-build.log')

服务确实起来之后，再双击一次桌面的「AlgoForge」即可；
也可以手动在浏览器打开：$Url
"@
try { (New-Object -ComObject WScript.Shell).Popup($msg, 0, 'AlgoForge — 界面没能打开', 48) | Out-Null }
catch { Write-Host $msg }
exit 1
