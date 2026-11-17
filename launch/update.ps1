# AlgoForge —— 一键更新界面
#
# 给收到「Hot100 更新包 vX.Y.Z.zip」的人用：把 zip 存到程序文件夹里，双击「更新.cmd」即可。
# （也可以把 zip 直接拖到「更新.cmd」上。）
#
# 它做这几件事，每一步都在屏幕上说清楚：
#   1. 找到更新包（参数 -> 程序目录 -> 桌面 -> 下载 文件夹，取最新的一个）
#   2. 校验：是不是本程序的更新包、内容完整不完整、**配的是不是这一版服务端**
#   3. 优雅关掉正在运行的程序（关窗口会先把编辑器里没落盘的击键写进去，和你手动关窗口是同一条路）
#   4. 备份现有 dist -> 换上新的 -> 校验 -> 有任何问题就整份回滚
#   5. 重新启动
#
# 数据（代码 / 笔记 / 进度 / 配图）不在程序文件夹里，全程不会被碰到。

param(
    [Parameter(Position = 0)][string]$Package = '',
    # 程序用的端口。**平时不要传**，默认值就是对的。
    # 之所以做成参数：自动化测试要在一个空闲端口上验这套替换/回滚逻辑，
    # 而不能去碰真正在跑的那一份（端口写死的话，测试会把使用者的程序关掉）。
    [int]$Port = 5178
)

$ErrorActionPreference = 'Stop'

$port       = $Port
$launchDir  = $PSScriptRoot
$root       = Split-Path -Parent $launchDir
$logDir     = Join-Path $env:LOCALAPPDATA 'Hot100Trainer'
$profileDir = Join-Path $logDir 'browser-profile'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$logPath = Join-Path $logDir 'launcher.log'

