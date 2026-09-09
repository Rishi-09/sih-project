# Register Twin Sentinel as a Windows Background Task (starts on boot/logon)
$TaskName = "TwinSentinelPCAgent"
$VbsPath = Join-Path $PSScriptRoot "start-silent.vbs"

Write-Host "Registering Windows Background Startup Task: $TaskName..." -ForegroundColor Cyan

$Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$VbsPath`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0

# Check if already registered
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "24/7 Engine Telemetry Sentinel for Rotax 915 iS" | Out-Null

Write-Host "[OK] Successfully installed! The agent will start automatically on Windows startup." -ForegroundColor Green
Write-Host "To start it immediately right now, run: .\start-silent.vbs" -ForegroundColor Yellow

