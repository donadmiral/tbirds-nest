const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(file, globals = {}) { const module = { exports: {} }; vm.runInNewContext(compile(fs.readFileSync(path.join(root, file), 'utf8')), { module, exports: module.exports, setTimeout, clearTimeout, ...globals }); return module.exports; }
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('mixed gallery assets retain photo/video identity and duration independently of the route mode', () => {
  const { normalizeStoryCapture } = load('shared/storyCapture.ts');
  const result = [{ uri: 'photo.jpg', type: 'image', width: 1200, height: 800 }, { uri: 'clip.mp4', type: 'video', duration: 17250, width: 1080, height: 1920 }, { localUri: 'capture.mov', mediaType: 'video', durationSec: 4.5 }].map(asset => normalizeStoryCapture(asset, 'video'));
  assert.deepEqual(result.map(asset => asset.mediaType), ['image','video','video']);
  assert.equal(result[1].durationSec, 17.25); assert.equal(result[2].durationSec, 4.5);
});

test('multi-clip retries skip confirmed clips and reuse the uncertain request payload and ID', async () => {
  const { publishStoryClipQueue, readStoryClipQueue } = load('web/lib/storyClipQueue.ts');
  const queue = { version: 1, clips: ['image','video','text'].map((media_type,index) => ({ clipId: 'clip-'+index, requestId: 'request-'+index, payload: { media_type, caption: 'snapshot-'+index, allow_replies: false } })) };
  const sent = [], persisted = []; let fail = true;
  const io = { check: async () => {}, persist: value => persisted.push(JSON.stringify(value)), send: async attempt => { sent.push(JSON.stringify(attempt)); if (attempt.clipId === 'clip-1' && fail) { fail = false; throw new Error('connection dropped after send'); } return 'story-'+attempt.clipId; } };
  await assert.rejects(publishStoryClipQueue(queue, io), /connection dropped/);
  assert.equal(queue.clips[0].storyId, 'story-clip-0'); assert.equal(queue.clips[1].storyId, undefined);
  const restored = readStoryClipQueue(persisted.at(-1));
  await publishStoryClipQueue(restored, io);
  assert.equal(sent.filter(value => JSON.parse(value).clipId === 'clip-0').length, 1);
  assert.equal(sent[1], sent[2]); assert.equal(restored.clips.every(clip => clip.storyId), true);
  assert.throws(() => readStoryClipQueue(JSON.stringify({ ...queue, editable: 'yes' })), /state/);
});

test('an account switch after a clip RPC prevents local confirmation and further publishing', async () => {
  const { publishStoryClipQueue } = load('web/lib/storyClipQueue.ts'); let checks = 0, sends = 0;
  const queue = { version: 1, clips: [1,2].map(id => ({ clipId: String(id), requestId: String(id), payload: { media_type:'image' } })) };
  await assert.rejects(publishStoryClipQueue(queue, { persist() {}, check: async () => { if (++checks === 2) throw new Error('account changed'); }, send: async () => { sends++; return 'already-created'; } }), /account changed/);
  assert.equal(sends, 1); assert.equal(queue.clips[0].storyId, undefined);
});

test('Camera Kit capture rejects overlapping, timed-out, error and closed requests; stale responses cannot settle another capture', async () => {
  const timers = new Map(); let next = 0;
  const { createCameraKitCaptureBridge } = load('src/screens/stories/cameraKitBridge.ts', { setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); } });
  const bridge = createCameraKitCaptureBridge(), ids = [];
  const first = bridge.request('photo', id => ids.push(id));
  await assert.rejects(bridge.request('video', () => {}), /already/);
  [...timers.values()][0](); await assert.rejects(first, /did not finish/);
  const second = bridge.request('photo', id => ids.push(id));
  let writes = 0; await bridge.complete(ids[0], 'photo', async () => { writes++; return 'stale.jpg'; }); assert.equal(writes, 0);
  await bridge.complete(ids[1], 'photo', async () => 'current.jpg'); assert.equal(await second, 'current.jpg');
  const third = bridge.request('video', id => ids.push(id)); bridge.fail('encoder failed', ids[2]); await assert.rejects(third, /encoder failed/);
  const fourth = bridge.request('photo', id => ids.push(id)); bridge.fail('camera closed'); await assert.rejects(fourth, /camera closed/);
  assert.equal(timers.size, 0);
});

test('Camera Kit validates real media data and discards a file that finishes writing after closure', async () => {
  const { createCameraKitCaptureBridge, cameraKitCaptureData } = load('src/screens/stories/cameraKitBridge.ts');
  assert.equal(cameraKitCaptureData('data:video/mp4;codecs=avc1.42e01e,mp4a.40.2;base64,QUJDREVGR0g=', 'video').extension, 'mp4');
  assert.throws(() => cameraKitCaptureData('data:,', 'photo'), /empty|unsupported/);
  assert.throws(() => cameraKitCaptureData('data:text/html;base64,QUJDREVGR0g=', 'photo'), /empty|unsupported/);
  const bridge = createCameraKitCaptureBridge(); let id, finish, discarded;
  const pending = bridge.request('photo', value => { id = value; });
  const writing = bridge.complete(id, 'photo', () => new Promise(resolve => { finish = resolve; }), uri => { discarded = uri; });
  bridge.fail('camera closed'); await assert.rejects(pending, /closed/); finish('late.jpg'); await writing; assert.equal(discarded, 'late.jpg');
});

