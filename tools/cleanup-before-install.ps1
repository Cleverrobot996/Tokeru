# Tokeru 安装前清理
# 用途：结束残留的 tokero.exe，移除旧安装目录和安装注册表项。
# 不会删除题库/记录（它们在 %APPDATA%/com.tokero.app）。
$ErrorActionPreference = 'Stop'

Write-Host '=== Tokeru 安装前清理 ===' -ForegroundColor Cyan

$running = Get-Process -Name tokero -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "发现 $($running.Count) 个 tokero.exe，正在结束..."
    try {
        $running | Stop-Process -Force -ErrorAction Stop
    } catch {
        throw ('无法结束 tokero.exe。它可能以管理员身份运行，请右键此脚本选择「以管理员身份运行」，或在任务管理器里手动结束后再试。' + [Environment]::NewLine + $_.Exception.Message)
    }
    Start-Sleep -Seconds 3
}

$left = Get-Process -Name tokero -ErrorAction SilentlyContinue
if ($left) {
    throw "tokero.exe 仍在运行（PID: $($left.Id -join ', ')）。请先在任务管理器结束它，再运行本脚本。"
}

$installDir = Join-Path $env:LOCALAPPDATA 'Tokeru'
if (Test-Path -LiteralPath $installDir) {
    Write-Host "删除旧安装目录：$installDir"
    try {
        Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction Stop
    } catch {
        throw ('删除旧安装目录失败，可能有文件仍被占用，或杀毒软件正在扫描。请重启电脑后再运行本脚本。' + [Environment]::NewLine + $_.Exception.Message)
    }
} else {
    Write-Host "没有旧安装目录：$installDir"
}

$keys = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Tokeru',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Tokero',
    'HKCU:\Software\tokero\Tokeru',
    'HKCU:\Software\tokero\Tokero'
)
foreach ($key in $keys) {
    if (Test-Path $key) {
        Write-Host "删除注册表项：$key"
        Remove-Item -Path $key -Recurse -Force
    }
}

$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Tokeru.lnk'
if (Test-Path -LiteralPath $shortcut) {
    Write-Host "删除旧开始菜单快捷方式：$shortcut"
    Remove-Item -LiteralPath $shortcut -Force
}

Write-Host ''
Write-Host '清理完成。现在运行 Tokeru_3.4.1_x64-setup.exe 即可。' -ForegroundColor Green
Write-Host '如果安装仍被拦截，请把安装包和 %LOCALAPPDATA%/Tokeru 加入杀毒软件信任区，或暂时关闭实时扫描。'
