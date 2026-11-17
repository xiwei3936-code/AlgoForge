# 停止 AlgoForge：结束本地服务 + 关闭它的应用窗口
# 无控制台模式下的"安全阀"：正常情况下关掉应用窗口就会自动停，
# 这个脚本用于窗口被强杀、或用默认浏览器打开（无法靠窗口判生死）等情况。
$ErrorActionPreference = 'Stop'

$port       = 5178
$logDir     = Join-Path $env:LOCALAPPDATA 'Hot100Trainer'
$profileDir = Join-Path $logDir 'browser-profile'
$logPath    = Join-Path $logDir 'launcher.log'

function Write-Log([string]$m) {
    try { Add-Content -LiteralPath $logPath -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding UTF8 } catch { }
}

# ★ 兜底：这个脚本是被 stop-hidden.vbs 用 `sh.Run cmd, 0, False`（无窗口、不等待、
#   从不读退出码）拉起来的。所以一旦抛出没被接住的终止性错误，使用者那边**什么都看不到** ——
#   不闪窗、不报错、不弹提示，只是"双击了停止，什么都没发生"，然后他会以为程序卡住了。
#   而 PS 5.1 在 $ErrorActionPreference='Stop' 下，原生程序往 stderr 写一行经 2>&1 进管道
#   就会变成终止性错误，这条路并不难走到。
#   中文提示只能放在这里：stop-hidden.vbs 必须是纯 ASCII（打包时有检查）。
trap {
    $msg = "停止脚本出错了：`n$($_.Exception.Message)`n`n" +
           "如果程序还开着，直接关掉它的窗口即可。`n详细日志：$logPath"
    try { Write-Log "未捕获的错误：$($_.Exception.Message)" } catch { }
    try { (New-Object -ComObject WScript.Shell).Popup($msg, 0, 'AlgoForge — 停止失败', 16) | Out-Null }
    catch { Write-Host $msg }
    exit 1
}

$killed = 0

# ① 先把应用窗口好好关掉 —— **这一步必须在停服务之前**。
#
# 顺序为什么要紧：页面在 pagehide 里会做两件保命的事 ——
# 往 /api/snapshot 交一份关窗快照、往 /api/snapshot/probe 记一条 hide 事件。
# 服务要是先被杀了，这两个请求就打在一个已经拒连的端口上，静默失败，
# 表现是 backup\hot100-events.log 里永远只有 boot 没有 hide，
# 而排查的人会据此以为「用户从来没正常关过程序」—— 完全错误的结论。
#
# 为什么不能上来就 taskkill /F：localStorage 的写入是批量延迟提交的
# （默认延迟 5 秒，写得越猛被推得越远）。浏览器正常退出时
# LocalStorageImpl::ShutDown() 会挨个 ScheduleImmediateCommit 强制落盘；
# 被 /F 直接终结则这一步根本不会执行，还没提交的改动全丢，且没有任何报错。
# （2026-08-25 那次归零的主因是另一码事：leveldb 开库失败退化成了内存库。
#   但这条是实打实的第二个失数据途径。exit_type=Crashed 就是它留下的指纹。）

# 只认带我们专属 user-data-dir 的主进程，不动用户平时的浏览器；
# 以及本目录的 Electron 外壳（新版，命令行里带 electron\main.mjs）—— 它也必须先好好关窗口：
# 服务就在它自己进程里，下面第 ③ 步按端口强杀会直接杀掉它，localStorage 没提交的改动就丢了。
# 带 --type= 的是渲染/GPU 子进程，跟着主进程走，不单独处理。
$electronMain = Join-Path (Split-Path -Parent $PSScriptRoot) 'electron\main.mjs'
function Get-AppProcs {
    $q = "SELECT ProcessId,CommandLine FROM Win32_Process WHERE Name='electron.exe' OR Name='chrome.exe' OR Name='msedge.exe'"
    @(Get-CimInstance -Query $q -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine -notlike '*--type=*' -and
        ($_.CommandLine -like "*$profileDir*" -or $_.CommandLine -like "*$electronMain*")
    })
}

