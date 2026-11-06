'use strict';
// Apply the remaining presentation changes to the independently inspected branch.
// Exact Git blob preimages prevent overwriting concurrent edits. No backend writes.
const fs = require('node:fs');
const crypto = require('node:crypto');
const changes = new Map();
const expected = {
  'src/screens/feed/FeedScreen.tsx': '2f6019a9f995e6426750ad8eca8f03b2928bf1b3',
  'src/screens/feed/LiveStreamsScreen.tsx': 'f6c905e4c38e6f73224ab42326c2ed790a1f2ef6',
  'src/screens/feed/NewLiveScreen.tsx': 'fa4d028b0e1810ec54fffc55b253a27289324105',
  'src/components/LiveStudio.tsx': '19e0e04dfcc8305605ccbec2d61ebd7a5c6306b6',
  'src/components/LiveUi.tsx': 'f897ca8082124e5feb4364b47c5a20fffb515651',
  'tests/live-ui-repair.test.cjs': '3b90372be1543723d6eee9a2e16215b40105b121',
};
for (const [file, sha] of Object.entries(expected)) {
  const bytes = fs.readFileSync(file);
  const actual = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (actual !== sha) throw new Error(`Source drift: ${file}. No files written.`);
  changes.set(file, bytes.toString('utf8'));
}
function replace(file, before, after) {
  const source = changes.get(file);
  if (source.split(before).length !== 2) throw new Error(`Expected one reviewed match in ${file}`);
  changes.set(file, source.replace(before, after));
}
const feed = 'src/screens/feed/FeedScreen.tsx';
let source = changes.get(feed);
const start = source.indexOf('            <View style={s.tabRow}>');
const end = source.indexOf('            </View>\n          </View>', start);
if (start < 0 || end < start || !source.slice(start,end).includes('testID="feed-live-tab"')) throw new Error('Feed tab boundary drift');
changes.set(feed, "import { FeedNavigationTabs } from '../../components/live/FeedNavigationTabs';\n" + source.slice(0,start) +
  "            <View style={s.tabRow}>\n              <FeedNavigationTabs selected={feedMode} onSelect={setFeedMode} onLive={() => navigation.navigate('LiveStreams')} />\n" + source.slice(end));
const ui = 'src/components/LiveUi.tsx';
replace(ui, "onBack, onCreate, onClips }: {", "onBack, onCreate, onClips, onSchedule }: {");
replace(ui, 'onBack(): void; onCreate(): void; onClips(): void;', 'onBack(): void; onCreate(): void; onClips(): void; onSchedule?(): void;');
replace(ui, 'const [filtersOpen, setFiltersOpen] = useState(false), [searchOpen, setSearchOpen] = useState(false);',
  'const [filtersOpen, setFiltersOpen] = useState(false), [searchOpen, setSearchOpen] = useState(false), [toolsOpen, setToolsOpen] = useState(false);');
replace(ui, '<Pressable accessibilityRole="button" accessibilityLabel="Your clip library" onPress={onClips} style={styles.iconButton}><Feather name="film" size={21} color={t.ink.primary} /></Pressable>',
  '<Pressable accessibilityRole="button" accessibilityLabel="Your Live tools" accessibilityState={{ expanded: toolsOpen }} onPress={() => setToolsOpen(true)} style={styles.iconButton}><Feather name="more-horizontal" size={23} color={t.ink.primary} /></Pressable>');
replace(ui, '    <Pressable accessibilityRole="button" accessibilityLabel="Go live"',
  '    <View style={styles.actions}>\n    <Pressable accessibilityRole="button" accessibilityLabel="Start live"');
replace(ui, 'style={[styles.create, { backgroundColor: t.ink.primary }]}', 'style={[styles.create, { backgroundColor: t.ink.primary, flex: 1 }]}');
replace(ui, '<LiveIcon size={24} color={t.surface.raised} />\n      <View style={{ flex: 1, gap: 3 }}><Text style={{ color: t.surface.raised, fontWeight: \'700\', fontSize: 17 }}>Go live</Text><Text style={{ color: t.surface.raised, fontSize: 12 }}>Preview your camera before you start</Text></View>\n      <Feather name="chevron-right" size={21} color={t.surface.raised} />',
  '<LiveIcon size={19} color={t.surface.raised} /><Text style={{ color: t.surface.raised, fontWeight: \'700\', fontSize: 15 }}>Start live</Text>');
