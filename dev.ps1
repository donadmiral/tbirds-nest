Set-Location -Path 'C:\app\tbirds-nest\tbirds-nest'
$ErrorActionPreference = 'Continue'
Remove-Item Env:EXPO_PACKAGER_PROXY_URL -ErrorAction SilentlyContinue
Remove-Item Env:REACT_NATIVE_PACKAGER_HOSTNAME -ErrorAction SilentlyContinue
$log = 'C:\app\tbirds-nest\tbirds-nest\tunnel-log.txt'
$watcher = Start-Job -ScriptBlock { while ($true) { Get-Process ngrok -ErrorAction SilentlyContinue | ForEach-Object { try { $_.PriorityClass = 'High' } catch {} }; Start-Sleep -Seconds 3 } }
try {
  while ($true) {
    Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
    Add-Content $log ("{0}  SERVER START" -f (Get-Date -Format 'HH:mm:ss'))
    npx expo start --tunnel
    Add-Content $log ("{0}  SERVER EXITED" -f (Get-Date -Format 'HH:mm:ss'))
    Start-Sleep -Seconds 3
  }
} finally { Stop-Job $watcher -EA SilentlyContinue; Remove-Job $watcher -EA SilentlyContinue }