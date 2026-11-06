// Frames for videos without a stored cover: keyed by the media object rather than the token that granted it, decoded
// once and shared by every tile that shows the same video, at most two at a time, dropped from the queue when no tile
// waits for them any more, not retried for a minute after a failure, bounded, and forgotten entirely when the signed-in
// person changes, including a decode that was under way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function load(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => imports[name], URL, AbortController, setTimeout, clearTimeout, console });
  return module.exports;
}
const contentMedia = load('../shared/contentMedia.ts');
const mediaDelivery = load('../shared/mediaDelivery.ts');
const { createVideoFrameCache, frameKey, IDLE } = load('lib/videoFrameCache.ts', { '../../shared/contentMedia': contentMedia, '../../shared/mediaDelivery': mediaDelivery });
const base = 'https://project.supabase.co';
const delivered = (name, token) => `${base}/functions/v1/media-content/post-media/${name}?token=${token.repeat(64)}`;
const signed = (name, token) => `${base}/storage/v1/object/sign/post-media/${name}?token=${token}`;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function harness(options = {}) {
  const captures = []; let now = 1000;
  const cache = createVideoFrameCache({ ...options, now: () => now, capture: (url, at, signal) => new Promise((resolve, reject) => { captures.push({ url, at, signal, resolve, reject }); }) });
  return { cache, captures, time(value) { now = value; } };
}

test('a frame is keyed by the media object, never by the token that granted it', () => {
  assert.equal(frameKey(delivered('a/b.mp4', 'a'), base), 'post-media/a/b.mp4');
  assert.equal(frameKey(delivered('a/b.mp4', 'b'), base), frameKey(delivered('a/b.mp4', 'a'), base), 'a re-signed capability finds the same frame');
  assert.equal(frameKey(signed('a/b.mp4', 'x.y.z'), base), 'post-media/a/b.mp4');
  assert.notEqual(frameKey('https://elsewhere.test/clip?id=1', base), frameKey('https://elsewhere.test/clip?id=2', base), 'query parameters can select different videos');
  assert.equal(frameKey('https://elsewhere.test/clip.mp4?x=1#t=2', base), 'https://elsewhere.test/clip.mp4?x=1');
  assert.equal(frameKey(base + '/x.mp4?t=1', ''), base + '/x.mp4?t=1');
});

test('a request decodes once, tells every listener, and leaves a ready or loading frame alone', async () => {
  const h = harness(); const seen = [];
  const off = h.cache.subscribe('k1', () => seen.push(h.cache.peek('k1').state));
  assert.equal(h.cache.peek('k1'), IDLE);
  h.cache.request('k1', 'u1', 0.8); h.cache.request('k1', 'u1', 0.8);
  assert.equal(h.captures.length, 1, 'one decode for two asks'); assert.equal(h.captures[0].at, 0.8); assert.equal(h.cache.peek('k1').state, 'loading');
  h.captures[0].resolve('data:image/jpeg;base64,AAAA'); await settle();
  assert.equal(h.cache.peek('k1').src, 'data:image/jpeg;base64,AAAA'); assert.ok(seen.includes('loading')); assert.equal(seen.at(-1), 'ready');
  assert.equal(h.cache.peek('k1'), h.cache.peek('k1'), 'a snapshot is stable between changes');
  h.cache.request('k1', 'u1', 0.8); assert.equal(h.captures.length, 1, 'a ready frame is not decoded again');
  off();
});

test('at most two videos decode at once, and a queued frame no one waits for any more is dropped', async () => {
  const h = harness(); const keys = ['a', 'b', 'c', 'd'];
  const offs = Object.fromEntries(keys.map(key => [key, h.cache.subscribe(key, () => {})]));
  for (const key of keys) h.cache.request(key, 'u-' + key, 0.5);
  assert.equal(h.captures.length, 2, 'two decoders'); assert.equal(h.cache.peek('c').state, 'loading', 'a queued frame reads as loading');
  offs.c();
  h.captures[0].resolve('data:image/jpeg;base64,A'); await settle();
  assert.deepEqual(h.captures.map(c => c.url), ['u-a', 'u-b', 'u-d'], 'c was skipped and d started in its place');
  assert.equal(h.cache.peek('c'), IDLE, 'a dropped frame is not left as loading');
  for (const key of ['a', 'b', 'd']) offs[key]();
});

test('a failed frame waits a minute before it is tried again', async () => {
  const h = harness({ retryAfterMs: 60_000 }); const off = h.cache.subscribe('k', () => {});
  h.cache.request('k', 'u', 0.8); h.captures[0].reject(new Error('The video has no picture.')); await settle();
  assert.equal(h.cache.peek('k').state, 'failed');
  h.cache.request('k', 'u', 0.8); assert.equal(h.captures.length, 1, 'no retry within the minute');
  h.time(1000 + 60_000); h.cache.request('k', 'u', 0.8); assert.equal(h.captures.length, 2, 'tried again after the minute');
  off();
});