replace(ui, '    </Pressable>\n    <View accessibilityRole="tablist"',
  '    </Pressable>\n    <Pressable accessibilityRole="button" accessibilityLabel="Schedule a live stream" onPress={onSchedule || onCreate} style={styles.schedule}><Feather name="calendar" size={18} color={t.ink.primary}/><Text style={{color:t.ink.primary,fontSize:14,fontWeight:\'600\'}}>Schedule</Text></Pressable>\n    </View>\n    <View accessibilityRole="tablist"');
replace(ui, '    </Modal>\n  </View>;\n}', `    </Modal>
    <Modal visible={toolsOpen} transparent animationType="slide" onRequestClose={() => setToolsOpen(false)}>
      <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#0008'}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Live tools" onPress={() => setToolsOpen(false)} style={StyleSheet.absoluteFill}/>
        <SafeAreaView edges={['bottom','left','right']} accessibilityViewIsModal style={{backgroundColor:t.surface.raised,borderTopLeftRadius:24,borderTopRightRadius:24,paddingHorizontal:20,paddingTop:12}}>
          <View style={styles.header}><Text accessibilityRole="header" style={{flex:1,color:t.ink.primary,fontSize:20,fontWeight:'700'}}>Your Live tools</Text><Pressable accessibilityRole="button" accessibilityLabel="Close tools" onPress={() => setToolsOpen(false)} style={styles.iconButton}><Feather name="x" size={22} color={t.ink.primary}/></Pressable></View>
          <Pressable accessibilityRole="button" accessibilityLabel="My clips" onPress={() => {setToolsOpen(false);onClips();}} style={styles.choice}><Text style={{color:t.ink.primary,fontSize:16}}>My clips</Text><Feather name="film" size={20} color={t.ink.primary}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="My streams" onPress={() => {setToolsOpen(false);onFilter('mine');onView('live');}} style={styles.choice}><Text style={{color:t.ink.primary,fontSize:16}}>My streams</Text><Feather name="video" size={20} color={t.ink.primary}/></Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  </View>;
}`);
replace(ui, "  create: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },",
  "  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },\n  schedule: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 },\n  create: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 10 },");
const dir = 'src/screens/feed/LiveStreamsScreen.tsx';
replace(dir, "onCreate={()=>navigation.navigate('NewLive')} onClips", "onCreate={()=>navigation.navigate('NewLive')} onSchedule={()=>navigation.navigate('NewLive',{schedule:true})} onClips");
replace(dir, "'Start your own live, or explore Upcoming and Replays.'}</Text></>}",
  "'Start your own live, or explore Upcoming and Replays.'}</Text>{owner&&!data.error&&!data.setup?<View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:12,marginTop:16}}><TouchableOpacity accessibilityRole=\"button\" accessibilityLabel=\"Start your first live\" onPress={()=>navigation.navigate('NewLive')} style={{minHeight:44,paddingHorizontal:16,borderRadius:12,justifyContent:'center',backgroundColor:t.ink.primary}}><Text style={{color:t.surface.raised,fontWeight:'700'}}>Start live</Text></TouchableOpacity>{view!=='scheduled'?<TouchableOpacity accessibilityRole=\"button\" accessibilityLabel=\"Browse upcoming streams\" onPress={()=>{setFilter('for_you');setView('scheduled');}} style={{minHeight:44,paddingHorizontal:12,justifyContent:'center'}}><Text style={{color:t.ink.primary,fontWeight:'600'}}>See upcoming</Text></TouchableOpacity>:null}</View>:null}</>}");
