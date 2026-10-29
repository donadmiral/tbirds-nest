const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
function walk(node, out = []) { if (Array.isArray(node)) node.forEach(n => walk(n, out)); else if (node && typeof node === 'object') { out.push(node); walk(node.props?.children, out); } return out; }
const flat = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const ticks = async () => { await Promise.resolve(); await Promise.resolve(); };
function load(file, { width = 320, height = 568, thumbnail = async () => ({ uri: 'frame.jpg' }), transform } = {}) {
  let cursor = 0, timerId = 0;
  const state = [], effects = [], dependencies = [], cleanups = [], timers = new Map();
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useRef(value) { const i = cursor++; return state[i] ??= { current: value }; },
    useMemo(fn) { cursor++; return fn(); }, useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) { const i = cursor++; const prev = dependencies[i]; if (!prev || !deps || deps.some((v, j) => v !== prev[j])) { dependencies[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  hooks.default = hooks;
  const native = Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'ScrollView', 'Modal', 'TextInput', 'Pressable', 'Image', 'FlatList', 'KeyboardAvoidingView'].map(name => [name, name]));
  Object.assign(native, { StyleSheet: { create: x => x, hairlineWidth: 1, absoluteFill: { position: 'absolute' } }, Platform: { OS: 'ios' }, useWindowDimensions: () => ({ height, width }), Dimensions: { get: () => ({ height, width }) }, PanResponder: { create: handlers => ({ panHandlers: handlers }) }, Animated: { Value: class { constructor(v) { this.value = v; } } } });
  const module = { exports: {} };
  let source = fs.readFileSync(path.join(root, file), 'utf8'); if (transform) source = transform(source);
  vm.runInNewContext(compile(source), { module, exports: module.exports,
    require(name) {
      if(name.endsWith('/postVoiceEffects')){const shared={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.join(root,'shared/postVoiceEffects.ts'),'utf8')),shared);return shared.exports;}
      if(name.endsWith('/postMediaEditing')){const shared={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.join(root,'shared/postMediaEditing.ts'),'utf8')),shared);return shared.exports;}
      if (name.endsWith('/storyPresentation')) { const shared={exports:{}}; vm.runInNewContext(compile(fs.readFileSync(path.join(root,'shared/storyPresentation.ts'),'utf8')),shared); return shared.exports; }
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return runtime;
      if (name === 'react-native') return native;
      if (name === '@expo/vector-icons') return { Feather: 'Feather' };
      if (name.endsWith('/useTheme')) return { themedSheet: fn => fn({ ink: { inverse: '#000', primary: '#FFF' } }) };
      if (name.endsWith('/SafeArea')) return { useSafeAreaInsets: () => ({ top: 20, bottom: 0 }) };
      if (name.endsWith('/StoryFilters')) return { STORY_FILTERS:[],FilterLayer: 'FilterLayer', FilterPickerSheet: 'FilterPickerSheet' };
      if (name.endsWith('/storyPanels')) return { MiniSlider:'MiniSlider',AdjustLayer: 'AdjustLayer', AdjustPanel: 'AdjustPanel' };
      if (name === 'expo-video-thumbnails') return { getThumbnailAsync: thumbnail };
      if (name === 'expo-video') return { VideoView: 'VideoView', useVideoPlayer: () => ({ play() {}, pause() {} }) };
      if (name.endsWith('/supabase')) return { supabase: {} };
      return { __esModule: true, default: name, ...Object.fromEntries(['Heart', 'MessageCircle', 'Repeat2', 'Bookmark', 'VolumeX', 'BadgeCheck'].map(n => [n,n])) };
    }, setTimeout(fn) { const id = ++timerId; timers.set(id, () => { timers.delete(id); return fn(); }); return id; }, clearTimeout(id) { timers.delete(id); },
    TIER_COLORS: {}, Heart: 'Heart', MessageCircle: 'MessageCircle', Repeat2: 'Repeat2', Bookmark: 'Bookmark', VolumeX: 'VolumeX', BadgeCheck: 'BadgeCheck',
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  return { timers, render(props, name = 'default') { cursor = 0; const tree = module.exports[name](props); while (effects.length) effects.shift()(); return tree; }, unmount() { cleanups.forEach(fn => fn?.()); } };
}
const editorFile = 'src/components/PostMediaEditSheet.tsx';
test('video cover dragging uses the current trim window, width and callback after a rerender', () => {
  const old = [], current = [], view = load(editorFile);
  view.render({ uri: 'a.mp4', durationSec: 20, start: 0, end: 10, at: 0, width: 350, onChange: v => old.push(v) }, 'CoverStrip');
  const tree = view.render({ uri: 'a.mp4', durationSec: 20, start: 4, end: 8, at: 4, width: 250, onChange: v => current.push(v) }, 'CoverStrip');
  const track = walk(tree).find(n => n.props.accessibilityLabel === 'Video cover frame');
  track.props.onPanResponderGrant(); track.props.onPanResponderMove({}, { dx: 204 }); track.props.onPanResponderRelease();
  assert.deepEqual(old, []); assert.equal(current.at(-1), 7.95);
  track.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
  assert.ok(current.at(-1) >= 4 && current.at(-1) < 8);
  view.unmount();
});
test('selected covers clamp into the trimmed clip and never request the exact end-of-file frame', () => {
  const changed = [], view = load(editorFile);
  view.render({ uri: 'a.mp4', durationSec: 10, start: 7, end: 10, at: 10, width: 40, onChange: v => changed.push(v) }, 'CoverStrip');
  assert.deepEqual(changed, [9.95]);
  const tree = view.render({ uri: 'a.mp4', durationSec: 10, start: 7, end: 10, at: 9.95, width: 40, onChange() {} }, 'CoverStrip');
  const track = walk(tree).find(n => n.props.accessibilityLabel === 'Video cover frame');
  track.props.onPanResponderGrant(); track.props.onPanResponderMove({}, { dx: 10 });
  assert.ok(Number.isFinite(track.props.accessibilityValue.now));
  view.unmount();
});
test('a late thumbnail from the previous media cannot replace the current cover', async () => {
  const pending = [];
  const view = load(editorFile, { thumbnail: (uri, options) => options.quality === 0.3 ? Promise.resolve({ uri: 'strip-' + uri }) : new Promise(resolve => pending.push({ uri, resolve })) });
  const props = { durationSec: 10, start: 0, end: 10, at: 3, width: 320, onChange() {} };
  view.render({ ...props, uri: 'old.mp4' }, 'CoverStrip');
  const oldPromise = [...view.timers.values()][0]();
  view.render({ ...props, uri: 'new.mp4' }, 'CoverStrip');
  const newPromise = [...view.timers.values()][0]();
  pending.find(x => x.uri === 'new.mp4').resolve({ uri: 'new-cover.jpg' }); await newPromise; await ticks();
  pending.find(x => x.uri === 'old.mp4').resolve({ uri: 'old-cover.jpg' }); await oldPromise; await ticks();
  const images = walk(view.render({ ...props, uri: 'new.mp4' }, 'CoverStrip')).filter(n => n.type === 'Image').map(n => n.props.source?.uri);
  assert.ok(images.includes('new-cover.jpg')); assert.ok(!images.includes('old-cover.jpg'));
  view.unmount();
});
test('short iPhones keep post editor actions pinned and all media tools horizontally reachable', () => {
  const view = load(editorFile), saved = [], props = { visible: true, uri: 'clip.mp4', mediaType: 'video', width: 1080, height: 1920, durationSec: 10, onCancel() {}, onDone: edit => saved.push(edit) };
  let tree = view.render(props);
  const nodes = walk(tree), tools = nodes.find(n => n.type === 'ScrollView' && n.props.horizontal), content = nodes.find(n => n.type === 'ScrollView' && !n.props.horizontal);
  assert.ok(content && tools);
  const toolButtons = walk(tools).filter(n => n.type === 'TouchableOpacity');
  assert.equal(toolButtons.length, 7);
  assert.ok(toolButtons.some(node=>node.props.accessibilityLabel==='Voice'));
  assert.ok(!walk(content).some(n => n.props.accessibilityLabel === 'Apply media edits'));
  const canvas = walk(content).find(n => n.props?.localUri === 'clip.mp4');
  const frame = walk(content).find(n => n.type === 'View' && n.props?.children?.[0] === canvas);
  assert.ok(frame); assert.ok(flat(frame.props.style).height <= 234);
  toolButtons.find(n => n.props.accessibilityLabel === 'Crop').props.onPress();
  tree=view.render(props);walk(tree).find(n=>n.props.accessibilityLabel==='Rotate 90 degrees').props.onPress();
  tree = view.render(props); walk(tree).find(n => n.props.accessibilityLabel === 'Apply media edits').props.onPress();
  assert.equal(saved[0].rotation, 90);
  walk(tree).find(n=>n.props.accessibilityLabel==='Cover').props.onPress();tree=view.render(props);
  walk(tree).find(n => typeof n.props?.at === 'number' && typeof n.props?.onChange === 'function').props.onChange(9.95);
  tree = view.render(props); walk(tree).find(n => n.props.accessibilityLabel === 'Apply media edits').props.onPress();
  assert.equal(saved[1].coverAt, 9.95);
  const doneText = walk(tree).find(n => n.type === 'Text' && n.props.children === 'Done');
  assert.equal(flat(doneText.props.style).color, '#0B1E3D');
  view.unmount();
});
test('native shared-post stories show caption, uncropped media, handle and a working glass post link', () => {
  const view = load('src/components/stories/PostStoryCard.tsx'), opened = [];
  const tree = view.render({ sticker: { postId: 'post', postText: 'Caption above', postMediaUrl: 'photo.jpg', postMediaType: 'image', postMediaWidth: 1000, postMediaHeight: 1600, postMediaCount: 4, postAuthorName: 'Creator', postUsername: 'creator' }, interactive: true, onOpenPost: () => opened.push('post') });
  const nodes = walk(tree), caption = nodes.findIndex(n => n.props.children === 'Caption above'), image = nodes.findIndex(n => n.type === './StoryPixelImage' && n.props.fit === 'contain' && n.props.uri === 'photo.jpg'), author = nodes.findIndex(n => n.props.children === '@creator');
  assert.ok(caption < image && image < author);
  assert.equal(flat(nodes[0].props.style).backgroundColor, 'transparent');
  const mediaWrap = nodes.find(n => n.type === 'View' && walk(n).includes(nodes[image]) && flat(n.props.style).overflow === 'hidden');
  const width = flat(nodes[0].props.style).width;
  assert.ok(width <= 320 * .9); assert.equal(width / flat(mediaWrap.props.style).height, 1000 / 1600);
  assert.ok(nodes.some(n => n.props.children?.[0] === '1/' && n.props.children?.[1] === 4));
  const footer = nodes.find(n => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'View post');
  assert.equal(flat(footer.props.style).backgroundColor, 'rgba(255,255,255,.18)');
  footer.props.onPress(); assert.deepEqual(opened, ['post']);
  const viewer = fs.readFileSync(path.join(root,'src/screens/stories/StoryViewerScreen.tsx'),'utf8');
  assert.match(viewer, /sharedPhoto[\s\S]*blurRadius=\{32\}/);
  view.unmount();
});
test('web shared-post stories use the same complete photo layout and retain post and author navigation', () => {
  const view = load('web/components/SharedPostStory.tsx');
  const tree = view.render({ sticker: { id: 'share', nx: .5, ny: .5, kind: 'post', postId: 'post-id', postText: 'Caption above', postMediaType: 'image', postMediaUrl: 'photo.jpg', postMediaWidth: 1000, postMediaHeight: 1600, postMediaCount: 3, postAuthorName: 'Creator', postUsername: 'creator' }, paused: false }, 'SharedPostStory');
  const nodes = walk(tree), caption = nodes.findIndex(n => n.props.children === 'Caption above'), image = nodes.findIndex(n => n.type === 'img' && n.props.alt === 'Shared post'), creator = nodes.findIndex(n => n.props.children === '@creator');
  assert.ok(caption < image && image < creator); assert.match(nodes[image].props.className, /object-contain/);
  assert.ok(nodes[0].props.style.width <= 390 * .9);
  const mediaWrap = nodes.find(n => n.type === 'div' && n.props.className?.includes('overflow-hidden'));
  assert.equal(nodes[0].props.style.width / mediaWrap.props.style.height, 1000 / 1600);
  const footer = nodes.find(n => n.type === 'a' && n.props.children?.[0] === 'View post');
  assert.equal(footer.props.href,'/post/post-id'); assert.match(footer.props.className,/backdrop-blur/);
  assert.equal(nodes.find(n => n.type === 'a' && n.props.children === '@creator').props.href, '/creator');
  const viewer = fs.readFileSync(path.join(root,'web/components/StoryViewer.tsx'),'utf8');
  assert.match(viewer, /sharedPhoto[\s\S]*blur-2xl/);
  view.unmount();
});