# ⚠ 一次 CloseMainWindow 只关**一个**窗口。
#   使用者在程序已经开着的时候再双击一次快捷方式（最小化了、以为没开），
#   就会得到同一个 chrome 进程里的两个窗口 —— 那时只关掉一个，
#   剩下那个撑到超时，照样被 /F 强杀，这一整段改进就白做了。
#   所以必须**循环关到没有窗口为止**，而且每轮都要 Refresh()：
#   MainWindowHandle 和 HasExited 都是取快照时的值，不刷新就永远是老的。
function Close-AppWindows([int]$procId, [int]$timeoutSec = 10) {
    $proc = $null
    try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch { return $true }   # 已经不在了
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    $asked = 0
    while ((Get-Date) -lt $deadline) {
        try { $proc.Refresh() } catch { return $true }
        if ($proc.HasExited) { return $true }
        if ($proc.MainWindowHandle -eq [IntPtr]::Zero) { break }   # 没窗口可关了，交给兜底
        try { [void]$proc.CloseMainWindow(); $asked++ } catch { break }
        Start-Sleep -Milliseconds 300
    }
    try { $proc.Refresh(); if ($proc.HasExited) { return $true } } catch { return $true }
    # 还没退：再给它一点时间走完落盘（Chrome 收尾要写 Preferences、提交 localStorage）
    $left = [int]([Math]::Max(0, ($deadline - (Get-Date)).TotalMilliseconds))
    if ($asked -gt 0 -and $left -gt 0) { try { return $proc.WaitForExit($left) } catch { return $true } }
    return $false
}

foreach ($p in Get-AppProcs) {
    $gone = $false
    try { $gone = Close-AppWindows $p.ProcessId } catch { Write-Log "正常关闭时出错：$($_.Exception.Message)" }
    if ($gone) {
        Write-Log "应用窗口已正常退出（PID $($p.ProcessId)）"
    } else {
        # 走到这里有两种情况：一直没有主窗口（比如只剩后台进程），或者关了但迟迟不退。
        # 两种都只能强杀，但要如实记下来是哪一种，否则日后看日志分不清。
        Write-Log "应用窗口没能正常退出，改为强制结束（PID $($p.ProcessId)）"
        try { & taskkill.exe /PID $p.ProcessId /T /F 2>&1 | Out-Null } catch { Write-Log "强制结束时报错（已忽略）：$($_.Exception.Message)" }
    }
    $killed++
}

# 关完窗口再等一小会儿：pagehide 里那两个请求是异步发出去的，
# 服务端要有机会把它们写完。这点等待换来的是一份关窗快照，值。
Start-Sleep -Milliseconds 700

# ② 再停掉启动器本身。它可能正处在「启动中」——还在装依赖或打包，端口根本没占上，
#    那时候只按端口和浏览器窗口去找是找不到它的（以前这种情况下本脚本停不住）。
#    taskkill /T 会把它的子进程树（cmd -> npm -> node）一起带走。
$pidFile = Join-Path $logDir 'launcher.pid'
if (Test-Path -LiteralPath $pidFile) {
    $raw = ''
    try { $raw = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue) } catch { }
    $parts = @(($raw -split '\s+') | Where-Object { $_ })
    $lpid = 0
    $ticks = [int64]0
    if ($parts.Count -ge 1) { [void][int]::TryParse($parts[0], [ref]$lpid) }
    if ($parts.Count -ge 2) { [void][int64]::TryParse($parts[1], [ref]$ticks) }
    if ($lpid -gt 0 -and $lpid -ne $PID) {
        $proc = $null
        try { $proc = Get-Process -Id $lpid -ErrorAction Stop } catch { $proc = $null }
        # PID 会被系统回收给别的程序，所以必须核对启动时间，否则可能杀错进程
        $startTicks = [int64]0
        if ($proc) { try { $startTicks = $proc.StartTime.Ticks } catch { $startTicks = 0 } }
        if ($proc -and ($ticks -le 0 -or $startTicks -eq $ticks)) {
            Write-Log "停止启动器进程 PID $lpid（$($proc.ProcessName)）"
            try { & taskkill.exe /PID $lpid /T /F 2>&1 | Out-Null; $killed++ } catch { Write-Log "结束启动器时报错（已忽略）：$($_.Exception.Message)" }
        } elseif ($proc) {
            Write-Log "launcher.pid 里的 PID $lpid 已被别的进程占用（启动时间对不上），跳过"
        }
    }
    try { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } catch { }
}

# ③ 最后停掉占用端口的服务（连子进程一起：npm -> node）
foreach ($c in @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
    try { & taskkill.exe /PID $c.OwningProcess /T /F 2>&1 | Out-Null; $killed++ } catch { Write-Log "结束端口占用者时报错（已忽略）：$($_.Exception.Message)" }
}

Write-Log "停止脚本执行完毕，结束了 $killed 个进程组"

$msg = if ($killed -gt 0) { "已停止 AlgoForge。" } else { "没有检测到正在运行的 AlgoForge。" }
try { (New-Object -ComObject WScript.Shell).Popup($msg, 3, 'AlgoForge', 64) | Out-Null } catch { Write-Host $msg }
