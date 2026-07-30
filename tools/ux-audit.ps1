# ux-audit.ps1 - interface red flags across every screen.
# Run: powershell -ExecutionPolicy Bypass -File tools\ux-audit.ps1
$R = Join-Path (Split-Path $PSScriptRoot -Parent) "src\screens"
Write-Host ""
Write-Host "=== INTERFACE AUDIT ===" -ForegroundColor Cyan
$flagged = 0
Get-ChildItem -Path $R -Recurse -Include *.tsx | Sort-Object Name | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName)
  $issues = @()
  $lists = ([regex]::Matches($t, "<FlatList|<SectionList")).Count
  $empties = ([regex]::Matches($t, "ListEmptyComponent")).Count
  $scrollers = $lists + ([regex]::Matches($t, "<ScrollView")).Count
  if ($lists -gt 0 -and $empties -lt $lists) { $issues += "blank when empty (" + $lists + " lists, " + $empties + " empty states)" }
  if ($scrollers -gt 0 -and $t -notmatch "paddingBottom|TAB_BAR_CLEARANCE") { $issues += "no bottom clearance, content can hide under the tab bar" }
  $fetches = ([regex]::Matches($t, "supabase\.|Service\.")).Count
  if ($fetches -gt 2 -and $t -notmatch "ActivityIndicator|Skeleton") { $issues += "fetches with no loading state" }
  $silent = ([regex]::Matches($t, "const \{ data \}")).Count
  if ($silent -gt 0) { $issues += ("" + $silent + " database calls ignore their error") }
  $touch = ([regex]::Matches($t, "<TouchableOpacity")).Count
  $slop = ([regex]::Matches($t, "hitSlop")).Count
  if ($touch -ge 8 -and $slop -eq 0) { $issues += ("" + $touch + " tap targets, none widened with hitSlop") }
  if ($t -notmatch "SafeAreaView|useSafeAreaInsets") { $issues += "ignores safe areas, can sit under the notch or home bar" }
  if ($issues.Count) {
    $flagged++
    Write-Host ("  " + $_.Name) -ForegroundColor Yellow
    foreach ($i in $issues) { Write-Host ("      - " + $i) -ForegroundColor Gray }
  }
}
if ($flagged -eq 0) { Write-Host "  no interface red flags" -ForegroundColor Green }
else { Write-Host ("  " + $flagged + " screens carry at least one red flag") -ForegroundColor Yellow }
Write-Host ""