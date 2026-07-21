if (-not (Test-Path "package.json")) { Write-Host "Run from project root." -ForegroundColor Red; exit 1 }
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$PWD'; & '.\node_modules\@expo\ngrok-bin-win32-x64\ngrok.exe' http 8081"
Write-Host ""
Write-Host "  PHONE URL (same every time): https://revolt-spruce-overfull.ngrok-free.dev" -ForegroundColor Cyan
Write-Host ""
npx expo start
