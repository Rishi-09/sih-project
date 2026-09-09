# Register Twin Sentinel to start automatically on Windows Startup
$VbsPath = Join-Path $PSScriptRoot "start-silent.vbs"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "TwinSentinelPCAgent.lnk"

Write-Host "Installing Twin Sentinel to Windows Startup Folder..." -ForegroundColor Cyan

try {
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = "wscript.exe"
    $Shortcut.Arguments = "`"$VbsPath`""
    $Shortcut.WorkingDirectory = $PSScriptRoot
    $Shortcut.Description = "24/7 Engine Telemetry Sentinel for Rotax 915 iS"
    $Shortcut.Save()

    Write-Host "[OK] Successfully installed! (No admin rights required)" -ForegroundColor Green
    Write-Host "Location: $ShortcutPath" -ForegroundColor Gray
    Write-Host "The agent will start silently every time Windows boots/logs in." -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Failed to create startup shortcut: $_" -ForegroundColor Red
}