function engineScenario({ loadLens = async id => ({ id }), applyLens = async () => true } = {}) {
  const sent = [], received = {}, contexts = [], timers = new Map(), recorders = [], streams = [];
  let next = 0, capturedOutput = null, failRecord = false, gate = null;
  const track = () => ({ stopped: false, stop() { this.stopped = true; } });
  const makeStream = audio => { const tracks = [track()]; const media = { getTracks: () => tracks, getAudioTracks: () => audio ? tracks : [], addTrack: item => tracks.push(item) }; streams.push(media); return media; };
  const output = { width: 1080, height: 1920, captureStream() { capturedOutput = output; return makeStream(false); } };
  const session = { output: { capture: output }, events: { addEventListener() {} }, setSource: async () => {}, play: async target => { if (target === 'capture' && gate) await gate; }, pause: async () => {}, destroy: async () => {}, applyLens, removeLens: async () => {} };
  class Recorder { static isTypeSupported(type) { return type === 'video/mp4'; } constructor(media, options) { if (failRecord) throw new Error('encoder unavailable'); this.stream = media; this.mimeType = options.mimeType; this.options = options; this.state = 'inactive'; recorders.push(this); } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['recorded'], { type:'video/mp4' }) }); this.onstop?.(); } }
  class Reader { readAsDataURL(blob) { this.result = `data:${blob.type};base64,QUJDREVGR0g=`; this.onload?.(); } }
  const context = {
    qc: async () => ({ createSession: async () => session, lensRepository: { loadLensGroups: async () => ({ lenses: [] }), loadLens } }), si: value => value,
    window: { ReactNativeWebView: { postMessage: raw => sent.push(JSON.parse(raw)) }, addEventListener(name, fn) { received[name] = fn; } },
    document: { hidden:false, getElementById: () => ({ detached:true }), addEventListener() {}, createElement: () => ({ getContext: () => ({ drawImage(source) { contexts.push(source); } }), toDataURL: () => 'data:image/jpeg;base64,' + 'A'.repeat(120) }) },
    navigator: { mediaDevices: { getUserMedia: async options => makeStream(!!options.audio) } },
    requestAnimationFrame: fn => fn(), setTimeout: fn => { timers.set(++next,fn); return next; }, clearTimeout: id => timers.delete(id), MediaRecorder: Recorder, Blob, FileReader: Reader, Promise, Error,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'tools/camera-kit/runtime.js'), 'utf8'), context);
  return { sent, contexts, output, recorders, streams, send: message => received.message({ data: JSON.stringify(message) }), get capturedOutput() { return capturedOutput; }, set failRecord(value) { failRecord = value; }, set gate(value) { gate = value; } };
}

test('Camera Kit photos and video use the SDK capture output, preserve microphone audio and release capture tracks', async () => {
  const engine = engineScenario(); await engine.send({ type:'init', apiToken:'fixture' });
  await engine.send({ type:'capturePhoto', requestId:'photo-1' });
  assert.equal(engine.contexts[0], engine.output); assert.equal(engine.sent.find(item => item.type === 'photo').requestId, 'photo-1');
  await engine.send({ type:'startVideo' }); assert.equal(engine.capturedOutput, engine.output); assert.equal(engine.recorders[0].options.videoBitsPerSecond, 8000000); assert.equal(engine.recorders[0].stream.getTracks().length, 2);
  await engine.send({ type:'stopVideo', requestId:'video-1' }); await tick();
  assert.equal(engine.sent.find(item => item.type === 'video').requestId, 'video-1'); assert.ok(engine.recorders[0].stream.getTracks().every(item => item.stopped));
  await engine.send({ type:'dispose' }); assert.ok(engine.streams.every(stream => stream.getTracks().every(item => item.stopped)));
});

test('Camera Kit stops requested during startup, reports encoder failures and never waits silently for an absent recording', async () => {
  const engine = engineScenario(); await engine.send({ type:'init', apiToken:'fixture' });
  await engine.send({ type:'stopVideo', requestId:'absent' }); assert.equal(engine.sent.at(-1).requestId, 'absent'); assert.match(engine.sent.at(-1).message, /No Lens video/);
  let release; engine.gate = new Promise(resolve => { release = resolve; });
  const start = engine.send({ type:'startVideo' }); await tick(); await engine.send({ type:'stopVideo', requestId:'early-stop' }); release(); await start; await tick();
  assert.equal(engine.sent.find(item => item.type === 'video').requestId, 'early-stop');
  engine.gate = null; engine.failRecord = true; await engine.send({ type:'startVideo' }); assert.match(engine.sent.at(-1).message, /encoder unavailable/);
  await engine.send({ type:'dispose' });
});