test('scaled story-review thumbnails lay out a shared post in the original stage coordinates',()=>{
 const view=load('web/components/SharedPostStory.tsx');
 const props={sticker:{id:'share',nx:.5,ny:.5,kind:'post',postId:'post-id',postText:'Caption',postMediaType:'image',postMediaUrl:'photo.jpg',postMediaWidth:1000,postMediaHeight:1600},paused:true,preview:false};
 const first=view.render(props,'SharedPostStory');
 const stage={clientWidth:390,clientHeight:693,getBoundingClientRect:()=>({width:136,height:242})};
 first.props.ref.current={closest:()=>stage,parentElement:stage};
 view.render({...props,preview:true},'SharedPostStory');
 const measured=view.render({...props,preview:true},'SharedPostStory');
 assert.ok(measured.props.style.width>200);assert.ok(measured.props.style.width<=390*.9);
 view.unmount();
});

test('completed video cover decoding follows the edited attachment through reorder and ignores a newer edit',async()=>{
 const source=fs.readFileSync(path.join(root,'src/screens/feed/FeedScreen.tsx'),'utf8');
 const ast=ts.createSourceFile('FeedScreen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let handler;
 const visit=node=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='PostMediaEditSheet'){const attr=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)==='onDone');handler=attr.initializer.expression.getText(ast);}ts.forEachChild(node,visit);};visit(ast);assert.ok(handler);
 const pending=[];let items=[{uri:'clip-a',type:'video',thumbnail:'old-a'},{uri:'clip-b',type:'video',thumbnail:'old-b'}];
 const context={editMediaIdx:0,composerMedia:items,setEditMediaIdx(){},setComposerMedia:update=>{items=update(items);},VideoThumbnails:{getThumbnailAsync:uri=>new Promise(resolve=>pending.push({uri,resolve}))}};
 vm.runInNewContext(compile('this.completeEdit='+handler),context);
 const edit={coverAt:2};context.completeEdit(edit);items.reverse();pending.shift().resolve({uri:'chosen-a'});await ticks();
 assert.equal(items[0].uri,'clip-b');assert.equal(items[0].thumbnail,'old-b');assert.equal(items[1].thumbnail,'chosen-a');
 context.composerMedia=items;context.editMediaIdx=1;context.completeEdit({coverAt:4});const late=pending.shift();items[1]={...items[1],edit:{coverAt:6},thumbnail:'newer-a'};late.resolve({uri:'stale-a'});await ticks();assert.equal(items[1].thumbnail,'newer-a');
});

