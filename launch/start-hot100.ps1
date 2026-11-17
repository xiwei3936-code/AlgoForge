# AlgoForge —— 桌面启动器
#
# 两种模式：
#   默认（有控制台）：服务跑在本窗口前台，关闭窗口 = 停止服务。适合排查问题。
#   -Hidden（无控制台）：由 start-hidden.vbs 经 wscript 调起，全程不显示任何窗口；
#                        服务作为隐藏子进程运行，并监视应用窗口 ——
#                        **关闭应用窗口就自动停掉服务**，不留后台残留。
#
# 设计要点（都是踩过的坑）：
# * 窗口最小化或根本没有窗口，所以失败绝不能只写控制台 —— 一律弹窗（WScript.Shell.Popup
#   一定会置顶）+ 落盘日志，绝不一闪而过。
# * 命名互斥体做单实例：冷启动那几秒连点两次也不会起两份服务。

param(
    [switch]$Hidden          # 无控制台模式（由 start-hidden.vbs 传入）
)

$ErrorActionPreference = 'Stop'

$port    = 5178
$url     = "http://localhost:$port/"
$root    = Split-Path -Parent $PSScriptRoot           # 项目根目录（本脚本在 launch\ 下）
$logDir  = Join-Path $env:LOCALAPPDATA 'Hot100Trainer'
$logPath = Join-Path $logDir 'launcher.log'

if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch { }
}

# 日志尾巴：弹窗里要能直接看到最后几行。只说"失败了"对零基础用户等于什么都没说。
# **必须显式 -Encoding UTF8**：这些日志是 node/npm 经 cmd 重定向写出来的 UTF-8，
# PowerShell 5.1 默认按 ANSI(GBK) 读，中文和路径会整段变成乱码 ——
# 那时候弹窗里的"原因"反而会把人带偏（实测踩过：报错里的安装路径显示成 Hot100 鍒烽宸ュ叿…）。
function Get-LogTail([string]$p, [int]$n = 12) {
    if (-not (Test-Path -LiteralPath $p)) { return '' }
    try { return ((Get-Content -LiteralPath $p -Tail $n -Encoding UTF8 -ErrorAction SilentlyContinue) -join "`n") } catch { return '' }
}

# 跑一条 npm 命令：**输出永远落盘**，有控制台时同时实时显示。
# 以前无控制台模式（-Hidden）下 npm install / npm run build 的输出直接丢进虚空 ——
# 装依赖失败只弹出一句"安装依赖失败"，真正的报错查无可查。
function Invoke-Logged([string]$cmdLine, [string]$logFile) {
    "=== {0}  {1} ===" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $cmdLine | Out-File -LiteralPath $logFile -Encoding utf8
    & cmd.exe /c "$cmdLine 2>&1" | ForEach-Object { Write-Host "    $_"; $_ } | Out-File -LiteralPath $logFile -Encoding utf8 -Append
    return $LASTEXITCODE
}

# ---------- 包内运行时（打包版）----------
# 打包版把 jlink 裁剪过的 Java 与 node.exe 放在 runtime\ 下，使用者不必自己装任何东西。
# 源码开发时没有这个目录，就照旧用系统 PATH 里的 node / javac。
# HOT100_JAVA_HOME 由本进程设置，子进程（node -> vite -> 判题）自动继承，
# server/java-runner.mjs 的 resolveJavaHome() 会读它。
$bundledNodeExe = Join-Path $root 'runtime\node\node.exe'
$bundledJdkHome = Join-Path $root 'runtime\jdk'
$hasBundledNode = Test-Path -LiteralPath $bundledNodeExe
$hasBundledJdk  = Test-Path -LiteralPath (Join-Path $bundledJdkHome 'bin\javac.exe')
if ($hasBundledJdk) { $env:HOT100_JAVA_HOME = $bundledJdkHome }

$profileDir = Join-Path $logDir 'browser-profile'

