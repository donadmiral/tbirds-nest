// One-time, exact-preimage UI repair. No backend, secrets or feature gates change.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const changes = [];
function edit(file, expected, transform) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const blob = crypto.createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex');
  if (blob !== expected) throw new Error(`Source changed; refusing to overwrite ${file}`);
  const next = transform(source);
  if (next === source) throw new Error(`No change produced for ${file}`);
  changes.push([file, next]);
}
function once(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Expected one source anchor: ${before.slice(0, 100)}`);
  return source.replace(before, after);
}
edit('src/screens/feed/FeedScreen.tsx', 'f8805b96c617a1dd6bc0dd87f2c503a799c8d4f5', source => {
  source = once(source, "import { Feather, Ionicons } from '@expo/vector-icons';", "import { Feather, Ionicons } from '@expo/vector-icons';\nimport { LiveIcon } from '../../components/LiveUi';");
  const before = `<TouchableOpacity accessibilityRole="button" accessibilityLabel="Live streams" onPress={() => navigation.navigate('LiveStreams')} style={{ minWidth: 62, minHeight: 44, flexDirection:'row', gap:4, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="radio" size={17} color={t.ink.primary} /><Text style={{fontSize:14,fontWeight:'600',color:t.ink.primary}}>Live</Text>
              </TouchableOpacity>`;
  return once(source, before, `<TouchableOpacity testID="feed-live-tab" accessibilityRole="button" accessibilityLabel="Live streams" onPress={() => navigation.navigate('LiveStreams')} style={{ minWidth: 62, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><LiveIcon size={17} color={t.ink.primary} /><Text style={{ fontSize: 15, fontWeight: '500', color: t.ink.secondary, letterSpacing: -0.2 }}>Live</Text></View>
                <View style={{ height: 3, width: 20, borderRadius: 2, marginTop: 5, backgroundColor: 'transparent' }} />
              </TouchableOpacity>`);
});
edit('src/screens/feed/LiveStreamsScreen.tsx', '91edba3a2144fdeaa27e2c2d3da95978d2918248', source => {
  source = once(source, "import { Feather } from '@expo/vector-icons';", "import { LiveDirectoryHeader, LiveIcon } from '../../components/LiveUi';");
  source = source.replace('FlatList, ScrollView, ActivityIndicator, TextInput', 'FlatList, ActivityIndicator');
  source = source.replace('LIVE_TOPICS, isLiveSetupMissing', 'isLiveSetupMissing');
  const start = source.indexOf('  const chips=');
  const end = source.indexOf('  return <SafeAreaView', start);
  if (start < 0 || end < 0) throw new Error('Missing directory chips anchor');
  source = source.slice(0, start) + source.slice(end);
  const a = source.indexOf("    <View style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10}}>");
  const b = source.indexOf('    {data.key===scope&&data.setup?', a);
  if (a < 0 || b < 0) throw new Error('Missing directory header boundaries');
  source = source.slice(0, a) + `    <LiveDirectoryHeader filter={filter} view={view} topic={topic} query={query} onFilter={setFilter} onView={setView} onTopic={setTopic} onQuery={setQuery} onBack={()=>navigation.goBack()} onCreate={()=>navigation.navigate('NewLive')} onClips={()=>navigation.navigate('LiveClips')}/>
` + source.slice(b);
  source = source.replace('<Feather name="radio" size={44} color={t.ink.muted}/>', '<LiveIcon size={44} color={t.ink.muted}/>');
  source = source.replace('<Feather name="radio" size={36} color={t.ink.muted}/>', '<LiveIcon size={36} color={t.ink.muted}/>');
  source = once(source, "{query?'No matching streams':owner?'No streams here yet':'Sign in to discover streams'}", "{data.error?'Streams could not load':data.setup?'Live is being prepared':query?'No matching streams':owner?'No streams right now':'Sign in to discover streams'}");
  source = once(source, 'Try another topic or check back for a live session.', '{data.error?\'Pull down to retry.\':\'Start your own live, or explore Upcoming and Replays.\'}');
  return source;
});
edit('src/screens/feed/LiveSessionScreen.tsx', 'd859e6fd53fbdbda049ac94d3f9815cad0bd94ed', source => {
  source = once(source, "import { LiveStudio } from '../../components/LiveStudio';", "import { LiveStudio } from '../../components/LiveStudio';\nimport { LiveIcon } from '../../components/LiveUi';");
  source = once(source, 'sessionId?: string }', 'sessionId?: string; openStudio?: boolean; previewCamera?: boolean }');
  source = once(source, "[tab, setTab] = useState('Chat')", "[tab, setTab] = useState(route.params?.openStudio ? 'Studio' : 'Chat')");
  source = once(source, 'const [studioOpened,setStudioOpened]=useState(false);', 'const [studioOpened,setStudioOpened]=useState(route.params?.openStudio===true);');
  source = once(source, "setTab('Chat'); setStudioOpened(false);", "setTab(route.params?.openStudio ? 'Studio' : 'Chat'); setStudioOpened(route.params?.openStudio===true);");
  source = once(source, "tabs = ['Chat','Polls & Q&A','Clips',...(stage?['Studio']:[]),", "tabs = [...(stage?['Studio']:[]),'Chat','Polls & Q&A','Clips',");
  source = once(source, '{ownPlayer&&playback.expanded?', "{tab==='Studio'&&stage?null:ownPlayer&&playback.expanded?");
  source = once(source, '<Feather name="radio" size={42} color={t.ink.muted}/>', '<LiveIcon size={42} color={t.ink.muted}/>');
  source = once(source, "stage?'Open Studio to preview your camera and prepare the broadcast.'", "stage?'Your stream is not live yet. Open the camera preview to get started.'");
  const placeholderEnd = "'Playback is not available for this session yet.'}</Text>}</View>}";
  source = once(source, placeholderEnd, "'Playback is not available for this session yet.'}</Text>}{stage&&['draft','scheduled','backstage'].includes(session.state)?button('Open camera preview',()=>{setTab('Studio');setStudioOpened(true);},false):null}</View>}");
  source = once(source, 'sessionId={id} canControl={manages} streamState={session.state}', 'sessionId={id} autoPreview={route.params?.previewCamera===true} canControl={manages} streamState={session.state}');
  // Hosts see the camera, not a second empty viewer and duplicate title card.
  for (const pattern of [/^        (<View style={\[s\.pad,\{gap:5\}\]}>[^\n]*<\/View>)$/m, /^        (<View style={\[s\.row,s\.pad\]}>[^\n]*<\/View>)$/m]) {
    if (!pattern.test(source)) throw new Error('Missing studio chrome anchor');
    source = source.replace(pattern, "        {tab!=='Studio'?$1:null}");
  }
  // Underline section navigation, not another row of filled pills.
  source = once(source, "style={[s.button,{backgroundColor:tab===name?t.ink.primary:t.surface.sunken}]}><Text style={{color:tab===name?t.surface.raised:t.ink.primary,fontWeight:'600'}}>", "style={[s.button,{borderRadius:0,borderBottomWidth:2,borderBottomColor:tab===name?t.ink.primary:'transparent'}]}><Text style={{color:tab===name?t.ink.primary:t.ink.secondary,fontWeight:'600'}}>");
  return source;
});
edit('src/components/LiveStudio.tsx', 'c5a82e4417f6f0dc0e6617a01ed827da3c4d9c82', source => {
  source = once(source, "import Daily,", "import { Feather } from '@expo/vector-icons';\nimport { LiveIcon } from './LiveUi';\nimport Daily,");
  source = once(source, 'sessionId, canControl, streamState, onChanged }: { sessionId: string;', 'sessionId, canControl, streamState, onChanged, autoPreview = false }: { sessionId: string; autoPreview?: boolean;');
  source = once(source, "const [preset, setPreset] = useState('host'), [selected, setSelected] = useState<string[]>([]);", "const [preset, setPreset] = useState('host'), [selected, setSelected] = useState<string[]>([]);\n  const [toolsOpen, setToolsOpen] = useState(false), autoPreviewUsed = useRef(false);");
  source = once(source, "if (version !== generation.current) { try { await instance.leave(); await instance.destroy(); } catch {} }", "if (version !== generation.current) { try { await instance.leave(); await instance.destroy(); } catch {} }\n      else { await instance.setLocalVideo(true); await instance.setLocalAudio(true); update(); }");
  source = once(source, "  const sendControl = async (action: 'start' | 'stop' | 'scene') => {", "  useEffect(() => {\n    if (autoPreview && !autoPreviewUsed.current) { autoPreviewUsed.current = true; void preview(); }\n  }, [autoPreview]);\n  const sendControl = async (action: 'start' | 'stop' | 'scene') => {");
  const a = source.indexOf('  const button = (title: string,');
  if (a < 0) throw new Error('Missing studio presentation boundary');
  return source.slice(0, a) + `  const button = (title: string, action: () => void, disabled = busy) => <TouchableOpacity key={title} accessibilityRole="button" disabled={disabled} onPress={action} style={[s.button, { backgroundColor: t.surface.sunken, opacity: disabled ? 0.5 : 1 }]}><Text style={{ color: t.ink.primary, fontWeight: '600', fontSize: 13 }}>{title}</Text></TouchableOpacity>;
  const live = ['live', 'starting', 'reconnecting'].includes(streamState);
  const local = participants.find(p => p.local);
  const blocked = busy || !selected.length || (!local?.audio && !local?.video && !sharing) || ['starting','ending','ended','cancelled'].includes(streamState);
  const endBroadcast = () => Alert.alert('End this live?', 'Viewers will stop receiving live video.', [{ text: 'Keep streaming', style: 'cancel' }, { text: 'End live', style: 'destructive', onPress: () => void sendControl('stop') }]);
  const mediaButton = (label: string, icon: React.ComponentProps<typeof Feather>['name'], action: () => void) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={action} style={[s.mediaButton, { backgroundColor: t.surface.sunken, opacity: busy ? 0.5 : 1 }]}><Feather name={icon} size={21} color={t.ink.primary}/><Text style={{color:t.ink.secondary,fontSize:11,textAlign:'center'}}>{label}</Text></TouchableOpacity>;
  return <View style={{ gap: 14 }}>
    <View style={{flexDirection:'row',alignItems:'center',gap:8}}><LiveIcon color={t.ink.primary}/><Text accessibilityRole="header" style={{ color: t.ink.primary, fontWeight: '700', fontSize: 20 }}>{live ? 'Your live' : 'Camera preview'}</Text><Text style={{marginLeft:'auto',color:live?'#C43146':t.ink.secondary,fontSize:12,fontWeight:'600'}}>{streamState==='starting'?'Starting…':streamState==='reconnecting'?'Reconnecting…':streamState==='live'?'LIVE':'Not live'}</Text></View>
    {joined ? <View style={s.preview}><RemoteCallMedia participants={participants} /></View> : <View style={[s.preview, s.empty, { backgroundColor: t.surface.sunken }]}><LiveIcon size={42} color={t.ink.muted}/><Text style={{ color: t.ink.secondary, textAlign:'center' }}>Preview your camera and microphone</Text>{button(busy ? 'Connecting…' : 'Preview camera', () => void preview(), busy || (callState !== 'idle' && callState !== 'failed'))}</View>}
    {joined ? <View style={s.mediaRow}>
      {mediaButton(local?.audio ? 'Mute' : 'Unmute',local?.audio?'mic':'mic-off',()=>void media('audio'))}
      {mediaButton(local?.video ? 'Camera off' : 'Camera on',local?.video?'video':'video-off',()=>void media('video'))}
      {mediaButton('Flip','refresh-cw',()=>void media('flip'))}
      {mediaButton('Leave','log-out',()=>void stop())}
    </View> : null}
    {canControl && joined ? <>
      <TouchableOpacity testID="live-start-button" accessibilityRole="button" accessibilityLabel={live?'End live':'Go live'} disabled={live ? busy || streamState==='starting' : blocked} onPress={live ? endBroadcast : ()=>void sendControl('start')} style={[s.primary,{backgroundColor:live?'#B92536':t.ink.primary,opacity:(live?busy||streamState==='starting':blocked)?0.5:1}]}><LiveIcon color={t.surface.raised}/><Text style={{color:t.surface.raised,fontSize:17,fontWeight:'700'}}>{streamState==='starting'?'Starting…':streamState==='ending'?'Ending…':busy?'Please wait…':live?'End live':'Go live'}</Text></TouchableOpacity>
      {!live?<Text style={{color:t.ink.secondary,textAlign:'center',fontSize:12}}>Your preview is not being broadcast. Tap Go live when you are ready.</Text>:null}
    </> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: t.ink.primary, lineHeight: 20 }}>{error}</Text> : null}
    {joined ? <TouchableOpacity accessibilityRole="button" accessibilityState={{expanded:toolsOpen}} onPress={()=>setToolsOpen(!toolsOpen)} style={s.tools}><Feather name="sliders" size={18} color={t.ink.primary}/><Text style={{color:t.ink.primary,flex:1}}>Stream tools</Text><Feather name={toolsOpen?'chevron-up':'chevron-down'} size={18} color={t.ink.secondary}/></TouchableOpacity>:null}
    {joined && toolsOpen ? <View style={{gap:12}}>
      {canShare ? button(sharing ? 'Stop sharing' : 'Share screen or game', () => void media('share')) : <Text style={{ color: t.ink.secondary, fontSize: 12 }}>Screen sharing is unavailable on this device build.</Text>}
      {canControl ? <>
        <Text style={{ color: t.ink.primary, fontWeight: '700' }}>Layout</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{['host','grid','interview','game','screen'].map(value => <TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{ selected: preset === value }} onPress={() => setPreset(value)} style={[s.button, { borderWidth: 1, borderColor: preset === value ? t.ink.primary : t.surface.sunken }]}><Text style={{ color: t.ink.primary, textTransform: 'capitalize' }}>{value}</Text></TouchableOpacity>)}</ScrollView>
        <Text style={{ color: t.ink.secondary, fontSize: 13 }}>{preset === 'grid' ? 'Select the cameras to put on air.' : 'Choose your featured camera.'}</Text>
        <View style={s.controls}>{participants.map(p => <TouchableOpacity key={p.session_id} accessibilityRole="button" accessibilityState={{ selected: selected.includes(p.user_id || '') }} onPress={() => { if (!p.user_id) return; setSelected(current => preset === 'grid' ? current.includes(p.user_id!) ? current.filter(id => id !== p.user_id) : [...current, p.user_id!].slice(0,12) : [p.user_id!]); }} style={[s.button, { backgroundColor: selected.includes(p.user_id || '') ? t.ink.primary : t.surface.sunken }]}><Text style={{ color: selected.includes(p.user_id || '') ? t.surface.raised : t.ink.primary }}>{p.local ? 'Your camera' : p.user_name || 'Guest camera'}</Text></TouchableOpacity>)}</View>
        {live?button('Apply layout',()=>void sendControl('scene'),busy||!selected.length):null}
      </>:null}
    </View> : null}
  </View>;
}
const s = StyleSheet.create({ preview: { height: 300, borderRadius: 18, overflow: 'hidden', backgroundColor:'#000' }, empty: { alignItems: 'center', justifyContent: 'center', gap: 14, padding:20 }, controls: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, mediaRow:{flexDirection:'row',gap:8},mediaButton:{flex:1,minHeight:62,alignItems:'center',justifyContent:'center',gap:5,borderRadius:12,paddingVertical:8},primary:{minHeight:54,borderRadius:14,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:10,padding:14},tools:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10} });
`;
});
// Only write after every original file passes its exact-preimage checks.
for (const [file, content] of changes) fs.writeFileSync(path.join(root, file), content);
console.log(JSON.stringify({ changed: changes.map(([file]) => file), backendChanged: false }));
