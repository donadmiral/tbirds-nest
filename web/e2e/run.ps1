# Runs the smoke suite against the live site. Asks for the health account once per session.
Set-Location $PSScriptRoot\..
if (-not $env:E2E_EMAIL) { $env:E2E_EMAIL = (Read-Host 'Health-check email').Trim() }
if (-not $env:E2E_PASSWORD) { $env:E2E_PASSWORD = (Read-Host 'Health-check password').Trim() }
if (-not $env:E2E_BASE_URL) { $env:E2E_BASE_URL = 'https://platinumcircles.app' }
npx playwright test --reporter=list
Write-Host "screens saved in web\e2e-screens"