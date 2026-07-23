$ErrorActionPreference = "Stop"
$enc = New-Object System.Text.UTF8Encoding($false)

$f = (Get-ChildItem node_modules -Recurse -Filter "AsyncNgrok.js" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*build*" } | Select-Object -First 1).FullName
if (-not $f) { throw "AsyncNgrok.js not found" }
$raw = [IO.File]::ReadAllText($f)
$n = 0
if ($raw.Contains("const TUNNEL_TIMEOUT = 10 * 1000;")) { $raw = $raw.Replace("const TUNNEL_TIMEOUT = 10 * 1000;", "const TUNNEL_TIMEOUT = 45 * 1000;"); $n++ }
if ($raw.Contains("authtoken: NGROK_CONFIG.authToken,")) { $raw = $raw.Replace("authtoken: NGROK_CONFIG.authToken,", ""); $n++ }
if ($raw.Contains("await (0, _delay.delayAsync)(100);")) { $raw = $raw.Replace("await (0, _delay.delayAsync)(100);", "await (0, _delay.delayAsync)(3000);"); $n++ }
[IO.File]::WriteAllText($f, $raw, $enc)
Write-Host "AsyncNgrok.js: $n fixes applied" -ForegroundColor Green

$p = "node_modules\@expo\ngrok\index.js"
if (Test-Path $p) {
  $r2 = [IO.File]::ReadAllText($p)
  $old = "opts.name = String(opts.name || uuid.v4());"
  $new = "opts.name = 'expo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);"
  if ($r2.Contains($old)) { [IO.File]::WriteAllText((Resolve-Path $p).Path, $r2.Replace($old, $new), $enc); Write-Host "ngrok index.js: unique name patch applied" -ForegroundColor Green }
  else { Write-Host "ngrok index.js: already patched" -ForegroundColor Yellow }
}
Write-Host "Done. Run: npx expo start --tunnel" -ForegroundColor Cyan