# ===== UI PHASE 1: FEED TABS + INNOVATION, CLEAN TAB BAR, SMOOTH CAROUSEL =====
$ErrorActionPreference = "Continue"
if (-not (Test-Path "package.json")) { Write-Host "Run from project root." -ForegroundColor Red; exit 1 }
git add -A 2>&1 | Out-Null; git commit -m "Before UI Phase 1" 2>&1 | Out-Null
$ErrorActionPreference = "Stop"
function Edit-File($path, $pairs) {
  $c = [System.IO.File]::ReadAllText($path)
  $crlf = $c.Contains("`r`n")
  if ($crlf) { $c = $c.Replace("`r`n", "`n") }
  foreach ($p in $pairs) {
    $old = $p[0].Replace("`r`n", "`n"); $new = $p[1].Replace("`r`n", "`n")
    $i = 0; $pos = $c.IndexOf($old); while ($pos -ge 0) { $i++; $pos = $c.IndexOf($old, $pos + 1) }
    if ($i -ne 1) { Write-Host ("ANCHOR FAIL (" + $i + " matches): " + $old.Substring(0, [Math]::Min(60, $old.Length))) -ForegroundColor Red; exit 1 }
    $c = $c.Replace($old, $new)
  }
  if ($crlf) { $c = $c.Replace("`n", "`r`n") }
  [System.IO.File]::WriteAllText($path, $c)
  Write-Host ("edited " + $path + " (" + $pairs.Count + " changes)") -ForegroundColor Green
}

