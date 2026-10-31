const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
function load(file) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { URL,AbortController,setTimeout,clearTimeout,module, exports: module.exports, require: name => load(path.resolve(path.dirname(absolute), name + '.ts')) });
  cache.set(absolute, module.exports);
  return module.exports;
}
const creative = load('shared/memoryBookCreative.ts');
const film = load('shared/memoryMoviePlan.ts');
const settings = patch => ({ ...creative.DEFAULT_MEMORY_FILM_SETTINGS, ...patch });
const photo = id => ({ id, media_type: 'image', media_url: `private:${id}` });
const plain = value => JSON.parse(JSON.stringify(value));

test('legacy books retain original timing while explicit new settings enable automatic movies', () => {
  assert.equal(creative.memoryFilmSettings().mode, 'original');
  assert.equal(creative.memoryFilmSettings().titleCard, false);
  assert.equal(creative.memoryFilmSettings(settings()).mode, 'automatic');
  assert.equal(creative.memoryBookCreativeAvailable({ version: 1, supported: true }), true);
  for (const data of [null, { version: 2, supported: true }, { version: 1, supported: 'true' }, {}]) assert.equal(creative.memoryBookCreativeAvailable(data), false);
  assert.equal(creative.memoryBookCreativeAvailable({ version: 1, supported: true }, { code: '42501' }), false);
});

test('cover settings reject delivery URLs, unknown keys, unbounded framing and hostile enum objects', () => {
  const valid = creative.memoryCoverArtwork();
  assert.ok(creative.parseMemoryCoverArtwork(valid));
  for (const patch of [{ version: 2 }, { photoUrl: 'https://foreign/photo' }, { inscription: 'x'.repeat(161) },
    { postmark: 'x'.repeat(33) }, { inscriptionStyle: { toString: 'invalid' } }, { showDate: 1 },
    { photo: { x: Infinity, y: .5, scale: 1 } }, { photo: { x: .5, y: .5, scale: 3 } },
    { photo: { x: .5, y: .5, scale: 1, uri: 'file:///private' } }, { inscription: 'bad\u0001text' }]) {
    assert.equal(creative.parseMemoryCoverArtwork({ ...valid, ...patch }), null);
  }
  const first = creative.memoryCoverArtwork(), second = creative.memoryCoverArtwork();
  first.photo.x = 0; assert.equal(second.photo.x, .5);
});

test('film settings require the complete versioned contract and actual booleans', () => {
  for (const patch of [{ extra: true }, { mode: 'ai' }, { length: 30 }, { order: ['book'] }, { originalAudio: 'false' }, { titleCard: null }]) {
    assert.equal(creative.parseMemoryFilmSettings(settings(patch)), null);
  }
  const missing = settings(); delete missing.style; assert.equal(creative.parseMemoryFilmSettings(missing), null);
});

test('save acknowledgement must identify the expected book and carry a valid revision and documents', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const result = { id, presentation_revision: 4, cover_artwork: creative.memoryCoverArtwork(), film_settings: settings() };
  assert.equal(creative.parseMemoryCreativeSaveResult(result, id).presentation_revision, 4);
  for (const patch of [{ id: '22222222-2222-4222-8222-222222222222' }, { presentation_revision: -1 }, { presentation_revision: 1.5 }, { cover_artwork: {} }]) {
    assert.equal(creative.parseMemoryCreativeSaveResult({ ...result, ...patch }, id), null);
  }
  assert.match(creative.memoryCreativeSaveError({ message: 'MEMORY_BOOK_CHANGED' }), /another session.*draft is kept/);
});