# ---------- 本目录已经装着 Electron 外壳：把启动交给它 ----------
# 2026-10 起 AlgoForge 是独立软件（electron\main.mjs），进度也存在它那里（第一次打开时从旧版搬过去了）。
# 这个旧启动器要是照旧去开浏览器，人在那个窗口里做的题会存进旧版的浏览器目录，新版看不到 —— 数据悄悄分家。
# 所以只要本目录里有 Electron，就转交给它：旧的桌面快捷方式、开发用的重建脚本、直接双击 start-hidden.vbs 都走到这里。
# （别在这里写出那个重建脚本的文件名：它不进绿色包，打包的自检会把「提到了不在包里的文件」当成错误拦下来。）
# 打出去的绿色包里没有 Electron（有包内 node 的也一律不转），这一段不起作用。
$electronExe  = Join-Path $root 'node_modules\electron\dist\electron.exe'
$electronMain = Join-Path $root 'electron\main.mjs'
if (-not $hasBundledNode -and (Test-Path -LiteralPath $electronExe) -and (Test-Path -LiteralPath $electronMain)) {
    Write-Log '本目录有 Electron 外壳，转交给它启动'
    Start-Process -FilePath $electronExe -ArgumentList @("`"$electronMain`"") -WorkingDirectory $root | Out-Null
    exit 0
}

# 数一数「我们自己那个应用窗口」的浏览器主进程个数。
# 只认带我们专属 --user-data-dir 且不带 --type= 的进程（带 --type= 的是渲染/GPU 子进程）。
# 一次快速 TCP 连接，判断端口上有没有人在听。
#
# 这替掉了原来那两个调用：Invoke-WebRequest 探活 + Get-NetTCPConnection 查占用。
# 本机实测：前者**每次都耗满 -TimeoutSec 2**（连不上时并不会快速失败），
# 后者 2.3~4.0 秒。冷启动时两个都要跑，合计 4~6 秒 —— 那就是
# 「双击之后要干等好几秒」的全部来源，而真正干活的部分（起服务）不到 1 秒。
# 这个函数实测 350ms（没人听）/ 11ms（有人听）。
#
# ⚠ 两个地址都必须试。vite preview 绑的是 localhost，Windows 上它可能**只解析到 ::1** ——
#   只连 127.0.0.1 会被拒绝，于是误判成"没人听"，跑去起第二个服务，
#   撞上 --strictPort 直接失败，在使用者那里表现为「双击了没反应」。
#   这条坑 package.mjs 里专门记过（那边的探测也是为此不敢写死 127.0.0.1）。
function Test-PortFast([int]$p, [int]$ms = 300) {
    foreach ($ip in @('127.0.0.1', '::1')) {
        # ⚠⚠ TcpClient 必须**按地址族**构造。
        #   `New-Object System.Net.Sockets.TcpClient` 的默认构造在 .NET Framework 里是 IPv4，
        #   拿它去连 ::1 会直接抛「None of the discovered or specified addresses match
        #   the socket address family」—— 而 vite preview 实测**只监听 ::1**。
        #   写错的后果不是"慢"，是：探测永远返回 false ->
        #     · 程序已开着时再双击，会去起第二个服务，撞 --strictPort 失败
        #     · 等待循环永远等不到 -> 40 秒后把**正在正常运行的**服务杀掉并弹错误框
        #   （实测踩过：界面已经好好开着，40 秒后自己关了。）
        $addr = [System.Net.IPAddress]::Parse($ip)
        $c = New-Object System.Net.Sockets.TcpClient($addr.AddressFamily)
        try {
            $t = $c.ConnectAsync($addr, $p)
            if ($t.Wait($ms) -and $c.Connected) { return $true }
        } catch { }
        finally { $c.Close() }
    }
    return $false
}

function Get-AppWindowPid {
    $procs = Get-CimInstance -Query "SELECT ProcessId,CommandLine FROM Win32_Process WHERE Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue
    $m = @($procs | Where-Object {
        $_.CommandLine -and $_.CommandLine -like "*$profileDir*" -and $_.CommandLine -notlike '*--type=*'
    })
    if ($m.Count -gt 0) { return [int]$m[0].ProcessId }
    return 0
}

function Get-AppWindowCount {
    $procs = Get-CimInstance -Query "SELECT ProcessId,CommandLine FROM Win32_Process WHERE Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue
    @($procs | Where-Object {
        $_.CommandLine -and $_.CommandLine -like "*$profileDir*" -and $_.CommandLine -notlike '*--type=*'
    }).Count
}

# 失败时：改窗口标题 + 控制台红字 + 置顶弹窗 + 写日志。窗口最小化/隐藏也能看见。
function Fail([string]$msg, [string]$detail = '') {
    Write-Log "启动失败：$msg $detail"
    try { $Host.UI.RawUI.WindowTitle = 'Hot100 启动失败' } catch { }
    Write-Host ""
    Write-Host "  启动失败：$msg" -ForegroundColor Red
    if ($detail) { Write-Host "  $detail" -ForegroundColor DarkGray }
    $popup = "$msg`n`n$detail`n`n详细日志：`n$logPath"
    try { (New-Object -ComObject WScript.Shell).Popup($popup, 0, 'AlgoForge — 启动失败', 16) | Out-Null }
    catch { Read-Host "  按回车退出" }
    exit 1
}

# 后台（隐藏）启动 open-app.ps1：它等端口就绪后用应用模式打开界面。
# 传入本进程 PID —— 服务窗口一关它就自己退出，不会几十秒后凭空弹出窗口。
function Start-Opener {
    $opener = Join-Path $PSScriptRoot 'open-app.ps1'
    if (-not (Test-Path -LiteralPath $opener)) { Write-Log '缺少 open-app.ps1，跳过自动打开'; return }
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$opener`"",
        '-Url', $url, '-ParentPid', $PID
    ) | Out-Null
}

Write-Host ""
Write-Host "  AlgoForge" -ForegroundColor Cyan
Write-Host "  ----------------------------------------"
Write-Log "启动器开始（PID $PID）"
Write-Log ("运行时：Node={0} / JDK={1}" -f $(if ($hasBundledNode) { '包内' } else { '系统 PATH' }), $(if ($hasBundledJdk) { '包内' } else { '系统 PATH' }))

# ---------- 单实例锁：冷启动窗口期内重复双击只会再开界面，不会起第二份服务 ----------
$mutex = New-Object System.Threading.Mutex($false, 'Local\Hot100TrainerLauncher')
$owned = $false
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }

if (-not $owned) {
    Write-Host "  已有实例正在启动/运行，直接打开界面。" -ForegroundColor Green
    Write-Log '已有实例持锁，仅打开界面'
    Start-Opener
    Start-Sleep -Seconds 2
    exit 0
}

# 记下启动器自己的 PID：停止脚本要能停掉「正在启动中」（服务还没起来、端口还没占上）的启动器。
# 连进程启动时间一起写：PID 被系统回收给别的程序时不会误杀。
$pidFile = Join-Path $logDir 'launcher.pid'
try { ("{0} {1}" -f $PID, (Get-Process -Id $PID).StartTime.Ticks) | Set-Content -LiteralPath $pidFile -Encoding UTF8 } catch { }

try {
    # ---------- 端口上有人听吗？一次 TCP 连接就够（350ms） ----------
    # 三种状态都要保住，所以是**分层**判断而不是简单替换：
    #   没人听         -> 直接去起服务（冷启动的常见路径，只花 350ms）
    #   我们的服务在听 -> 只开界面，不重复起
    #   别的程序占着   -> 报错并说出是谁 —— 这条才付那两个慢调用的代价
    # 直接把两个调用换成一次 TCP 连接是不行的：它分不出后两种，
    # 会把「端口被 XX 占用」这条明确报错退化成「服务没能起来」，把人带偏。
    if (Test-PortFast $port) {
        $alive = $false
        try { $alive = ((Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing).StatusCode -eq 200) } catch { }
        if ($alive) {
            Write-Host "  服务已在运行，直接打开界面。" -ForegroundColor Green
            Write-Log '服务已在运行，仅打开界面'
            Start-Opener
            Start-Sleep -Seconds 2
            exit 0
        }
        # 有人听、但不是我们：这时才去查是谁占的（慢，可这是报错路径，慢无所谓）
        $busy = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        if ($busy.Count -gt 0) {
            $pid0  = $busy[0].OwningProcess
            $pname = try { (Get-Process -Id $pid0 -ErrorAction Stop).ProcessName } catch { '未知程序' }
            Fail "端口 $port 被其它程序占用，无法启动。" "占用者：$pname（PID $pid0）。请关闭它后重试。若要换端口，改 launch\start-hot100.ps1 顶部的 port 变量，以及 vite.config.js 里的端口。"
        }
        # 刚才还有人听，查的时候已经没了 —— 当作没人听，继续往下起服务
        Write-Log '端口上短暂有过监听，但已消失，继续启动'
    }

    # ---------- Node 是否可用 ----------
    # 打包版自带 node.exe，使用者什么都不用装；只有源码运行才需要系统 Node。
    if (-not $hasBundledNode -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
        Fail '没找到 Node.js。' '请先安装 Node.js（https://nodejs.org/），装完重新双击快捷方式。'
    }

    Set-Location -LiteralPath $root

    $viteMark = Join-Path $root 'node_modules\vite\package.json'
    $distMark = Join-Path $root 'dist\index.html'

    if ($hasBundledNode) {
        # ---------- 打包版：依赖与打包产物都随包提供 ----------
        # 这里**绝不能**去 npm install：包里根本没有 npm，也不该要求使用者联网。
        # 缺文件只可能是解压不完整，直接说清楚怎么办。
        if (-not (Test-Path -LiteralPath $distMark) -or -not (Test-Path -LiteralPath $viteMark)) {
            Fail '安装包不完整。' "运行所需的文件缺失。请把压缩包**完整**重新解压一次（不要只解压其中一部分文件夹），再双击快捷方式。`n程序目录：$root"
        }
        Write-Log '打包版：跳过依赖安装与打包'
    }
    else {

    # ---------- 依赖：查真实产物而不是只看 node_modules 目录 ----------
    #（装到一半被中断时目录也存在，只看目录会永远修不好）
    if (-not (Test-Path -LiteralPath $viteMark)) {
        Write-Host "  首次运行（或依赖不完整），正在安装依赖，可能要几分钟..." -ForegroundColor Yellow
        Write-Log '执行 npm install'
        $installLog = Join-Path $logDir 'npm-install.log'
        $rc = Invoke-Logged 'npm install' $installLog
        if ($rc -ne 0 -or -not (Test-Path -LiteralPath $viteMark)) {
            Write-Log "npm install 失败（退出码 $rc），完整输出见 $installLog"
            Fail '安装依赖失败。' ((Get-LogTail $installLog) + "`n`n完整输出：$installLog`n也可以删掉项目里的 node_modules 文件夹后重新双击快捷方式。")
        }
    }

    # ---------- 没打包过就先打包 ----------
    if (-not (Test-Path -LiteralPath $distMark)) {
        Write-Host "  正在打包（只需一次，约几秒）..." -ForegroundColor Yellow
        Write-Log '执行 npm run build'
        $buildLog = Join-Path $logDir 'npm-build.log'
        $rc = Invoke-Logged 'npm run build' $buildLog
        if ($rc -ne 0 -or -not (Test-Path -LiteralPath $distMark)) {
            Write-Log "npm run build 失败（退出码 $rc），完整输出见 $buildLog"
            Fail '打包失败。' ((Get-LogTail $buildLog) + "`n`n完整输出：$buildLog")
        }
    }

    }   # end if (-not $hasBundledNode)

    Write-Host "  正在启动本地服务，稍后会自动打开界面..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  * 界面右上角会先显示「正在加载 Python 环境」，约 10~20 秒变绿即可刷题" -ForegroundColor DarkGray
    Write-Host "    （Pyodide 与编辑器都已本地化，全程不需要联网）。" -ForegroundColor DarkGray
    if (-not $Hidden) {
        Write-Host "  * 本窗口可以最小化，但不要关闭 —— 关闭即停止服务。" -ForegroundColor DarkGray
    }
    Write-Host "  ----------------------------------------"
    Write-Host ""

    $svcLog = Join-Path $logDir 'server.log'

    # 打包版直接用包内 node 启动 vite，**不经过 npm**（包里没有 npm，也不需要）。
    # 实测这样启动只要 ~0.3 秒，而且少一层 cmd->npm 的进程链。
    # 源码运行时保持原来的 npm run preview 不变。
    if ($hasBundledNode) {
        $viteJs = Join-Path $root 'node_modules\vite\bin\vite.js'
        $serveCmd = "`"$bundledNodeExe`" `"$viteJs`" preview --port $port --strictPort"
    } else {
        $serveCmd = "npm run preview -- --port $port --strictPort"
    }
    Write-Log "启动服务（端口 $port，Hidden=$Hidden，$(if ($hasBundledNode) { '包内 node' } else { 'npm run preview' })）"

    if (-not $Hidden) {
        # ===== 有控制台模式：服务前台阻塞跑，关窗口即停 =====
        Start-Opener
        try { $Host.UI.RawUI.WindowTitle = "AlgoForge — 服务运行中（关闭此窗口即停止）" } catch { }
        & cmd.exe /c "$serveCmd > `"$svcLog`" 2>&1"
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            Fail "本地服务启动失败（退出码 $code）。" ((Get-LogTail $svcLog) + "`n`n完整输出：$svcLog")
        }
        Write-Host ""
        Write-Host "  服务已停止。" -ForegroundColor DarkGray
        Write-Log '服务正常结束'
        Start-Sleep -Seconds 1
        return
    }

    # ===== 无控制台模式 =====
    # 服务作为隐藏子进程；之后监视应用窗口，窗口一关就把服务整棵树杀掉。
    # ⚠ 最外面这一对引号是必须的，别当成多余的"化简"掉。
    #
    # cmd /c 的引号规则：/c 后面的字符串**以引号开头**且整串引号多于两个时，
    # cmd 会把**第一个**引号和**最后一个**引号删掉，命令当场被拆坏。
    # 而 Start-Process -ArgumentList 只是把数组元素用空格拼起来、不会替你加引号，
    # 所以传进去的就是裸的那一串。
    #
    # 打包版的 $serveCmd 正好以 "<包内 node.exe>" 开头 —— 实测子进程立刻退出（退出码 1）、
    # 连 server.log 都不会生成，在使用者那里表现为「双击快捷方式什么也没发生」。
    # 源码模式的 $serveCmd 是 `npm run preview ...`，不以引号开头，所以这个坑一直没暴露 ——
    # **只有打包版会中招，开发机上永远复现不了。**
    #
    # 多包一层之后，cmd 恰好剥掉这一层，剩下的正是想要的命令行。
    # 两种写法在真包上对照实测过：不包 -> 起不来；包一层 -> 服务起来且 bundled:true。
    $svcArg = "`"$serveCmd > `"$svcLog`" 2>&1`""
    $svc = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', $svcArg `
        -WindowStyle Hidden -PassThru
    Write-Log "服务子进程 PID $($svc.Id)"

    # ★ 先开窗，再等服务 —— 顺序反过来是这次提速的关键 ★
    # 启动动画页（launch\boot.html）是本地文件，不需要服务器，它自己会等、自己跳转。
    # 这样「动画」和「起服务」是并行的，而不是像以前那样等所有事情干完才画第一帧。
    Start-Opener

    # 等端口真的起来（最多 40 秒），起不来就弹窗报错，不能静默失败。
    # ⚠ 用 Test-PortFast 而不是 Invoke-WebRequest：后者探测**失败**时要耗满 2 秒超时，
    #   而服务实测 0.3~0.8 秒就绪 —— 恰好卡在原来「先睡 700ms 再探」的边上。
    #   一旦错过，下一次要等 0.7+2.0+0.7=3.4 秒。那正是启动时间忽长忽短的原因。
    $up = $false
    $waitUntil = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $waitUntil) {
        if ($svc.HasExited) { break }
        if (Test-PortFast $port 120) { $up = $true; break }
        Start-Sleep -Milliseconds 60
    }
    # 端口开了不等于 HTTP 就绪，补一次真实请求把最后这一段也确认掉
    # （这时服务已经在听，所以很快，不会再吃满超时）
    if ($up) { try { $null = Invoke-WebRequest -Uri $url -TimeoutSec 5 -UseBasicParsing } catch { } }
    if (-not $up) {
        try { if (-not $svc.HasExited) { & taskkill.exe /PID $svc.Id /T /F 2>&1 | Out-Null } } catch { }
        Fail '本地服务没能起来。' ((Get-LogTail $svcLog) + "`n`n完整输出：$svcLog")
    }

    # 等应用窗口出现（最多 45 秒），记下它的 PID
    $sawWindow = $false
    $appPid = 0
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        $appPid = Get-AppWindowPid
        if ($appPid -gt 0) { $sawWindow = $true; break }
    }
    if (-not $sawWindow) {
        # 没检测到我们的应用窗口（例如退回了系统默认浏览器）：无法靠窗口判生死，
        # 明确告知用户如何停止，然后继续守着服务。
        Write-Log '未检测到应用窗口，转为常驻模式'
        try {
            (New-Object -ComObject WScript.Shell).Popup(
                # 这里**不能**让人去双击「停止 AlgoForge」桌面快捷方式：
                # install-shortcut.ps1 默认不创建它（要加 -WithStop），
                # 打包版更是从来没创建过。指向一个不存在的东西比不给办法还糟。
                # 直接给出包里一定存在的那个文件的完整路径。
                "服务已在后台运行：`n$url`n`n没有检测到独立应用窗口，所以不会自动停止。`n需要结束时，双击这个文件即可停止：`n$(Join-Path $PSScriptRoot 'stop-hidden.vbs')",
                15, 'AlgoForge', 64) | Out-Null
        } catch { }
    } else {
        Write-Log '应用窗口已出现，进入守护模式'
    }

    # 守护：应用窗口关闭 → 停服务；服务自己挂了/被停止脚本杀掉 → 退出。
    # 这里只用廉价的 Get-Process 查 PID 是否还在，不每轮枚举 WMI（长时间挂着才不费 CPU）。
    while ($true) {
        Start-Sleep -Seconds 2
        if ($svc.HasExited) { Write-Log '服务进程已结束，守护退出'; break }
        if (-not $sawWindow) { continue }
        if (-not (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) {
            # 该 PID 没了，再用 WMI 确认一次是否真的一个窗口都不剩（防止浏览器换了主进程）
            $again = Get-AppWindowPid
            if ($again -gt 0) { $appPid = $again; continue }
            Write-Log '应用窗口已关闭，停止服务'
            try { & taskkill.exe /PID $svc.Id /T /F 2>&1 | Out-Null } catch { }
            break
        }
    }
}
finally {
    # 正常退出就把 pid 文件收走；被强杀时它会留下，但里面记了启动时间，停止脚本不会误杀别的进程
    try { if ($pidFile -and (Test-Path -LiteralPath $pidFile)) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } } catch { }
    if ($owned) { try { $mutex.ReleaseMutex() } catch { } }
    $mutex.Dispose()
}