$pairs0 = @(
  ,@(@'
const [feedMode, setFeedMode] = useState<'forYou' | 'latest'>('forYou');
'@, @'
const [feedMode, setFeedMode] = useState<'forYou' | 'latest' | 'innovation'>('forYou');
'@)
  ,@(@'
  created_at?: string | null; media_url?: string | null; location?: string | null;

'@, @'
  created_at?: string | null; media_url?: string | null; location?: string | null;
  channel?: string | null;

'@)
  ,@(@'
        location: row.location ?? null,

'@, @'
        location: row.location ?? null,
        channel: row.channel ?? null,

'@)
  ,@(@'
  const displayPosts = useMemo(() => {
    let list = [...posts];
    const term = search.trim().toLowerCase();
    if (term) list = list.filter(p => (p.content || '').toLowerCase().includes(term));
    if (feedMode === 'forYou') list.sort((a, b) => b.score - a.score);
    return list;
  }, [posts, feedMode, search]);
'@, @'
  const displayPosts = useMemo(() => {
    let list = [...posts];
    if (feedMode === 'innovation') list = list.filter(p => p.channel === 'innovation');
    const term = search.trim().toLowerCase();
    if (term) list = list.filter(p => (p.content || '').toLowerCase().includes(term));
    if (feedMode === 'forYou') list.sort((a, b) => b.score - a.score);
    else list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return list;
  }, [posts, feedMode, search]);
'@)
  ,@(@'
      if (feedMode === 'latest') {
'@, @'
      if (feedMode === 'latest' || feedMode === 'innovation') {
'@)
  ,@(@'
              {(['forYou', 'latest'] as const).map(m => (
'@, @'
              {(['forYou', 'latest', 'innovation'] as const).map(m => (
'@)
  ,@(@'
{m === 'forYou' ? 'For You' : 'Latest'}
'@, @'
{m === 'forYou' ? 'For You' : m === 'latest' ? 'Latest' : 'Innovation'}
'@)
  ,@(@'
  const [exclusivePost, setExclusivePost] = useState(false);

'@, @'
  const [exclusivePost, setExclusivePost] = useState(false);
  const [innovationPost, setInnovationPost] = useState(false);

'@)
  ,@(@'
        is_exclusive: exclusivePost,
      };
'@, @'
        is_exclusive: exclusivePost,
        channel: innovationPost ? 'innovation' : null,
      };
'@)
  ,@(@'
      setComposerMedia([]);
      setExclusivePost(false);
      Keyboard.dismiss();
'@, @'
      setComposerMedia([]);
      setExclusivePost(false);
      setInnovationPost(false);
      Keyboard.dismiss();
'@)
  ,@(@'
onPress={() => { setComposerOpen(false); setComposerText(''); setComposerMedia([]); setExclusivePost(false); setMentionActive(false); Keyboard.dismiss(); }}
'@, @'
onPress={() => { setComposerOpen(false); setComposerText(''); setComposerMedia([]); setExclusivePost(false); setInnovationPost(false); setMentionActive(false); Keyboard.dismiss(); }}
'@)
  ,@(@'
This post will only be visible to verified school members
'@, @'
Only verified members can see this post
'@)
  ,@(@'
                {exclusivePost && (
                  <View style={s.exclusiveBanner}>
                    <Feather name="shield" size={13} color="#2563EB" />
                    <Text style={s.exclusiveBannerTxt}>Only verified members can see this post</Text>
                  </View>
                )}

'@, @'
                {exclusivePost && (
                  <View style={s.exclusiveBanner}>
                    <Feather name="shield" size={13} color="#2563EB" />
                    <Text style={s.exclusiveBannerTxt}>Only verified members can see this post</Text>
                  </View>
                )}
                {innovationPost && (
                  <View style={[s.exclusiveBanner, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
                    <Feather name="zap" size={13} color="#D97706" />
                    <Text style={[s.exclusiveBannerTxt, { color: '#B45309' }]}>Posting to Innovation — showcasing what Zimbabwe is building</Text>
                  </View>
                )}

'@)
  ,@(@'
                    <TouchableOpacity style={s.toolBtn} onPress={openCamera}><Feather name="camera" size={20} color="#6B7280" /></TouchableOpacity>

'@, @'
                    <TouchableOpacity style={s.toolBtn} onPress={openCamera}><Feather name="camera" size={20} color="#6B7280" /></TouchableOpacity>
                    <TouchableOpacity style={[s.toolBtn, innovationPost && s.toolBtnActive]} onPress={() => setInnovationPost(p => !p)}><Feather name="zap" size={20} color={innovationPost ? '#D97706' : '#6B7280'} /></TouchableOpacity>

'@)
)
Edit-File "src\screens\feed\FeedScreen.tsx" $pairs0

$pairs1 = @(
  ,@(@'
        tabBarStyle: {
          backgroundColor: '#FAFAFA', borderTopColor: '#EEEEEE',
          borderTopWidth: StyleSheet.hairlineWidth,
          height: tabBarHeight,
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
'@, @'
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.96)', borderTopColor: '#E5E5EA',
          borderTopWidth: StyleSheet.hairlineWidth,
          height: tabBarHeight,
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 10,
        },
'@)
  ,@(@'
                <Ionicons name={iconName} size={size} color={color} />
                <View style={s.dot}>
'@, @'
                <Ionicons name={iconName} size={size + 2} color={color} />
                <View style={s.dot}>
'@)
  ,@(@'
          return <Ionicons name={iconName} size={size} color={color} />;
'@, @'
          return <Ionicons name={iconName} size={size + 2} color={color} />;
'@)
)
Edit-File "src\navigation\AppNavigator.tsx" $pairs1

$pairs2 = @(
  ,@(@'
          onMomentumScrollEnd={onScroll}
          scrollEventThrottle={16}
          bounces={false}
'@, @'
          onMomentumScrollEnd={onScroll}
          scrollEventThrottle={16}
          decelerationRate="fast"
          overScrollMode="never"
          bounces={false}
'@)
  ,@(@'
      {items.length > 1 && (
        <View style={s.dots}>
          {items.map((_, i) => (
            <View key={i} style={[s.dot, i === active && s.dotActive]} />
          ))}
        </View>
      )}

'@, @'
      {items.length > 1 && (
        <View style={s.dots}>
          {items.map((_, i) => (
            <View key={i} style={[s.dot, i === active && s.dotActive]} />
          ))}
        </View>
      )}
      {items.length > 1 && (
        <View style={s.counterChip} pointerEvents="none">
          <Text style={s.counterTxt}>{active + 1}/{items.length}</Text>
        </View>
      )}

'@)
  ,@(@'
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
  },
  dotActive: {
    backgroundColor: '#111827',
    width: 18,
    borderRadius: 3,
  },
});
'@, @'
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
  },
  dotActive: {
    backgroundColor: '#111827',
    width: 6,
    borderRadius: 3,
  },
  counterChip: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
  },
  counterTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
'@)
)
Edit-File "src\components\MediaRenderer.tsx" $pairs2

Write-Host ""; Write-Host "==== VERIFICATION ====" -ForegroundColor Cyan
$ok1 = Select-String -Path "src\screens\feed\FeedScreen.tsx" -Pattern "innovation" -Quiet
$ok2 = Select-String -Path "src\navigation\AppNavigator.tsx" -Pattern "tabBarShowLabel" -Quiet
$ok3 = Select-String -Path "src\components\MediaRenderer.tsx" -Pattern "counterChip" -Quiet
if ($ok1 -and $ok2 -and $ok3) { Write-Host "UI PHASE 1 CLEAN - run the SQL, then press r in Metro" -ForegroundColor Green } else { Write-Host "LEFTOVERS - paste this output to Claude" -ForegroundColor Red }