function Write-Log([string]$m) {
    try { Add-Content -LiteralPath $logPath -Value ("[{0}] update: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding UTF8 } catch { }
}
function Say([string]$m, [string]$c = 'Gray') { Write-Host "  $m" -ForegroundColor $c }
function Step([string]$m) { Write-Host ''; Write-Host "  $m" -ForegroundColor Cyan }
function Die([string]$what, [string[]]$how) {
    Write-Log "失败：$what"
    Write-Host ''
    Write-Host "  更新没有进行：$what" -ForegroundColor Red
    Write-Host ''
    foreach ($l in $how) { Write-Host "  $l" -ForegroundColor Yellow }
    Write-Host ''
    Write-Host '  你的程序没有被改动，还是原来那一版，可以照常使用。' -ForegroundColor DarkGray
    Write-Host ''
    exit 1
}

Write-Host ''
Write-Host '  AlgoForge —— 一键更新' -ForegroundColor Cyan
Write-Host '  ============================================'
Say "程序目录：$root"

# ---------- 0. 这个目录是不是一份完整的程序 ----------
foreach ($p in @('dist\index.html', 'vite.config.js', 'server\java-runner.mjs', 'launch\start-hot100.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $p))) {
        Die "这里不像是 Hot100 的程序目录（缺 $p）" @(
            '请把「更新.cmd」放在程序文件夹的根目录里再双击。'
            "当前找的是：$root"
        )
    }
}

# ---------- 1. 找更新包 ----------
Step '[1/5] 找更新包…'
if ($Package -and -not (Test-Path -LiteralPath $Package)) {
    Die "指定的文件不存在：$Package" @('把更新包的 zip 拖到「更新.cmd」上，或者直接双击「更新.cmd」让它自己找。')
}
if (-not $Package) {
    $dirs = @($root, [Environment]::GetFolderPath('Desktop'), (Join-Path $env:USERPROFILE 'Downloads'))
    $cands = @()
    foreach ($d in $dirs) {
        if (-not (Test-Path -LiteralPath $d)) { continue }
        $cands += @(Get-ChildItem -LiteralPath $d -Filter '*.zip' -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*更新包*' })
    }
    $cands = @($cands | Sort-Object LastWriteTime -Descending)
    if ($cands.Count -eq 0) {
        Die '没找到更新包' @(
            '请先把对方发给你的「Hot100 更新包 vX.Y.Z.zip」保存下来，然后：'
            '  · 把它拖到「更新.cmd」上；或者'
            '  · 把它放进下面任一个文件夹，再双击「更新.cmd」：'
            "      $root"
            "      $([Environment]::GetFolderPath('Desktop'))"
            "      $(Join-Path $env:USERPROFILE 'Downloads')"
            ''
            '注意：要保存的是 .zip 文件本身，不要先解压。'
        )
    }
    $Package = $cands[0].FullName
    if ($cands.Count -gt 1) {
        Say "找到 $($cands.Count) 个更新包，用最新的那个：" 'Yellow'
        foreach ($c in $cands | Select-Object -First 4) { Say ("   {0}  {1:yyyy-MM-dd HH:mm}" -f $c.Name, $c.LastWriteTime) }
    }
}
$Package = (Resolve-Path -LiteralPath $Package).Path
Say "更新包：$Package" 'Green'
Say ("大小：{0:N1} MB" -f ((Get-Item -LiteralPath $Package).Length / 1MB))

# ---------- 2. 解压到临时目录并校验 ----------
Step '[2/5] 检查更新包…'
$work = Join-Path $root ('.update-tmp-' + (Get-Date -Format 'yyyyMMddHHmmss'))
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null

$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path -LiteralPath $tar)) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Die '系统里没有 tar.exe（Windows 10 1803 以上自带）' @('请把 zip 手动解压后，把里面的 dist 文件夹覆盖到程序目录里。')
}
# ⚠ 这里**刻意不用** `& $tar ... 2>&1`。
# PowerShell 5.1 会把原生程序写到 stderr 的每一行包成 ErrorRecord(NativeCommandError)：
#   · 在 $ErrorActionPreference='Stop' 下会**直接抛异常**，绕过下面写好的中文提示
#     （实测喂一个截断的 zip：使用者看到的是一大段 PowerShell 报错，而不是"包坏了，让对方重发"）；
#   · 就算降成 Continue，每行还会被加上「所在位置 …update.ps1:119 字符: 12」和一串波浪线，
#     对零基础的人纯粹是噪音。
# 改用 Start-Process 把 stdout/stderr 直接重定向到文件：拿到的是干净的原文，
# 而且 ExitCode 也是程序自己的。技术细节只写进日志，屏幕上只给人话。
# （-ArgumentList 不会替你加引号，所以每个含空格的参数都自己包好 —— 这是本项目踩过的坑。）
$tarErr = Join-Path $env:TEMP ('hot100-tar-' + [Guid]::NewGuid().ToString('N') + '.err.txt')
$tarStd = Join-Path $env:TEMP ('hot100-tar-' + [Guid]::NewGuid().ToString('N') + '.out.txt')
$tarProc = Start-Process -FilePath $tar `
    -ArgumentList @('-xf', "`"$Package`"", '-C', "`"$work`"") `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardError $tarErr -RedirectStandardOutput $tarStd
$tarCode = $tarProc.ExitCode
$tarOut = ''
try { if (Test-Path -LiteralPath $tarErr) { $tarOut = (Get-Content -LiteralPath $tarErr -Raw -ErrorAction SilentlyContinue) } } catch { }
Remove-Item -LiteralPath $tarErr, $tarStd -Force -ErrorAction SilentlyContinue

if ($tarCode -ne 0) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    if ($tarOut) { Write-Log ("解压失败，tar 输出：" + ($tarOut -replace "`r?`n", ' | ')) }
    Die '这个 zip 解压失败' @(
        '文件多半是在传输中损坏了、或者没下载完 —— 请让对方重新发一次。'
        ''
        '（如果是从聊天软件里点开的，注意要先"另存为"把文件保存下来，'
        '  再双击「更新.cmd」，不要在压缩软件的预览窗口里直接操作。）'
        ''
        "技术细节已记到日志：$logPath"
    )
}

# 包里应当只有一个顶层目录
$top = @(Get-ChildItem -LiteralPath $work -Directory)
if ($top.Count -ne 1) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Die "这个 zip 里有 $($top.Count) 个顶层文件夹，不像是本程序的更新包" @('确认一下对方发的是不是「Hot100 更新包 vX.Y.Z.zip」。')
}
$src = $top[0].FullName
$manifestPath = Join-Path $src '更新包信息.json'
$newDist = Join-Path $src 'dist'

if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $newDist)) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Die '这不是本程序的界面更新包' @(
        '里面既要有 dist 文件夹，也要有「更新包信息.json」。'
        '如果对方发给你的是**整包**（一百多 MB、里面有 runtime 文件夹），那不用走这个脚本：'
        '解压到一个新文件夹 -> ★先把这里的 backup 文件夹整个拷过去★ -> 双击「开始使用.cmd」。'
        '（backup 里是你的全部存档，整包更新不会自动带走它。）'
    )
}
$mf = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($mf.kind -ne 'hot100-dist-update') {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Die "更新包类型不对（$($mf.kind)）" @('确认一下对方发的是不是本程序的界面更新包。')
}
Say "新版本：v$($mf.appVersion)（$($mf.buildDate) 构建）" 'Green'

# 完整性：文件数与总字节数
$got = @(Get-ChildItem -LiteralPath $newDist -Recurse -File)
$gotBytes = ($got | Measure-Object -Property Length -Sum).Sum
if ($got.Count -ne $mf.files -or $gotBytes -ne $mf.bytes) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Die '更新包内容不完整' @(
        "应有 $($mf.files) 个文件 / $($mf.bytes) 字节，实际 $($got.Count) 个 / $gotBytes 字节。"
        '多半是传输中断或没下载完，请让对方重新发一次。'
    )
}
Say "内容完整（$($got.Count) 个文件）" 'Green'

# ---------- 服务端指纹：这份 dist 配的是不是我这一版服务端 ----------
# 算法必须与 scripts/package-lib.mjs 的 fingerprintFiles 完全一致：
# 每个文件一行 `<正斜杠相对路径> <sha256小写>`，按**序数序**排序，用 \n 连接，再对这段 UTF-8 文本算 sha256。
# （Sort-Object 默认按区域文化排序，与 JS 不一定一致，所以这里显式用 Ordinal 比较器。）
function Get-Fingerprint([string]$base, [string[]]$rel) {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($r in $rel) {
        $full = Join-Path $base $r
        $h = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
        $lines.Add(($r -replace '\\', '/') + ' ' + $h)
    }
    $arr = $lines.ToArray()
    [Array]::Sort($arr, [StringComparer]::Ordinal)
    $text = [string]::Join("`n", $arr)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) }
    finally { $sha.Dispose() }
}

