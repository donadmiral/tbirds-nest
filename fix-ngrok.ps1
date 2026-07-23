$ErrorActionPreference = "Stop"
$enc = New-Object System.Text.UTF8Encoding($false)
$p = "node_modules\@expo\ngrok\index.js"
if (-not (Test-Path $p)) { throw "@expo/ngrok not found" }
$raw = [IO.File]::ReadAllText($p)
$old = "opts.name = String(opts.name || uuid.v4());"
$new = "opts.name = 'expo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);"
if ($raw.Contains($new)) { Write-Host "ngrok patch already applied." -ForegroundColor Yellow; return }
if (-not $raw.Contains($old)) { throw "expected line not found - paste line 28 of $p" }
Copy-Item $p "$p.bak" -Force
[IO.File]::WriteAllText((Resolve-Path $p).Path, $raw.Replace($old, $new), $enc)
Write-Host "ngrok patched: unique tunnel name per attempt." -ForegroundColor Green