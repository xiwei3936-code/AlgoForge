# AlgoForge —— 首次使用（给拿到打包版的人跑；源码开发用不着）
#
# 做四件事，每件都在屏幕上说清楚：
#   1. 检查解压是否完整 —— 缺文件是最常见的故障，而且报错往往会伪装成别的问题
#   2. 解除「来自网络」的锁定标记 —— 下载来的压缩包解压出的脚本带这个标记，
#      不解除的话双击会被弹一道安全警告，看起来像"中毒了"
#   3. 在桌面创建快捷方式
#   4. 直接启动一次
#
# 失败一律说清楚「哪一步、为什么、下一步做什么」，绝不只留一句"出错了"。

param(
    [switch]$NoShortcut,    # 只检查+解锁，不建快捷方式
    [switch]$NoStart        # 装完不自动启动
)

$ErrorActionPreference = 'Stop'

$launchDir = $PSScriptRoot
$root      = Split-Path -Parent $launchDir

function Say([string]$msg, [string]$color = 'Gray') { Write-Host "  $msg" -ForegroundColor $color }
function Step([string]$msg) { Write-Host ''; Write-Host "  $msg" -ForegroundColor Cyan }

function Die([string]$what, [string[]]$how) {
    Write-Host ''
    Write-Host "  安装没有完成：$what" -ForegroundColor Red
    Write-Host ''
    foreach ($line in $how) { Write-Host "  $line" -ForegroundColor Yellow }
    Write-Host ''
    exit 1
}

Write-Host ''
Write-Host '  AlgoForge —— 首次使用' -ForegroundColor Cyan
Write-Host '  ============================================'
Say "程序目录：$root"

# ---------- 1. 解压是否完整 ----------
# 只列「少了它就一定起不来」的东西。压缩包解压到一半、或杀毒软件删掉其中几个，
# 表现出来是五花八门的报错；在这里一次说清楚，比后面每处各报各的强得多。
Step '[1/4] 检查文件是否齐全…'
$required = @(
    @{ p = 'runtime\node\node.exe';         d = '包内 Node 运行时' },
    @{ p = 'dist\index.html';               d = '网页界面' },
    @{ p = 'node_modules\vite\bin\vite.js'; d = '本地服务器' },
    @{ p = 'vite.config.js';                d = '服务器配置' },
    @{ p = 'server\java-runner.mjs';        d = 'Java 判题接口' },
    @{ p = 'server\java\Hot100Judge.java';  d = 'Java 判题外壳' },
    @{ p = 'shared\judgeSpec.js';          d = '判题规则（界面与服务端共用）' },
    @{ p = 'launch\start-hot100.ps1';       d = '启动脚本' }
)
$missing = @()
foreach ($r in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $r.p))) {
        $missing += ('{0}（{1}）' -f $r.p, $r.d)
    }
}

