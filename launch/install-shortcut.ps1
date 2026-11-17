# 在桌面创建「AlgoForge」快捷方式（可重复运行，会覆盖旧的）
#   默认：无控制台启动（wscript + start-hidden.vbs），全程不显示任何黑窗口
#   -Console  ：改回带控制台的启动方式，方便排查问题
#   -WithStop ：额外创建「停止 AlgoForge」桌面快捷方式。
#               默认【不创建】—— 正常关掉应用窗口，服务就会自动停止，用不上它。
#               只有走默认浏览器兜底（分不清哪个窗口是应用）或服务被孤立时才需要，
#               那种情况直接双击 launch 目录里的 stop-hidden.vbs 一样能停。
# 图标：默认用 launch\algoforge.ico（就是作者的 Logo.ico，和 electron\icon.ico 是同一份）。
#       换图标：改下面的 $IconPath，或运行时传参 -IconPath "D:\xxx.ico"
#       ⚠ 换图的时候连文件名一起换，别原名覆盖：Windows 按路径缓存快捷方式图标，
#         原名覆盖的话，对方桌面上很可能还是旧图（以前叫 hot100.ico、是蓝色对勾，就是这么换掉的）。
param(
    [string]$IconPath = '',
    [switch]$Console,
    [switch]$WithStop
)
$ErrorActionPreference = 'Stop'

$launchDir = $PSScriptRoot
$icon      = if ($IconPath -and (Test-Path -LiteralPath $IconPath)) { $IconPath } else { Join-Path $launchDir 'algoforge.ico' }
$desktop   = [Environment]::GetFolderPath('Desktop')     # OneDrive 重定向后也能拿到正确路径
$lnkPath   = Join-Path $desktop 'AlgoForge.lnk'
$stopPath  = Join-Path $desktop '停止 AlgoForge.lnk'

$wscript   = Join-Path $env:SystemRoot 'System32\wscript.exe'
$startVbs  = Join-Path $launchDir 'start-hidden.vbs'
$stopVbs   = Join-Path $launchDir 'stop-hidden.vbs'
$cmdTarget = Join-Path $launchDir 'start-hot100.cmd'

if (-not (Test-Path -LiteralPath $desktop)) { throw "找不到桌面目录：$desktop" }
# 无控制台方案依赖 wscript（Win11 上 VBScript 已标记弃用，若哪天被移除就自动退回控制台方案）
$useHidden = (-not $Console) -and (Test-Path -LiteralPath $wscript) -and (Test-Path -LiteralPath $startVbs)
if (-not $useHidden -and -not $Console) {
    Write-Warning '系统缺少 wscript.exe 或 start-hidden.vbs，退回「带控制台」的启动方式。'
}
if (-not $useHidden -and -not (Test-Path -LiteralPath $cmdTarget)) { throw "找不到启动脚本：$cmdTarget" }

# 图标：优先自带 ico，其次 Edge/Chrome，最后退到系统图标（绝不留黑色 cmd 图标）
function Resolve-Icon {
    if (Test-Path -LiteralPath $icon) { return "$icon,0" }
    foreach ($exe in @('msedge.exe', 'chrome.exe')) {
        foreach ($hive in @('HKLM:', 'HKCU:')) {
            $p = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe"
            if (Test-Path -LiteralPath $p) {
                $path = (Get-ItemProperty $p -ErrorAction SilentlyContinue).'(default)'
                if ($path -and (Test-Path -LiteralPath $path)) { return "$path,0" }
            }
        }
    }
    Write-Warning "没找到图标文件（默认找 $IconPath，其次 launch\algoforge.ico），暂用系统图标。"
    return "$env:SystemRoot\System32\shell32.dll,13"
}

$iconLoc = Resolve-Icon
$shell = New-Object -ComObject WScript.Shell