test('native caption decimal drafts survive typing and Apply without requiring blur',()=>{
 const view=load(editorFile),saved=[],props={visible:true,uri:'clip.mp4',mediaType:'video',width:1080,height:1920,durationSec:10,onCancel(){},onDone:edit=>saved.push(edit)};
 let tree=view.render(props);walk(tree).find(n=>n.props.accessibilityLabel==='Captions').props.onPress();tree=view.render(props);walk(tree).find(n=>n.type==='TextInput'&&n.props.maxLength===160).props.onChangeText('Half seconds');
 for(const text of ['2','2.','2.5']){tree=view.render(props);walk(tree).find(n=>n.props.accessibilityLabel==='Caption start in seconds').props.onChangeText(text);tree=view.render(props);assert.equal(walk(tree).find(n=>n.props.accessibilityLabel==='Caption start in seconds').props.value,text);}
 walk(tree).find(n=>n.props.accessibilityLabel==='Caption end in seconds').props.onChangeText('9.25');tree=view.render(props);walk(tree).find(n=>n.props.accessibilityLabel==='Apply media edits').props.onPress();assert.equal(saved[0].captions[0].start,2.5);assert.equal(saved[0].captions[0].end,9.25);view.unmount();
});
test('native right-angle rotations keep the straighten slider bounded and preserve its offset',()=>{
 const view=load(editorFile),saved=[],props={visible:true,uri:'photo.jpg',mediaType:'image',width:900,height:1200,onCancel(){},onDone:edit=>saved.push(edit)};
 let tree=view.render(props);for(let i=0;i<3;i++){walk(tree).find(n=>n.props.accessibilityLabel==='Rotate 90 degrees').props.onPress();tree=view.render(props);const slider=walk(tree).find(n=>n.props.label==='Straighten');assert.equal(slider.props.value,0);assert.ok(slider.props.value>=slider.props.min&&slider.props.value<=slider.props.max);}
 walk(tree).find(n=>n.props.label==='Straighten').props.onChange(12);tree=view.render(props);walk(tree).find(n=>n.props.accessibilityLabel==='Apply media edits').props.onPress();assert.equal(saved[0].rotation,-78);view.unmount();
});