test('the shipping Camera Kit HTML contains the exact reviewed runtime source and valid JavaScript', () => {
  const { readEngineHtml, generatedFiles } = require('../../tools/camera-kit/sync-runtime.cjs');
  const html = readEngineHtml();
  for (const [name, contents] of generatedFiles(html)) { assert.ok(Buffer.byteLength(contents, 'utf8') < 300000); assert.equal(fs.readFileSync(path.join(root, 'src/screens/stories', name), 'utf8'), contents); }
  const runtime = fs.readFileSync(path.join(root,'tools/camera-kit/runtime.js'),'utf8');
  assert.ok(html.includes('/* PLATINUM_CAMERA_RUNTIME_START */\n' + runtime + '\n/* PLATINUM_CAMERA_RUNTIME_END */'));
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')); new vm.Script(script);
  assert.ok(!html.includes('yh.captureStream'));
});

test('layer timing clamps invalid windows and preserves a positive duration inside every clip', () => {
  const { storyLayerWindow } = load('shared/storyPresentation.ts');
  for (const [start,end,duration] of [[-3,100,15],[10,2,15],[NaN,Infinity,8],[59,60,60],[3.9,4,4]]) {
    const window = storyLayerWindow(start,end,duration);
    assert.ok(window.start >= 0 && window.end <= duration); assert.ok(window.end - window.start >= .249);
  }
});
test('native trim playback preserves paused seek positions and loops only while playing', () => {
  const source = fs.readFileSync(path.join(root,'src/components/stories/MediaCanvas.tsx'),'utf8');
  const ast = ts.createSourceFile('MediaCanvas.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'StoryVideoLayer');
  const exports = {}, effects = []; let clock;
  const player = { currentTime:0, playing:false, play(){this.playing=true;},pause(){this.playing=false;}, addListener(name,fn){if(name==='timeUpdate')clock=fn;return{remove(){}};} };
  vm.runInNewContext(ts.transpileModule(fn.getText(ast).replace('function StoryVideoLayer','export function StoryVideoLayer'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({jsx:()=>null}),useRef:value=>({current:value}),useEffect:fn=>effects.push(fn),useExpoVideoPlayer:()=>player,ExpoVideoView:'Video',StyleSheet:{absoluteFill:{}}});
  exports.StoryVideoLayer({uri:'clip.mp4',fit:'contain',muted:true,paused:true,trimStart:2,trimEnd:8});effects.forEach(fn=>fn());
  player.currentTime=8;clock({currentTime:8});assert.equal(player.currentTime,8);
  player.play();clock({currentTime:8});assert.equal(player.currentTime,2);
});

test('Camera Kit ignores out-of-order Lens loads and blocks capture while a Lens changes', async()=>{
 const pending=new Map(),applied=[],engine=engineScenario({loadLens:id=>new Promise(resolve=>pending.set(id,resolve)),applyLens:async lens=>{applied.push(lens.id);return true;}});await engine.send({type:'init',apiToken:'fixture'});
 const first=engine.send({type:'applyLens',lensId:'first',groupId:'g'}),last=engine.send({type:'applyLens',lensId:'latest',groupId:'g'});
 await engine.send({type:'capturePhoto',requestId:'during-update'});assert.equal(engine.sent.at(-1).type,'error');assert.match(engine.sent.at(-1).message,/updating/);assert.equal(engine.contexts.length,0);
 pending.get('latest')({id:'latest'});await last;pending.get('first')({id:'first'});await first;assert.deepEqual(applied,['latest']);assert.equal(engine.sent.filter(m=>m.type==='lensApplied').at(-1).lensId,'latest');await engine.send({type:'dispose'});
});
test('Camera Kit serializes Lens SDK mutations so a slow earlier apply cannot replace the latest choice',async()=>{
 let finishFirst;const applied=[],engine=engineScenario({applyLens:async lens=>{if(lens.id==='first')await new Promise(resolve=>finishFirst=resolve);applied.push(lens.id);return true;}});await engine.send({type:'init',apiToken:'fixture'});
 const first=engine.send({type:'applyLens',lensId:'first',groupId:'g'});await tick();const last=engine.send({type:'applyLens',lensId:'latest',groupId:'g'});await tick();assert.deepEqual(applied,[]);finishFirst();await Promise.all([first,last]);assert.deepEqual(applied,['first','latest']);assert.equal(engine.sent.filter(m=>m.type==='lensApplied').length,1);assert.equal(engine.sent.at(-1).lensId,'latest');await engine.send({type:'dispose'});
});
test('Camera Kit disposal fences pending Lens loads and their late errors',async()=>{
 let finish;const applied=[],engine=engineScenario({loadLens:()=>new Promise((resolve,reject)=>finish={resolve,reject}),applyLens:async lens=>{applied.push(lens);return true;}});await engine.send({type:'init',apiToken:'fixture'});const pending=engine.send({type:'applyLens',lensId:'late',groupId:'g'});await engine.send({type:'dispose'});const sent=engine.sent.length;finish.reject(Error('late failed lens'));await pending;assert.deepEqual(applied,[]);assert.equal(engine.sent.length,sent);
});
