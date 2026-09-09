# Check status of Twin Sentinel PC Agent
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "services\\pc-agent\\agent\.py" }
$logFile = Join-Path $PSScriptRoot "agent.log"

Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " Rotax 915 iS Sentinel - PC Background Service Status" -ForegroundColor White
Write-Host "===========================================================" -ForegroundColor Cyan

if ($procs) {
    Write-Host "Status: " -NoNewline
    Write-Host "ACTIVE (RUNNING IN BACKGROUND)" -ForegroundColor Green
    foreach ($p in $procs) {
        Write-Host "PID: $($p.ProcessId) | Started: $($p.CreationDate)" -ForegroundColor Gray
    }
} else {
    Write-Host "Status: " -NoNewline
    Write-Host "STOPPED" -ForegroundColor Red
}

if (Test-Path $logFile) {
    Write-Host "`nRecent Log Entries:" -ForegroundColor Yellow
    Get-Content $logFile -Tail 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
}
Write-Host "===========================================================" -ForegroundColor Cyan
