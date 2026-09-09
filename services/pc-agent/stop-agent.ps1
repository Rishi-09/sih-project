# Stop any running instances of the Twin Sentinel PC Agent
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "services\\pc-agent\\agent\.py" }

if ($procs) {
    foreach ($p in $procs) {
        Write-Host "Stopping PC Agent PID $($p.ProcessId)..." -ForegroundColor Yellow
        Stop-Process -Id $p.ProcessId -Force
    }
    Write-Host "Twin Sentinel PC Agent stopped successfully." -ForegroundColor Green
} else {
    Write-Host "No active Twin Sentinel PC Agent found." -ForegroundColor Cyan
}