for(const [width,height,preset] of [[800,1000,'4:5'],[1000,1000,'1:1'],[1600,900,'16:9']]){
 test(`native Original and ${preset} remain mutually exclusive for a ${width}×${height} source`,()=>{
  const saved=[],view=load(editorFile),props={visible:true,uri:'photo.jpg',mediaType:'image',width,height,onCancel(){},onDone:edit=>saved.push(edit)};
  const render=()=>view.render(props);render();
  const selected=tree=>walk(tree).filter(n=>['Original crop','1:1 crop','4:5 crop','16:9 crop'].includes(n.props.accessibilityLabel)&&n.props.accessibilityState?.selected).map(n=>n.props.accessibilityLabel);
  assert.deepEqual(selected(render()),['4:5 crop']);walk(render()).find(n=>n.props.accessibilityLabel===preset+' crop').props.onPress();assert.deepEqual(selected(render()),[preset+' crop']);
  walk(render()).find(n=>n.props.accessibilityLabel==='Original crop').props.onPress();assert.deepEqual(selected(render()),['Original crop']);walk(render()).find(n=>n.props.accessibilityLabel==='Apply media edits').props.onPress();assert.equal(saved[0].aspect,'original');assert.equal(saved[0].aspectRatio,width/height);view.unmount();
  const reopened=load(editorFile),next={...props,initial:saved[0]};reopened.render(next);assert.deepEqual(selected(reopened.render(next)),['Original crop']);
  walk(reopened.render(next)).find(n=>n.props.accessibilityLabel===preset+' crop').props.onPress();assert.deepEqual(selected(reopened.render(next)),[preset+' crop']);
  walk(reopened.render(next)).find(n=>n.props.accessibilityLabel==='Original crop').props.onPress();const reset=walk(reopened.render(next)).find(n=>n.type==='TouchableOpacity'&&walk(n).some(child=>child.type==='Text'&&Array.isArray(child.props.children)&&child.props.children[0]==='Reset '&&child.props.children[1]==='crop'));assert.ok(reset);reset.props.onPress();assert.deepEqual(selected(reopened.render(next)),['4:5 crop']);reopened.unmount();
 });
}

