# ===== DESIGN PASS 1: DETAIL POLISH (menu icon, brand link colors, clean search tabs) =====
$ErrorActionPreference = "Continue"
if (-not (Test-Path "package.json")) { Write-Host "Run from project root." -ForegroundColor Red; exit 1 }
git add -A 2>&1 | Out-Null; git commit -m "Before Design Pass 1" 2>&1 | Out-Null
$ErrorActionPreference = "Stop"
function Edit-File($path, $pairs) {
  $c = [System.IO.File]::ReadAllText($path)
  $crlf = $c.Contains("`r`n")
  if ($crlf) { $c = $c.Replace("`r`n", "`n") }
  foreach ($p in $pairs) {
    $old = $p[0].Replace("`r`n", "`n"); $new = $p[1].Replace("`r`n", "`n")
    $i = 0; $pos = $c.IndexOf($old); while ($pos -ge 0) { $i++; $pos = $c.IndexOf($old, $pos + 1) }
    if ($i -ne 1) { Write-Host ("ANCHOR FAIL (" + $i + "): " + $old.Substring(0,[Math]::Min(50,$old.Length))) -ForegroundColor Red; exit 1 }
    $c = $c.Replace($old, $new)
  }
  if ($crlf) { $c = $c.Replace("`n", "`r`n") }
  [System.IO.File]::WriteAllText($path, $c)
  Write-Host ("edited " + $path + " (" + $pairs.Count + " changes)") -ForegroundColor Green
}

$pairs0 = @(
  ,@(@'
<Text style={s.menuBtnTxt}>···</Text>
'@, @'
<Feather name="more-horizontal" size={18} color="#8E8E93" />
'@)
  ,@(@'
hashTag: { color: '#007AFF', fontWeight: '500' },
'@, @'
hashTag: { color: '#0B1E3D', fontWeight: '600' },
'@)
  ,@(@'
mention: { color: '#5856D6', fontWeight: '500' },
'@, @'
mention: { color: '#0B1E3D', fontWeight: '600' },
'@)
)
Edit-File "src\screens\feed\FeedScreen.tsx" $pairs0

$pairs1 = @(
  ,@(@'
const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'people', label: 'People', emoji: '👥' },
  { id: 'posts',  label: 'Posts',  emoji: '📝' },
  { id: 'jobs',   label: 'Jobs',   emoji: '💼' },
];
'@, @'
const TABS: { id: Tab; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'posts',  label: 'Posts' },
  { id: 'jobs',   label: 'Jobs' },
];
'@)
  ,@(@'
{t.emoji} {t.label}{count > 0 ? ` ${count}` : ''}
'@, @'
{t.label}{count > 0 ? `  ${count}` : ''}
'@)
)
Edit-File "src\screens\feed\SearchScreen.tsx" $pairs1

Write-Host "DESIGN PASS 1 DONE - press r in Metro" -ForegroundColor Green