$serverRel = @()
$serverRel += @(Get-ChildItem -LiteralPath (Join-Path $root 'server') -Recurse -File |
    ForEach-Object { 'server\' + $_.FullName.Substring((Join-Path $root 'server').Length + 1) })
$serverRel += 'vite.config.js'
$localFp = Get-Fingerprint $root $serverRel

if ($mf.serverFingerprint -and $mf.serverFingerprint -ne $localFp) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Die '这个界面更新包配不上你现在这一版程序' @(
        '它是配着另一版「服务端」做出来的。服务端的代码是在程序启动时读进内存的，'
        '只换界面文件不会生效，硬装上去反而可能让判题出问题。'
        ''
        '请让发给你的人改发**整包**（一百多 MB、里面有 runtime 文件夹），按这个顺序装：'
        ''
        '  ① 先把这个文件夹里的整个 backup 文件夹，拷到新解压出来的文件夹里'
        '     ★ 你的全部存档（自动快照 + 你自己导出的备份）都在里面，这一步别跳 ★'
        '  ② 双击新文件夹里的「开始使用.cmd」'
        '  ③ 用几天确认没问题，再删掉这个旧文件夹'
        ''
        "（技术细节：期望 $($mf.serverFingerprint.Substring(0,12))…，本机 $($localFp.Substring(0,12))…）"
    )
}
Say '与本机服务端版本匹配' 'Green'

$curVer = 'v?'
try {
    $curHtml = Get-Content -LiteralPath (Join-Path $root 'dist\index.html') -Raw -Encoding UTF8
    if ($curHtml -match 'assets/index-([A-Za-z0-9_-]+)\.js') { $curVer = '构建 ' + $matches[1] }
} catch { }
Say "当前：$curVer  ->  新版：v$($mf.appVersion)"

# ---------- 3. 停掉正在运行的程序 ----------
Step '[3/5] 停掉正在运行的程序…'
function Test-PortBusy { return (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) }
function Get-AppWindowProc {
    $procs = Get-CimInstance -Query "SELECT ProcessId,CommandLine FROM Win32_Process WHERE Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue
    $m = @($procs | Where-Object { $_.CommandLine -and $_.CommandLine -like "*$profileDir*" -and $_.CommandLine -notlike '*--type=*' })
    if ($m.Count -eq 0) { return $null }
    try { return Get-Process -Id ([int]$m[0].ProcessId) -ErrorAction Stop } catch { return $null }
}
function Wait-Port([bool]$wantBusy, [int]$sec) {
    $end = (Get-Date).AddSeconds($sec)
    while ((Get-Date) -lt $end) {
        if ((Test-PortBusy) -eq $wantBusy) { return $true }
        Start-Sleep -Milliseconds 400
    }
    return ((Test-PortBusy) -eq $wantBusy)
}

$wasRunning = Test-PortBusy
if (-not $wasRunning) {
    Say '程序当前没在运行，直接更新。'
} else {
    # 优雅关窗（发 WM_CLOSE）而不是强杀：关窗口会先触发页面的 pagehide，
    # 编辑器里还压在防抖里没落盘的击键会先写进去 —— 和你平时手动关窗口是同一条路径。
    $app = Get-AppWindowProc
    $closed = $false
    if ($app -and $app.MainWindowHandle -ne [IntPtr]::Zero) {
        try { $closed = $app.CloseMainWindow() } catch { $closed = $false }
    }
    if ($closed) {
        Say '已请求关闭程序窗口，等服务自行停止…'
        if (-not (Wait-Port $false 25)) { $closed = $false }
    }
    if (-not $closed -or (Test-PortBusy)) {
        $stop = Join-Path $launchDir 'stop-hot100.ps1'
        if (Test-Path -LiteralPath $stop) {
            Say '改用停止脚本…'
            # 同上：调外部程序前把 EAP 降成 Continue，否则它往 stderr 写一行就会抛异常
            $prevEap2 = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$stop" 2>&1 | Out-Null
            $ErrorActionPreference = $prevEap2
            [void](Wait-Port $false 15)
        }
    }
    if (Test-PortBusy) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        Die '程序没能停下来（端口一直被占用）' @(
            '请手动关掉 Hot100 的程序窗口，然后再双击一次「更新.cmd」。'
        )
    }
    Say '已停止。' 'Green'
}