# ---- 主快捷方式 ----
$sc = $shell.CreateShortcut($lnkPath)
if ($useHidden) {
    $sc.TargetPath = $wscript
    $sc.Arguments  = "`"$startVbs`""
    $sc.WindowStyle = 1                                  # wscript 本身无窗口，这里无意义
} else {
    $sc.TargetPath = $cmdTarget
    $sc.WindowStyle = 7                                  # 7 = 最小化
}
$sc.WorkingDirectory = Split-Path -Parent $launchDir     # 项目根目录
$sc.Description      = 'AlgoForge —— 本地运行的算法练习工具'
$sc.IconLocation     = $iconLoc
$sc.Save()

# ---- 停止快捷方式（安全阀，默认不装；需要就加 -WithStop）----
if ($useHidden -and $WithStop -and (Test-Path -LiteralPath $stopVbs)) {
    $sc2 = $shell.CreateShortcut($stopPath)
    $sc2.TargetPath       = $wscript
    $sc2.Arguments         = "`"$stopVbs`""
    $sc2.WorkingDirectory = $launchDir
    $sc2.Description      = '停止 AlgoForge 的本地服务'
    $sc2.IconLocation     = "$env:SystemRoot\System32\shell32.dll,27"
    $sc2.Save()
} elseif (Test-Path -LiteralPath $stopPath) {
    Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
}

# ---- 清掉改名前留下的旧快捷方式 ----
# 产品从「Hot100 刷题工具」改名成 AlgoForge。不管它的话，桌面上会同时躺着两个
# 指向同一个启动器的图标，而旧的那个名字已经不对了。
# 只在**确认它指向本目录的启动器**时才删 —— 绝不动使用者自己建的同名文件。
$legacy = @('Hot100 刷题工具.lnk', '停止 Hot100 刷题工具.lnk')
# ⚠ $launchDir 为空时 "*$launchDir*" 会退化成 "**" —— 那就**任何**同名快捷方式都会被删掉。
#   正常运行时 $PSScriptRoot 不可能为空，但这是一段会删文件的代码，不留这条口子。
if ([string]::IsNullOrWhiteSpace($launchDir)) {
    Write-Host '  （launchDir 为空，跳过旧快捷方式清理）' -ForegroundColor DarkGray
} else {
    foreach ($n in $legacy) {
        $old = Join-Path $desktop $n
        if (-not (Test-Path -LiteralPath $old)) { continue }
        try {
            $probe  = $shell.CreateShortcut($old)
            $target = "$($probe.TargetPath) $($probe.Arguments) $($probe.WorkingDirectory)"
            # 认「它指向的是不是本程序的启动脚本」，而不是「是不是本目录的」。
            # 升级时人是把新版解压到**另一个文件夹**的，旧快捷方式指向的是旧文件夹 ——
            # 只认本目录的话就删不掉它，对方桌面上会留一个指向已删目录的死图标。
            $isOurs = ($target -like "*$launchDir*") `
                -or ($target -like '*start-hidden.vbs*') -or ($target -like '*stop-hidden.vbs*') `
                -or ($target -like '*start-hot100*')     -or ($target -like '*stop-hot100*')
            if ($isOurs) {
                Remove-Item -LiteralPath $old -Force -ErrorAction Stop
                Write-Host "  已移除改名前的旧快捷方式：$n" -ForegroundColor DarkGray
            }
        } catch { }   # 读不出来就当它不是我们的，宁可留着
    }
}

Write-Host "已创建桌面快捷方式：" -ForegroundColor Green
Write-Host "  $lnkPath"
if ($useHidden -and $WithStop) { Write-Host "  $stopPath" }
Write-Host ""
if ($useHidden) {
    Write-Host "启动方式：无控制台（不会出现黑窗口）。" -ForegroundColor Cyan
    Write-Host "停止方式：直接关闭应用窗口即可，服务会自动停止；"
    if ($WithStop) {
        Write-Host "          若遇异常，可双击桌面的「停止 AlgoForge」强制结束。"
    } else {
        Write-Host "          若遇异常，双击 launch 目录里的 stop-hidden.vbs 可强制结束。"
        Write-Host "          想在桌面放个停止快捷方式，重跑本脚本时加 -WithStop。"
    }
} else {
    Write-Host "启动方式：带控制台（窗口最小化），关闭该窗口即停止服务。" -ForegroundColor Cyan
}
Write-Host "启动失败会弹窗提示，日志：$env:LOCALAPPDATA\Hot100Trainer\launcher.log"