test('original cut preserves every authored trim, speed, original gain and page order', () => {
  const pages = [{ id: 'video', media_type: 'video', media_url: 'private:video', duration_sec: 12,
    media_transform: { trimStart: 2, trimEnd: 10, speed: 2, mix: { orig: 35 }, scale: 1.3 } }, photo('still')];
  const before = JSON.stringify(pages), plan = film.planMemoryMovie(pages);
  assert.equal(plan.scenes.length, 2); assert.equal(plan.scenes[0].durationSec, 4);
  assert.equal(plan.scenes[1].startSec, 4); assert.equal(plan.durationSec, 10);
  assert.equal(plan.openingSeconds, 0); assert.equal(plan.scenes[0].fadeSec, 0);
  const planned = film.memoryMoviePlannedPages(pages, plan);
  assert.equal(planned[0].media_transform.mix.orig, 35); assert.equal(planned[0].media_transform.scale, 1.3);
  assert.equal(JSON.stringify(pages), before);
});

test('short automatic cuts deterministically spread through the book and retain its first and last memories', () => {
  const pages = Array.from({ length: 80 }, (_, index) => photo(String(index)));
  const plan = film.planMemoryMovie(pages, settings({ length: 'short' }));
  assert.equal(plan.sourceCount, 80); assert.equal(plan.selectedCount, 8);
  assert.equal(plan.scenes[0].pageId, '0'); assert.equal(plan.scenes.at(-1).pageId, '79');
  assert.equal(new Set(plan.scenes.map(scene => scene.pageId)).size, 8);
  assert.ok(plan.durationSec <= 30.001); assert.ok(plan.scenes.every(scene => scene.durationSec >= 2));
  assert.deepEqual(plain(plan), plain(film.planMemoryMovie(pages, settings({ length: 'short' }))));
});

test('full automatic movies keep all eighty memories and fit the five-minute bound', () => {
  const pages = Array.from({ length: 80 }, (_, index) => ({ id: String(index), media_type: 'text', caption: 'word '.repeat(80) }));
  const plan = film.planMemoryMovie(pages, settings());
  assert.equal(plan.selectedCount, 80); assert.ok(plan.durationSec <= 300.001);
  assert.ok(plan.scenes.every(scene => scene.durationSec >= 3));
  const short = film.planMemoryMovie(pages, settings({ length: 'short' }));
  assert.ok(short.durationSec <= 30.001); assert.equal(short.scenes.length, 8);
});

test('chronological cuts sort real dates stably and keep undated memories last', () => {
  const pages = [{ ...photo('unknown'), taken_at: 'invalid' }, { ...photo('later'), taken_at: '2026-06-05' },
    { ...photo('first'), taken_at: '2026-01-01' }, { ...photo('same'), taken_at: '2026-01-01' }];
  const plan = film.planMemoryMovie(pages, settings({ order: 'chronological' }));
  assert.deepEqual(plain(plan.scenes.map(scene => scene.pageId)), ['first', 'same', 'later', 'unknown']);
  assert.deepEqual(plain(film.memoryMoviePlannedPages(pages, plan).map(page => page.id)), ['first', 'same', 'later', 'unknown']);
});

test('unmeasured videos stay explicitly estimated and measured trims cannot outlast the source', () => {
  const pages = [{ id: 'v', media_type: 'video', media_url: 'private:v', media_transform: { trimStart: 2, trimEnd: 20, speed: 2 } }];
  assert.equal(film.planMemoryMovie(pages, settings()).estimated, true);
  const plan = film.planMemoryMovie(pages, settings(), { v: 5 });
  assert.equal(plan.estimated, false); assert.equal(plan.scenes[0].trimEnd, 5);
  assert.equal(plan.scenes[0].durationSec, 1.5);
});

test('plans contain no playback URLs and reject empty, duplicate, oversized or changed books', () => {
  assert.throws(() => film.planMemoryMovie([]), /Add a memory/);
  assert.throws(() => film.planMemoryMovie([photo('a'), photo('a')]), /changed/);
  assert.throws(() => film.planMemoryMovie(Array.from({ length: 81 }, (_, index) => photo(String(index)))), /80 memories/);
  const plan = film.planMemoryMovie([photo('secret-capability')], settings());
  assert.doesNotMatch(JSON.stringify(plan), /private:/);
  assert.throws(() => film.memoryMoviePlannedPages([photo('another')], plan), /book changed/);
  assert.throws(() => film.planMemoryMovie([{ id: 'long', media_type: 'video', media_url: 'private:v', duration_sec: 301 }]), /five minutes/);
});