# ---------- 4. 换上新的（失败就整份回滚）----------
Step '[4/5] 替换界面文件…'
$cur = Join-Path $root 'dist'
$bak = Join-Path $root 'dist.更新前备份'
if (Test-Path -LiteralPath $bak) { Remove-Item -LiteralPath $bak -Recurse -Force -ErrorAction SilentlyContinue }

$rolledBack = $false
try {
    Rename-Item -LiteralPath $cur -NewName 'dist.更新前备份' -ErrorAction Stop
    Move-Item -LiteralPath $newDist -Destination $cur -ErrorAction Stop

    # 换完立刻自检：文件数对不对、首页在不在、首页引用的资源在不在
    $after = @(Get-ChildItem -LiteralPath $cur -Recurse -File)
    if ($after.Count -ne $mf.files) { throw "替换后文件数不对（$($after.Count) / 期望 $($mf.files)）" }
    if (-not (Test-Path -LiteralPath (Join-Path $cur 'index.html'))) { throw '替换后没有 index.html' }
    $html = Get-Content -LiteralPath (Join-Path $cur 'index.html') -Raw -Encoding UTF8
    foreach ($m in [regex]::Matches($html, '(?:src|href)="(/[^"]+)"')) {
        $refRel = $m.Groups[1].Value.TrimStart('/') -replace '/', '\'
        if (-not (Test-Path -LiteralPath (Join-Path $cur $refRel))) { throw "首页引用的 $($m.Groups[1].Value) 不在新的 dist 里" }
    }
    Say "已换上 v$($mf.appVersion)（$($after.Count) 个文件）" 'Green'
} catch {
    $why = $_.Exception.Message
    Say "替换失败：$why" 'Red'
    Say '正在回滚到更新前的版本…' 'Yellow'
    try {
        if (Test-Path -LiteralPath $cur) { Remove-Item -LiteralPath $cur -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $bak) { Rename-Item -LiteralPath $bak -NewName 'dist' -ErrorAction Stop }
        $rolledBack = $true
    } catch { }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    if ($rolledBack) {
        Die "更新失败，已回滚（$why）" @('程序已经恢复成更新前的样子，可以照常使用。请让对方重新发一次更新包。')
    }
    Die "更新失败，而且回滚也没成功（$why）" @(
        '请让对方发一份**整包**重新装一次。'
        '★ 装之前先把这个文件夹里的 backup 整个拷到新文件夹里 ★'
        '  你写的代码和笔记本身存在浏览器里（不在这个文件夹），但 backup 里的存档就在这儿，'
        '  删掉旧文件夹之前一定要先拷走。'
        "（界面文件的更新前备份可能还在：$bak）"
    )
}