test('a change of person forgets every frame and abandons decoding under way', async () => {
  const h = harness(); let notified = 0; const off = h.cache.subscribe('k', () => notified++);
  h.cache.request('k', 'u', 0.8); const first = h.captures[0];
  h.cache.reset();
  assert.equal(first.signal.aborted, true, 'the decoder is told to stop'); assert.equal(h.cache.peek('k'), IDLE); assert.ok(notified >= 2, 'listeners learn of the reset');
  first.resolve('data:image/jpeg;base64,LATE'); await settle();
  assert.equal(h.cache.peek('k'), IDLE, 'a frame from before the change is discarded');
  h.cache.request('k', 'u', 0.8); assert.equal(h.captures.length, 2, 'decoding starts afresh for the new person');
  off();
});

test('a still-mounted tile is notified when its failed decode can retry', async () => {
  const h = harness({retryAfterMs: 10});
  let notified;
  const retryReady = new Promise(resolve => { notified = resolve; });
  const off = h.cache.subscribe('retry', () => { if (h.cache.peek('retry') === IDLE) notified(); });
  h.cache.request('retry', 'url', 0);
  h.captures[0].reject(new Error('temporary failure'));
  await retryReady;
  h.cache.request('retry', 'renewed-url', 0);
  assert.deepEqual(h.captures.map(x => x.url), ['url', 'renewed-url']);
  off(); h.cache.reset();
});

test('the store stays bounded, evicting the oldest frame nobody is showing first', async () => {
  const h = harness({ limit: 3, concurrency: 10 }); const offs = {};
  for (const key of ['a','b','c']) { offs[key]=h.cache.subscribe(key,()=>{});h.cache.request(key,'u-'+key,0); }
  for (const capture of h.captures) capture.resolve('data:image/jpeg;base64,'+capture.url);
  await settle();offs.a();offs.b();
  offs.d=h.cache.subscribe('d',()=>{});h.cache.request('d','u-d',0);h.captures.at(-1).resolve('data:image/jpeg;base64,D');await settle();
  assert.equal(h.cache.size,3);
  assert.equal(h.cache.peek('a'), IDLE, 'the oldest unwatched frame went first');
  for (const key of ['b', 'c', 'd']) assert.equal(h.cache.peek(key).state, 'ready', key + ' stays');
});
test('a renewed grant immediately replaces a failed grant, without retry loops between old subscribers',async()=>{
 const h=harness();const off=h.cache.subscribe('same-version',()=>{});
 h.cache.request('same-version','expired',0);h.captures[0].reject(Error('media'));await settle();
 h.cache.request('same-version','fresh',0);assert.equal(h.captures.length,2);h.captures[1].reject(Error('canvas'));await settle();
 h.cache.request('same-version','expired',0);assert.equal(h.captures.length,2);h.cache.nativeReady('same-version','fresh');h.time(999999);
 h.cache.request('same-version','fresh',0);assert.equal(h.captures.length,2,'a visible display-only still does not trigger recurring canvas downloads');off();h.cache.reset();
});
test('leaving the last observed tile aborts a decode and never publishes its late pixels',async()=>{
 const h=harness(), off=h.cache.subscribe('x',()=>{});h.cache.request('x','u',0);off();assert.equal(h.captures[0].signal.aborted,true);
 h.captures[0].resolve('data:image/jpeg;base64,LATE');await settle();assert.equal(h.cache.peek('x'),IDLE);
});
const {preparePausedStill}=load('lib/videoFrames.ts');
function stillHarness(moment) {
 let ready=0, failed=0, plays=0, seeks=0, position=0;
 const v={duration:8,seeking:false,videoWidth:0,videoHeight:0,readyState:1,play(){plays++},pause(){},load(){},removeAttribute(){},get currentTime(){return position},set currentTime(n){seeks++;position=n}};
 const close=preparePausedStill(v,'fixture.mp4',moment,()=>ready++,()=>failed++,false);
 return {v,close,status:()=>({ready,failed,plays,seeks})};
}
test('legacy still never seeks, plays or accepts an audio-only decoded sample as a picture',()=>{
 const h=stillHarness(0);try{h.v.onloadedmetadata();h.v.readyState=4;h.v.onloadeddata();assert.deepEqual(h.status(),{ready:0,failed:0,plays:0,seeks:0});
 h.v.videoWidth=360;h.v.videoHeight=640;h.v.oncanplay();assert.deepEqual(h.status(),{ready:1,failed:0,plays:0,seeks:0});assert.equal(h.v.muted,true);assert.equal(h.v.autoplay,false);}finally{h.close();}
});
test('an authored time never reveals a pre-trim native frame while seek confirmation is pending',()=>{
 const h=stillHarness(2);try{h.v.readyState=4;h.v.videoWidth=100;h.v.videoHeight=200;h.v.onloadedmetadata();h.v.onloadeddata();assert.equal(h.status().ready,0);assert.equal(h.v.currentTime,2);h.v.onseeked();assert.deepEqual(h.status(),{ready:1,failed:0,plays:0,seeks:1});}finally{h.close();}
});
