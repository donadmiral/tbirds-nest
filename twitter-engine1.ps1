# ===== TWITTER ENGINE 1: FOLLOW-DRIVEN FOR YOU, TAPPABLE TAGS, SHARE LINKS =====
$ErrorActionPreference = "Continue"
if (-not (Test-Path "package.json")) { Write-Host "Run from project root." -ForegroundColor Red; exit 1 }
git add -A 2>&1 | Out-Null; git commit -m "Before Twitter Engine 1" 2>&1 | Out-Null
$ErrorActionPreference = "Stop"
$c = [System.IO.File]::ReadAllText("src\screens\feed\FeedScreen.tsx")
$crlf = $c.Contains("`r`n"); if ($crlf) { $c = $c.Replace("`r`n","`n") }
$old = @'
  const renderPost = useCallback(({ item: post }: { item: Post }) => {
'@
$new = @'
  const openHashtag = useCallback((tag: string) => {
    navigation.navigate('TrendFeed', { tag });
  }, [navigation]);

  const openMention = useCallback(async (uname: string) => {
    const { data } = await supabase.from('profiles').select('id, full_name, username, avatar_url').eq('username', uname).maybeSingle();
    if (data?.id) navigation.navigate('UserProfile', { userId: data.id, user: data });
  }, [navigation]);

  const renderPost = useCallback(({ item: post }: { item: Post }) => {
'@
$old = $old.Replace("`r`n","`n"); $new = $new.Replace("`r`n","`n")
$i=0; $pos=$c.IndexOf($old); while ($pos -ge 0) { $i++; $pos=$c.IndexOf($old,$pos+1) }
if ($i -ne 1) { Write-Host ("ANCHOR FAIL ("+$i+"): "+$old.Substring(0,[Math]::Min(50,$old.Length))) -ForegroundColor Red; exit 1 }
$c = $c.Replace($old, $new)

$old = @'
renderRichText(post.content, () => {}, () => {})
'@
$new = @'
renderRichText(post.content, openHashtag, openMention)
'@
$old = $old.Replace("`r`n","`n"); $new = $new.Replace("`r`n","`n")
$i=0; $pos=$c.IndexOf($old); while ($pos -ge 0) { $i++; $pos=$c.IndexOf($old,$pos+1) }
if ($i -ne 1) { Write-Host ("ANCHOR FAIL ("+$i+"): "+$old.Substring(0,[Math]::Min(50,$old.Length))) -ForegroundColor Red; exit 1 }
$c = $c.Replace($old, $new)

$old = @'
const [feedMode, setFeedMode] = useState<'forYou' | 'latest' | 'innovation'>('forYou');
'@
$new = @'
const [feedMode, setFeedMode] = useState<'forYou' | 'latest' | 'innovation'>('forYou');
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
'@
$old = $old.Replace("`r`n","`n"); $new = $new.Replace("`r`n","`n")
$i=0; $pos=$c.IndexOf($old); while ($pos -ge 0) { $i++; $pos=$c.IndexOf($old,$pos+1) }
if ($i -ne 1) { Write-Host ("ANCHOR FAIL ("+$i+"): "+$old.Substring(0,[Math]::Min(50,$old.Length))) -ForegroundColor Red; exit 1 }
$c = $c.Replace($old, $new)

$old = @'
  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

'@
$new = @'
  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    if (!userId) return;
    supabase.from('orbits').select('following_id').eq('follower_id', userId).limit(1000)
      .then(({ data }) => { if (data) setFollowingIds(new Set(data.map((r: any) => r.following_id))); });
  }, [userId]);

'@
$old = $old.Replace("`r`n","`n"); $new = $new.Replace("`r`n","`n")
$i=0; $pos=$c.IndexOf($old); while ($pos -ge 0) { $i++; $pos=$c.IndexOf($old,$pos+1) }
if ($i -ne 1) { Write-Host ("ANCHOR FAIL ("+$i+"): "+$old.Substring(0,[Math]::Min(50,$old.Length))) -ForegroundColor Red; exit 1 }
$c = $c.Replace($old, $new)

$old = @'
    if (feedMode === 'forYou') list.sort((a, b) => b.score - a.score);
    else list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return list;
  }, [posts, feedMode, search]);
'@
$new = @'
    if (feedMode === 'forYou') {
      const boost = (p: Post) => p.score + (followingIds.has(p.user_id) ? 500 : 0);
      list.sort((a, b) => boost(b) - boost(a));
    } else {
      list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    }
    return list;
  }, [posts, feedMode, search, followingIds]);
'@
$old = $old.Replace("`r`n","`n"); $new = $new.Replace("`r`n","`n")
$i=0; $pos=$c.IndexOf($old); while ($pos -ge 0) { $i++; $pos=$c.IndexOf($old,$pos+1) }
if ($i -ne 1) { Write-Host ("ANCHOR FAIL ("+$i+"): "+$old.Substring(0,[Math]::Min(50,$old.Length))) -ForegroundColor Red; exit 1 }
$c = $c.Replace($old, $new)

$old = @'
await Share.share({ message: `${author?.full_name || 'Someone'} on PlatinumCircles:\n\n${post.content}` });
'@
$new = @'
await Share.share({ message: `${author?.full_name || 'Someone'} on Platinum Circles:\n\n${post.content}\n\nOpen in the app: platinum-circles://post/${post.id}` });
'@
$old = $old.Replace("`r`n","`n"); $new = $new.Replace("`r`n","`n")
$i=0; $pos=$c.IndexOf($old); while ($pos -ge 0) { $i++; $pos=$c.IndexOf($old,$pos+1) }
if ($i -ne 1) { Write-Host ("ANCHOR FAIL ("+$i+"): "+$old.Substring(0,[Math]::Min(50,$old.Length))) -ForegroundColor Red; exit 1 }
$c = $c.Replace($old, $new)

$old = @'
await Share.share({ message: `${author?.full_name || 'Someone'} on PlatinumCircles:\n\n${captured.content}` });
'@
$new = @'
await Share.share({ message: `${author?.full_name || 'Someone'} on Platinum Circles:\n\n${captured.content}\n\nOpen in the app: platinum-circles://post/${captured.id}` });
'@
$old = $old.Replace("`r`n","`n"); $new = $new.Replace("`r`n","`n")
$i=0; $pos=$c.IndexOf($old); while ($pos -ge 0) { $i++; $pos=$c.IndexOf($old,$pos+1) }
if ($i -ne 1) { Write-Host ("ANCHOR FAIL ("+$i+"): "+$old.Substring(0,[Math]::Min(50,$old.Length))) -ForegroundColor Red; exit 1 }
$c = $c.Replace($old, $new)

if ($crlf) { $c = $c.Replace("`n","`r`n") }
[System.IO.File]::WriteAllText("src\screens\feed\FeedScreen.tsx", $c)
Write-Host "TWITTER ENGINE 1 APPLIED (7 edits) - press r in Metro" -ForegroundColor Green