Remove-Item -LiteralPath $bak -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Log "更新到 v$($mf.appVersion) 成功"

# ---------- 4b. 把「使用说明.txt」抬头那行版本号改掉 ----------
#
# 更新包里只有 dist\，所以 使用说明.txt 不会被替换 —— 界面显示 v1.0.1，
# 说明书却还写着「版本 1.0.0」。「你用的哪一版」是排查任何问题的第一句话，
# 对不上就会把人（和帮他排查的人）带偏。
#
# 为什么不直接把整份 使用说明.txt 放进更新包：它里面有 SIZE_DISK / JDK_VERSION
# 这些**只有整包时才知道**的值，dist 更新包重新生成的话只能填旧数或猜 —— 那是写错，
# 比不写更糟。所以只动版本那一行，其余一个字不碰。
#
# 这一步**失败不算更新失败**：dist 已经换好且自检通过了，为一行说明文字回滚才是荒唐的。
$usagePatched = $null
$usagePath = Join-Path $root '使用说明.txt'
if (Test-Path -LiteralPath $usagePath) {
    try {
        $raw = [System.IO.File]::ReadAllText($usagePath, [System.Text.Encoding]::UTF8)
        $newLine = "  版本 $($mf.appVersion)　（$($mf.buildDate) 打包）"
        # 只认抬头那种「两个空格 + 版本 + …」的行，且只替换第一处。
        # ⚠ 行尾必须用前瞻 `(?=\r?$)`，不能直接写 `[^\r\n]*$`：
        #   这份文件是 CRLF 的，而 .NET 多行模式下 `$` **不会跳过 `\r`** ——
        #   `[^\r\n]*` 停在 `\r` 前面，`$` 又匹配不上，于是整条正则永远不命中，
        #   版本行悄悄没被改、而代码看起来完全正常。（写第一版时正是这么错的。）
        #   用前瞻还有第二个好处：`\r` 不进匹配，替换后行尾原样保留，不会混进单独的 LF。
        $re = [regex]'(?m)^  版本 [^\r\n]*(?=\r?$)'
        if ($re.IsMatch($raw)) {
            $patched = $re.Replace($raw, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $newLine }, 1)
            if ($patched -ne $raw) {
                # UTF8Encoding($true) = 带 BOM，与打包时写出的那份保持一致
                [System.IO.File]::WriteAllText($usagePath, $patched, (New-Object System.Text.UTF8Encoding($true)))
                $usagePatched = $true
                Write-Log "使用说明.txt 的版本行已更新为 v$($mf.appVersion)"
            } else { $usagePatched = $true }      # 本来就是这一版
        } else {
            $usagePatched = $false
            Write-Log '使用说明.txt 里没找到版本行，跳过'
        }
    } catch {
        $usagePatched = $false
        Write-Log "改 使用说明.txt 的版本行失败（不影响更新）：$($_.Exception.Message)"
    }
}

# ---------- 5. 重新启动 ----------
Step '[5/5] 重新启动…'
if (-not $wasRunning) {
    Say '更新完成。双击桌面的「AlgoForge」即可开始。' 'Green'
} else {
    $vbs     = Join-Path $launchDir 'start-hidden.vbs'
    $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
    if ((Test-Path -LiteralPath $vbs) -and (Test-Path -LiteralPath $wscript)) {
        Start-Process -FilePath $wscript -ArgumentList @("`"$vbs`"") | Out-Null
    } else {
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $launchDir 'start-hot100.ps1')`"", '-Hidden'
        ) | Out-Null
    }
    Say '已重新启动，等服务就绪…'
    if (Wait-Port $true 120) { Say '好了，程序窗口马上会自己打开。' 'Green' }
    else { Say '等了 120 秒还没就绪，双击桌面的「AlgoForge」再试一次。' 'Yellow' }
}

Write-Host ''
Write-Host '  ============================================'
Say "已更新到 v$($mf.appVersion)。" 'Green'
Say '你的代码、笔记、进度都在浏览器数据目录里，这次更新一个字都没动过。'
Say 'backup 文件夹（自动快照 + 你自己导出的备份）也原样保留。'
if ($usagePatched -eq $false) {
    Say '（顺带一提：「使用说明.txt」抬头的版本号没能自动更新，看界面右上角的版本为准。）' 'Yellow'
}
Write-Host ''