# 包内 JDK 单列，**缺了不算安装失败**：使用说明里明确写了「想用自己装的 JDK 就把
# runtime\jdk 改名或删掉」，启动器也是这么设计的（找不到就不设 HOT100_JAVA_HOME，
# 回落到 PATH 里的 javac）。要是这里当成"包不完整"，照着说明做的人反而会被拦下。
$hasBundledJdk = (Test-Path -LiteralPath (Join-Path $root 'runtime\jdk\bin\javac.exe')) `
    -and (Test-Path -LiteralPath (Join-Path $root 'runtime\jdk\bin\java.exe'))
if ($missing.Count -gt 0) {
    $lines = @('缺少：')
    foreach ($m in $missing) { $lines += "  - $m" }
    $lines += ''
    $lines += '多半是下面两种情况之一：'
    $lines += '  A. 压缩包没有【完整】解压。请把整个压缩包重新解压一次，'
    $lines += '     不要只把其中几个文件夹拖出来，也不要直接在压缩软件里双击运行。'
    $lines += '  B. 杀毒软件把文件删了或隔离了。请到杀毒软件的「隔离区 / 信任区」里恢复，'
    $lines += '     把整个程序目录加入白名单，然后重新解压一次。'
    $lines += ''
    $lines += "程序目录：$root"
    Die "有 $($missing.Count) 个必需文件不在" $lines
}
Say '齐全。' 'Green'

# 程序目录必须可写：vite 每次启动都要在 node_modules\.vite-temp 下落一个临时配置文件。
# 解压到 C:\Program Files\ 这类需要管理员权限的地方就会失败，而那时的报错跟"权限"
# 一个字都不沾边，纯靠猜。放在这里一次说清。
$probe = Join-Path $root 'node_modules\.hot100-write-probe'
try {
    New-Item -ItemType File -Path $probe -Force -ErrorAction Stop | Out-Null
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
} catch {
    $lines2 = @(
        '程序需要往自己的目录里写一个临时文件才能启动，但这个目录不允许写入。'
        ''
        '最常见的原因是解压到了需要管理员权限的位置（比如 C:\Program Files\），'
        '或者解压到了只读的 U 盘 / 光盘。'
        ''
        '解决办法：把整个文件夹移到你自己的目录下再试，例如'
        ('  {0}\Hot100' -f [Environment]::GetFolderPath('Desktop'))
        '  或 D:\Hot100'
        ''
        "当前位置：$root"
    )
    Die '程序目录不可写' $lines2
}

if ($hasBundledJdk) {
    Say '包内自带 Java 运行时，写 Java 时不需要你另外安装。'
} else {
    Say '没有找到包内的 Java 运行时（runtime\jdk）。' 'Yellow'
    Say '这不影响使用 Python；写 Java 时会改用你系统里装的 JDK（需要 11 以上，推荐 17 以上）。' 'Yellow'
    Say '若你并没有刻意删过它，请把压缩包完整重新解压一次。' 'Yellow'
}

# ---------- 2. 解除网络锁定 ----------
# 从网上下载的压缩包，解压出来的文件都带 Zone.Identifier 数据流，
# Windows 会对双击 .vbs / .cmd / .ps1 弹一道安全警告。
# 只处理「用户可能直接双击」的那些脚本（程序根目录与 launch 目录），
# 不去递归 node_modules / dist —— 那里上万个文件，既慢又没必要。
Step '[2/4] 解除「来自网络」的锁定标记…'
$unblocked = 0
$scanDirs = @($root, $launchDir)
foreach ($d in $scanDirs) {
    try {
        Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in '.ps1', '.vbs', '.cmd', '.bat', '.txt' } |
            ForEach-Object {
                $z = Get-Item -LiteralPath $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue
                if ($z) {
                    Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue
                    $unblocked++
                }
            }
    } catch { }
}
if ($unblocked -gt 0) { Say "解除了 $unblocked 个文件的锁定。" 'Green' }
else { Say '没有被锁定的文件（从本地拷过来的就是这样，正常）。' }

# ---------- 3. 桌面快捷方式 ----------
Step '[3/4] 创建桌面快捷方式…'
if ($NoShortcut) {
    Say '已跳过（-NoShortcut）。以后双击 launch\start-hidden.vbs 也能启动。'
} else {
    $installer = Join-Path $launchDir 'install-shortcut.ps1'
    if (-not (Test-Path -LiteralPath $installer)) {
        Say '找不到 install-shortcut.ps1，跳过。以后双击 launch\start-hidden.vbs 也能启动。' 'Yellow'
    } else {
        try {
            # -IconPath '' 是刻意的：让它回退到包内的 launch\algoforge.ico
            # 用 *> $null 而不是 | Out-Null：Write-Host 走的是信息流(6)，管道拦不住它，
            # 那样 install-shortcut.ps1 的整屏输出会灌进这一步、把本脚本的提示冲没。
            & $installer -IconPath '' *> $null
            Say '好了 —— 桌面上会出现「AlgoForge」。' 'Green'
        } catch {
            Say "创建快捷方式失败：$($_.Exception.Message)" 'Yellow'
            Say '不影响使用：双击 launch\start-hidden.vbs 一样能启动。' 'Yellow'
        }
    }
}

# ---------- 4. 启动 ----------
Step '[4/4] 启动…'
if ($NoStart) {
    Say '已跳过（-NoStart）。双击桌面快捷方式即可开始。'
} else {
    $vbs     = Join-Path $launchDir 'start-hidden.vbs'
    $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
    try {
        if ((Test-Path -LiteralPath $vbs) -and (Test-Path -LiteralPath $wscript)) {
            # 每个参数都显式加引号：路径里有空格或中文时，不加引号会被从空格处截断
            Start-Process -FilePath $wscript -ArgumentList @("`"$vbs`"") | Out-Null
        } else {
            $ps1 = Join-Path $launchDir 'start-hot100.ps1'
            Start-Process -FilePath 'powershell.exe' -ArgumentList @(
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$ps1`""
            ) | Out-Null
        }
        Say '已经在后台启动了。' 'Green'
    } catch {
        Say "启动失败：$($_.Exception.Message)" 'Yellow'
        Say '请双击桌面的「AlgoForge」再试一次。' 'Yellow'
    }
}

Write-Host ''
Write-Host '  ============================================'
Write-Host '  接下来会发生什么' -ForegroundColor Cyan
Say '· 大约十几秒后界面会自己弹出来（第一次慢一些，之后快）。'
Say '· 界面右上角先显示「正在加载 Python 环境」，变绿就能开始做题。'
Say '· 关掉界面窗口，后台服务就自动停了，不会有东西留在后台跑。'
Write-Host ''
Say '· 你的代码、笔记、进度存在浏览器数据目录里，不在程序文件夹里：'
Say "  $env:LOCALAPPDATA\Hot100Trainer"
Say '  所以【覆盖更新程序不会弄丢你写的东西】。但请定期用界面右上角的'
Say '  「💾 备份 / 恢复」导出一份 —— 那是唯一能带走的存档。'
Write-Host ''
Say "· 出问题先看：$env:LOCALAPPDATA\Hot100Trainer\launcher.log"
Say '· 详细说明见程序目录里的「使用说明.txt」。'
Write-Host ''