const persistence=load('shared/memoryBookPersistence.ts');
const accessLib=load('shared/memoryMovieAccess.ts');
const nativeMovie=load('shared/memoryMovieComposition.ts');
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',bookId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',storyId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const draft=()=>({title:'Our days',subtitle:'A little book',color:'cream',design:'postcard',coverStoryId:storyId,artwork:creative.memoryCoverArtwork(),film:settings()});
function clientFixture(){
 const calls=[];let user=owner,listener=null,onWrite=()=>{},ack={id:bookId,presentation_revision:4,cover_artwork:creative.memoryCoverArtwork(),film_settings:settings()};
 return {calls,setUser:value=>{user=value;},emit:value=>{user=value;listener?.('SIGNED_IN',{user:{id:value}});},onWrite:callback=>{onWrite=callback;},setAck:value=>{ack=value;},client:{auth:{getUser:async()=>({data:{user:{id:user}},error:null}),getSession:async()=>({data:{session:{user:{id:user},access_token:'fixture-only'}},error:null}),onAuthStateChange:callback=>{listener=callback;return{data:{subscription:{unsubscribe(){listener=null;}}}};}},rpc:(name,args)=>{const call={name,args,headers:{},signal:null};calls.push(call);const request={setHeader(name,value){call.headers[name]=value;return request;},abortSignal(signal){call.signal=signal;return request;},then(resolve,reject){return Promise.resolve().then(()=>{if(name!=='get_memory_book_creative_capabilities')onWrite();return{data:name==='get_memory_book_creative_capabilities'?{version:1,supported:true}:ack,error:null};}).then(resolve,reject);}};return request;}}};
}
test('creative saves send one atomic owner-checked revision and exact documents',async()=>{
 const f=clientFixture();const result=await persistence.saveMemoryCreativeBook(f.client,{ownerId:owner,albumId:bookId,revision:3,audience:'only_me',draft:draft(),isCurrent:()=>true});
 assert.equal(result.presentation_revision,4);assert.deepEqual(f.calls.map(call=>call.name),['get_memory_book_creative_capabilities','save_memory_book_creative_presentation']);
 const args=f.calls[1].args;assert.equal(args.p_expected_revision,3);assert.equal(args.p_album,bookId);assert.equal(args.p_audience,'only_me');assert.equal(args.p_cover_artwork.version,1);assert.equal(args.p_film_settings.mode,'automatic');
 assert.equal(f.calls[1].headers.Authorization,'Bearer fixture-only');assert.equal(f.calls[1].signal.aborted,true,'request scope closes after acknowledgement');
});
test('creative mutations reject wrong owners and stale account scopes before a write',async()=>{
 for(const mode of ['owner','scope']){const f=clientFixture();if(mode==='owner')f.setUser(storyId);await assert.rejects(persistence.saveMemoryCreativeBook(f.client,{ownerId:owner,albumId:bookId,revision:3,audience:'profile',draft:draft(),isCurrent:()=>mode!=='scope'}),/session changed/);assert.equal(f.calls.length,1);}
});
test('a mutation acknowledgement cannot confirm another book, unchanged revision or missing documents',async()=>{
 for(const patch of [{id:storyId},{presentation_revision:3},{film_settings:null}]){const f=clientFixture();f.setAck({id:bookId,presentation_revision:4,cover_artwork:creative.memoryCoverArtwork(),film_settings:settings(),...patch});await assert.rejects(persistence.saveMemoryCreativeBook(f.client,{ownerId:owner,albumId:bookId,revision:3,audience:'profile',draft:draft(),isCurrent:()=>true}),/could not be confirmed/);}
});
test('create retries preserve a caller-owned request UUID and exact story order',async()=>{
 const f=clientFixture(),options={ownerId:owner,requestId:bookId,storyIds:[storyId],draft:draft(),isCurrent:()=>true};
 await persistence.createMemoryCreativeBook(f.client,options);await persistence.createMemoryCreativeBook(f.client,options);
 const writes=f.calls.filter(call=>call.name==='create_memory_book_creative_presentation');assert.equal(writes.length,2);assert.equal(writes[0].args.p_request_id,bookId);assert.deepEqual(plain(writes[0].args),plain(writes[1].args));assert.deepEqual(plain(writes[0].args.p_story_ids),[storyId]);
});
test('an account round trip during a successful write prevents its UI acknowledgement',async()=>{
 let current=true;const f=clientFixture();f.onWrite(()=>{current=false;});
 await assert.rejects(persistence.saveMemoryCreativeBook(f.client,{ownerId:owner,albumId:bookId,revision:3,audience:'profile',draft:draft(),isCurrent:()=>current}),/session changed/);
});
test('creative create and save pin the starting JWT and reject sticky account round trips',async()=>{
 for(const create of [false,true]){const f=clientFixture();f.onWrite(()=>{f.emit(storyId);f.emit(owner);});
  const work=create?persistence.createMemoryCreativeBook(f.client,{ownerId:owner,requestId:bookId,storyIds:[storyId],draft:draft(),isCurrent:()=>true}):persistence.saveMemoryCreativeBook(f.client,{ownerId:owner,albumId:bookId,revision:3,audience:'profile',draft:draft(),isCurrent:()=>true});
  await assert.rejects(work,/session changed/);const write=f.calls.at(-1);assert.equal(write.headers.Authorization,'Bearer fixture-only');assert.equal(write.signal.aborted,true);
 }
});
test('title cards, timing and movement are the same explicit preview/export timeline',()=>{
 const pages=[photo('photo-one'),photo('photo-two')],plan=film.planMemoryMovie(pages,settings()),timeline=film.memoryMovieTimeline(pages,plan,'Summer');
 assert.equal(timeline.length,4);assert.equal(timeline[0].movie.titleCard,'opening');assert.equal(timeline.at(-1).movie.titleCard,'closing');assert.equal(timeline.reduce((sum,item)=>sum+item.movie.durationSec,0),plan.durationSec);
 assert.equal(film.memoryMovieVisual(timeline[1],0).opacity,0);assert.equal(film.memoryMovieVisual(timeline[1],.5).opacity,1);assert.equal(film.memoryMovieVisual(timeline[1],1).opacity,0);
 assert.deepEqual(plain(film.memoryMovieVisual(timeline[1],.4,true)),{scale:1,x:0,y:0,opacity:1});assert.equal(timeline[1].uri,pages[0].media_url);
});
test('saved excerpt duration never pretends to be measured source-video duration',()=>{
 const page={id:'video-source',media_type:'video',media_url:'private:video',duration_sec:3,media_transform:{trimStart:10,trimEnd:16,speed:2}};
 const estimated=film.planMemoryMovie([page],settings({mode:'original'}));assert.equal(estimated.estimated,true);assert.equal(estimated.scenes[0].trimStart,10);assert.equal(estimated.scenes[0].durationSec,3);
 const measured=film.planMemoryMovie([page],settings({mode:'original'}),{'video-source':20});assert.equal(measured.estimated,false);assert.equal(measured.scenes[0].durationSec,3);
});
function accessFixture(){
 const base='https://project.example',page={id:storyId,story_id:storyId,media_type:'image',media_url:base+'/storage/v1/object/public/story-media/owner/photo.jpg'};
 let book={id:bookId,title:'Days',is_owner:true,can_view:true,pages:[page],presentation_revision:2},listener=null;
 const failures=[],controller=new AbortController();let reads=0,unsubscribed=0;
 const client={auth:{getUser:async()=>({data:{user:{id:owner}},error:null}),getSession:async()=>({data:{session:{user:{id:owner},access_token:'fixture-only'}},error:null}),onAuthStateChange:callback=>{listener=callback;return{data:{subscription:{unsubscribe(){unsubscribed++;}}}};}},rpc:async()=>{reads++;return{data:book,error:null};}};
 const expected={title:'Days',pages:[{...page,media_url:base+'/functions/v1/media-content/story-media/owner/photo.jpg?token='+'a'.repeat(64)}],revision:2};
 return {client,base,expected,bookId,signal:controller.signal,onInvalid:error=>failures.push(error.message),failures,setBook:value=>{book=value;},book:()=>book,emit:id=>listener('SIGNED_IN',{user:{id}}),reads:()=>reads,unsubscribed:()=>unsubscribed};
}
test('book access accepts fresh delivery capabilities for the same immutable object',async()=>{
 const f=accessFixture(),session=await accessLib.openMemoryMovieAccess(f);assert.equal(session.book.id,bookId);await session.check();assert.equal(f.reads(),2);session.stop();assert.equal(f.unsubscribed(),1);assert.equal(f.failures.length,0);
});
test('book revocation, revision changes and edited pages stop an export',async()=>{
 for(const mode of ['revoked','revision','page']){const f=accessFixture(),session=await accessLib.openMemoryMovieAccess(f),book=f.book();f.setBook(mode==='revoked'?{...book,can_view:false}:mode==='revision'?{...book,presentation_revision:3}:{...book,pages:[{...book.pages[0],caption:'Changed'}]});await assert.rejects(session.check(),/no longer available|changed during export/);assert.equal(f.failures.length,1);session.stop();}
});
test('an account round trip permanently invalidates the active movie access session',async()=>{
 const f=accessFixture(),session=await accessLib.openMemoryMovieAccess(f);f.emit(storyId);f.emit(owner);await assert.rejects(session.check(),/cancelled/);assert.equal(f.failures.length,1);session.stop();
});
const matrix=[1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0];
function nativeRequest(){return{id:'memory-request-1',outputUri:'file:///cache/pc-memory-export-1.mp4',width:720,height:1280,scenes:[{id:'scene-image-1',inputUri:'file:///cache/image.png',inputKind:'image',recipe:{width:720,height:1280,trimStart:0,trimEnd:4,speed:1,volume:0,fit:'contain',scale:1,x:0,y:0,matrix},layers:[],transition:{fadeSec:.35},motion:{fromScale:1,toScale:1.055,x:.018,y:0}}]};}
test('native movie contract binds total scenes, finite source edits and the continuous soundtrack envelope',()=>{
 const r=nativeRequest();assert.equal(nativeMovie.validateMemoryMovieRequest(r),4);
 r.soundtrack={uri:'file:///cache/audio.m4a',start:2,duration:3,volume:.4,loop:true,gain:[{start:0,end:4,volume:.12}]};assert.equal(nativeMovie.validateMemoryMovieRequest(r),4);
 for(const patch of [{gain:[{start:1,end:4,volume:1}]},{gain:[{start:0,end:3,volume:1}]},{uri:'https://unverified/audio'},{volume:NaN}])assert.throws(()=>nativeMovie.validateMemoryMovieRequest({...r,soundtrack:{...r.soundtrack,...patch}}));
 assert.throws(()=>nativeMovie.validateMemoryMovieRequest({...r,scenes:[...r.scenes,...r.scenes]}),/scene is invalid/);
 assert.throws(()=>nativeMovie.validateMemoryMovieRequest({...r,scenes:[{...r.scenes[0],motion:{fromScale:1,toScale:5,x:0,y:0}}]}),/movement/);
});
test('native movie acknowledgement verifies actual timeline, dimensions, scene count, bytes and audio',()=>{
 const r=nativeRequest(),good={uri:r.outputUri,width:720,height:1280,duration:4.03,bytes:20000,sceneCount:1,soundtrackMixed:false};assert.equal(nativeMovie.validateMemoryMovieResult(r,good).bytes,20000);
 for(const patch of [{duration:8},{width:1080},{uri:'file:///foreign.mp4'},{sceneCount:0},{bytes:0},{soundtrackMixed:true}])assert.throws(()=>nativeMovie.validateMemoryMovieResult(r,{...good,...patch}),/could not be verified/);
});