test('native voice editor changes the same video player and retains the recipe on Apply',()=>{
 const saved=[],view=load(editorFile),props={visible:true,uri:'fixture.mp4',mediaType:'video',durationSec:12,initial:{trimStart:2,trimEnd:9,muted:true},onDone:value=>saved.push(value),onCancel(){}};
 let tree=view.render(props);const canvas=walk(tree).find(node=>node.props?.onVideoPlayer);
 const player={duration:12,currentTime:2,playbackRate:1,preservesPitch:true,pause(){},play(){},addListener(){return{remove(){}};}};
 canvas.props.onVideoPlayer(player);tree=view.render(props);
 walk(tree).find(node=>node.props?.accessibilityLabel==='Voice').props.onPress();tree=view.render(props);
 walk(tree).find(node=>String(node.props?.accessibilityLabel).startsWith('Chipmunk voice')).props.onPress();tree=view.render(props);
 assert.equal(player.playbackRate,1.5);assert.equal(player.preservesPitch,false);
 const preview=walk(tree).find(node=>node.props?.onVideoPlayer);assert.equal(preview.props.videoSpeed,1.5);assert.equal(preview.props.videoPreservesPitch,false);
 walk(tree).find(node=>node.props?.accessibilityLabel==='Apply media edits').props.onPress();
 assert.equal(saved[0].voiceEffect,'chipmunk');assert.equal(saved[0].trimStart,2);assert.equal(saved[0].trimEnd,9);assert.equal(saved[0].muted,false);view.unmount();
});