const form = 'src/screens/feed/NewLiveScreen.tsx';
replace(form, 'type Props = { navigation:', 'type Props = { route?: {params?: {schedule?: boolean}}; navigation:');
replace(form, 'function NewLiveScreen({ navigation }: Props)', 'function NewLiveScreen({ navigation, route }: Props)');
replace(form, 'const [more, setMore] = useState(false),', 'const [scheduleMode, setScheduleMode] = useState(route?.params?.schedule===true);\n  const [more, setMore] = useState(route?.params?.schedule===true),');
replace(form, 'const scheduled = !!schedule.trim();', 'const scheduled = scheduleMode || !!schedule.trim();');
replace(form, 'const time = schedule.trim() ? Date.parse(schedule) : null;', 'const time = scheduled ? Date.parse(schedule) : null;');
replace(form, '          <View style={{ gap: 7 }}><Text', '          <View style={s.options}><Text style={{flex:1,color:t.ink.primary}}>Schedule for later</Text><Switch accessibilityLabel="Schedule for later" value={scheduled} disabled={busy} onValueChange={value=>{setScheduleMode(value);if(!value)setSchedule(\'\');}}/></View>\n          <View style={{ gap: 7 }}><Text');
const studio = 'src/components/LiveStudio.tsx';
replace(studio, 'else { await instance.setLocalVideo(true); await instance.setLocalAudio(true); update(); }', 'else { await instance.setLocalVideo(true); update(); }');
replace(studio, 'Your preview is not being broadcast. Tap Go live when you are ready.', 'Your preview is not being broadcast. Your microphone starts muted. Unmute when ready, then tap Go live.');
const tests = 'tests/live-ui-repair.test.cjs';
replace(tests, "by(tree, 'accessibilityLabel', 'Go live').props.onPress();", "by(tree, 'accessibilityLabel', 'Start live').props.onPress();");
replace(tests, 'const props = { navigation: { goBack() {}, replace: (...args) => routes.push(args) } };', 'const props = { route: {params: {schedule: options.schedule===true}}, navigation: { goBack() {}, replace: (...args) => routes.push(args) } };');
const oldTest = changes.get(tests).slice(changes.get(tests).indexOf("test('feed Live tab reserves"), changes.get(tests).indexOf("test('Go live is above"));
if (!oldTest.startsWith("test('feed Live tab reserves")) throw new Error('Missing feed test');
replace(tests, oldTest, String.raw`test('feed uses the same shared component for all five tabs', () => {
  assert.match(read('src/screens/feed/FeedScreen.tsx'), /<FeedNavigationTabs selected=\{feedMode\}/);
  const source=read('src/components/live/FeedNavigationTabs.tsx');
  assert.match(source, /fontSize: 15/);assert.match(source,/height: 3/);assert.match(source,/marginTop: 5/);
  const h=hooks();const ui=load('src/components/live/FeedNavigationTabs.tsx',{...common(h),'../../theme/useTheme':{useTheme:()=>({t:theme})},'./LiveIcon':{LiveIcon:'LiveIcon'}});
  let selected='';const tree=h.render(ui.FeedNavigationTabs,{selected:'latest',onSelect:v=>{selected=v;},onLive:()=>{selected='live';}});
  const tabs=nodes(tree).filter(n=>n.props?.accessibilityRole==='tab');assert.equal(tabs.length,5);
  for(const tab of tabs)assert.strictEqual(tab.props.style,tabs[0].props.style);
  by(tree,'testID','feed-tab-live').props.onPress();assert.equal(selected,'live');
  by(tree,'testID','feed-tab-discover').props.onPress();assert.equal(selected,'discover');
});
`);
replace(tests, ' await instance.setLocalAudio\\(true\\);', '');
changes.set(tests, changes.get(tests) + String.raw`
test('Schedule entry never opens an unscheduled camera preview',async()=>{
  const app=quickStart({schedule:true});app.render();await app.h.settle();const tree=app.render();
  assert.ok(by(tree,'accessibilityLabel','Scheduled date and time, optional'));
  assert.equal(by(tree,'testID','live-preview-button').props.accessibilityLabel,'Schedule stream');
  by(tree,'testID','live-preview-button').props.onPress();await app.h.settle();assert.equal(app.calls.length,0);
});
test('Live tools exposes clips without crowding the directory',()=>{
  const h=hooks(),ui=load('src/components/LiveUi.tsx',{...common(h),'./SafeArea':{SafeAreaView:'SafeAreaView'},'../theme/useTheme':{useTheme:()=>({t:theme})},'../../shared/liveDirectory':directory});
  let clips=0,schedules=0;const props={filter:'for_you',view:'live',topic:'all',query:'',onFilter(){},onView(){},onTopic(){},onQuery(){},onBack(){},onCreate(){},onClips(){clips++;},onSchedule(){schedules++;}};
  let tree=h.render(ui.LiveDirectoryHeader,props);by(tree,'accessibilityLabel','Schedule a live stream').props.onPress();assert.equal(schedules,1);
  by(tree,'accessibilityLabel','Your Live tools').props.onPress();tree=h.render(ui.LiveDirectoryHeader,props);
  assert.equal(nodes(tree).filter(n=>n.type==='Modal')[1].props.visible,true);by(tree,'accessibilityLabel','My clips').props.onPress();assert.equal(clips,1);
});
test('preview retains signed studio events and never unmutes automatically',()=>{
  const source=read('src/components/LiveStudio.tsx');assert.match(source,/useLiveStudioEvents\(sessionId, owner, onChanged\)/);
  const preview=source.slice(source.indexOf('const preview ='),source.indexOf('const sendControl'));
  assert.doesNotMatch(preview,/setLocalAudio\(true\)/);assert.doesNotMatch(preview,/liveControl\(/);
});
`);
for (const [file, text] of changes) fs.writeFileSync(file,text);
console.log(JSON.stringify({changed:[...changes.keys()],backendChanged:false}));
