const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const {createFilmHarness}=require('../helpers/memoryFilmHarness.cjs');

test('continuous native film waits for media, advances every page, and loops without stopping',async()=>{
 const h=createFilmHarness(ts,'native');await h.settle();await h.tick(10000);assert.match(h.words(),/1 \/ 2/);h.mediaReady();await h.settle();await h.tick(6000);assert.match(h.words(),/2 \/ 2/);h.mediaReady();await h.settle();await h.tick(6000);assert.match(h.words(),/1 \/ 2/);assert.ok(h.nodes().some(node=>node.props.accessibilityLabel==='Pause memory film'));assert.equal(h.sounds.length,1,'score remains the same player across pages');assert.ok(h.sounds[0].status.every(status=>status.shouldPlay),'no between-page soundtrack pause');h.dispose();
});
test('a one-photo film replays with a fresh clock and native pause/background do not jump time',async()=>{
 const h=createFilmHarness(ts,'native',{pages:[{id:'one',media_type:'image',media_url:'signed:one'}]});await h.settle();h.mediaReady();await h.settle();await h.tick(3000);h.press('Pause memory film');await h.settle();await h.tick(90000);assert.match(h.words(),/1 \/ 1/);h.press('Play memory film');await h.settle();h.setForeground(false);await h.settle();await h.tick(90000);h.setForeground(true);await h.settle();await h.tick(3000);assert.ok(h.nodes().some(node=>node.props.accessibilityLabel==='Pause memory film'));h.mediaReady();await h.settle();assert.equal(h.nodes().find(n=>n.props.accessibilityRole==='progressbar').props.accessibilityValue.now,0);h.dispose();
});
test('a one-photo native loop remounts its media frame so the next run receives readiness',async()=>{
 const h=createFilmHarness(ts,'native',{pages:[{id:'one',media_type:'image',media_url:'signed:one'}]});await h.settle();
 const frame=()=>h.nodes().find(node=>node.type==='AnimatedView'&&node.props.children?.type==='MemoryStoryFrame');
 const first=frame().key;assert.ok(first,'the native image frame needs a playback key');
 h.mediaReady();await h.settle();await h.tick(6000);
 const next=frame().key;assert.notEqual(next,first,'React must remount the same URI when a new playback run needs onLoad');
 h.mediaReady();await h.settle();await h.tick(3000);assert.equal(h.nodes().find(node=>node.props.accessibilityRole==='progressbar').props.accessibilityValue.now,50);h.dispose();
});
test('native film controls wrap both directions, preserve the book, and isolate original audio from music',async()=>{
 const h=createFilmHarness(ts,'native');await h.settle();h.press('Previous memory');await h.settle();assert.match(h.words(),/2 \/ 2/);h.press('Next memory');await h.settle();assert.match(h.words(),/1 \/ 2/);h.press('Turn off background music');await h.settle();assert.equal(h.sounds[0].status.at(-1).shouldPlay,false);h.press('Read memory book');assert.equal(h.read,1);h.press('Close memory film');assert.equal(h.closed,1);h.dispose();
});
test('native film pauses music on calls and releases a soundtrack loaded after unmount',async()=>{
 const h=createFilmHarness(ts,'native');await h.settle();h.setCall('connected');await h.settle();assert.equal(h.sounds[0].status.at(-1).shouldPlay,false);h.setCall('idle');await h.settle();assert.equal(h.sounds[0].status.at(-1).shouldPlay,true);h.dispose();assert.equal(h.sounds[0].unload,1);
 const late=createFilmHarness(ts,'native',{deferredAudio:true});await late.settle();late.dispose();late.resolveAudio();await late.settle();assert.equal(late.sounds[0].unload,1);assert.equal(late.sounds[0].status.length,0);
});
test('native film media deadline is actionable and does not silently skip a failed page',async()=>{
 const h=createFilmHarness(ts,'native');await h.settle();await h.tick(20000);assert.match(h.words(),/taking too long/);assert.match(h.words(),/1 \/ 2/);const retry=h.nodes().find(n=>n.type==='TouchableOpacity'&&n.props.children?.props?.children==='Retry');retry.props.onPress();await h.settle();assert.equal(h.retries,1);assert.doesNotMatch(h.words(),/taking too long/);h.dispose();
});
test('native film private backdrops are uncached and its prefetch effect skips private capabilities',async()=>{
 const root=path.resolve(__dirname,'../..'),source=fs.readFileSync(path.join(root,'src/components/memory/MemoryFilm.tsx'),'utf8');
 const ast=ts.createSourceFile('MemoryFilm.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect;
 const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('Image.prefetch'))effect=node.arguments[0].getText(ast);ts.forEachChild(node,visit);};visit(ast);assert.ok(effect);
 const privateUrls=['https://example.test/functions/v1/media-content/post-media/member/photo.jpg?token='+'a'.repeat(64),'https://example.test/storage/v1/object/sign/story-media/member/photo.jpg?token=fixture','https://example.test/functions/v1/limited-media-file?token=fixture'];
 for(const uri of privateUrls){
  const h=createFilmHarness(ts,'native',{pages:[{id:'one',media_type:'image',media_url:uri}]});await h.settle();
  const background=h.nodes().find(node=>node.props.blurRadius===38);assert.equal(background.props.cachePolicy,'none');
  const calls=[],module={exports:{}};
  require('node:vm').runInNewContext(ts.transpileModule('const effect = '+effect+'; effect();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,items:[{kind:'image',uri}],index:0,privateImageCachePolicy:h.load('shared/mediaDelivery.ts').privateImageCachePolicy,Image:{prefetch:async value=>{calls.push(value);}}});
  assert.equal(calls.length,0);h.dispose();
 }
 const h=createFilmHarness(ts,'native'),calls=[];
 require('node:vm').runInNewContext(ts.transpileModule('const effect = '+effect+'; effect();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{items:[{kind:'image',uri:'https://public.example.test/photo.jpg'}],index:0,privateImageCachePolicy:h.load('shared/mediaDelivery.ts').privateImageCachePolicy,Image:{prefetch:async value=>{calls.push(value);}}});
 assert.deepEqual(calls,['https://public.example.test/photo.jpg']);h.dispose();
});
test('native film video honors trim/speed and advances once at the real media boundary',async()=>{
 const h=createFilmHarness(ts,'native',{component:'video'});await h.settle();const p=h.players[0];assert.equal(p.currentTime,2);assert.equal(p.playbackRate,2);assert.equal(p.loop,false);p.emit('timeUpdate',{currentTime:3.5});assert.equal(h.progress.at(-1),.5);p.emit('timeUpdate',{currentTime:5});p.emit('playToEnd',{});assert.equal(h.ended,1);assert.equal(p.playing,false);h.dispose();
});
test('native film video cannot complete or continue playback while backgrounded or inactive',async()=>{
 const h=createFilmHarness(ts,'native',{component:'video'});await h.settle();const p=h.players[0];h.setForeground(false);await h.settle();assert.equal(p.playing,false);p.emit('timeUpdate',{currentTime:5});assert.equal(h.ended,0);h.setForeground(true);h.setActive(false);await h.settle();p.emit('playToEnd',{});assert.equal(h.ended,0);h.dispose();
});
test('film source selection includes embedded videos and text posts without inventing URLs',async()=>{
 const h=createFilmHarness(ts,'native'),lib=h.load('shared/memoryFilm.ts');const [video,text]=lib.memoryFilmItems([{id:'v',media_type:'text',stickers:JSON.stringify([{kind:'post',postId:'post',postMediaType:'video',postMediaUrl:'signed:post',postText:'A memory',postAuthorName:'Don'}])},{id:'t',stickers:[{kind:'post',postText:'Text-only story'}]}]);assert.equal(video.kind,'video');assert.equal(video.uri,'signed:post');assert.equal(video.author,'Don');assert.equal(text.kind,'text');assert.equal(text.uri,null);assert.equal(text.excerpt,'Text-only story');assert.deepEqual(JSON.parse(JSON.stringify(lib.memoryFilmStep(0,1,1))),{index:0,wrapped:true});assert.equal(lib.memoryFilmVideoWindow({media_transform:{}},NaN).end,null);h.dispose();
});
test('original music assets match and their generated receipt verifies duration, codec, clipping and seam',()=>{
 const root=path.resolve(__dirname,'../..'),native=fs.readFileSync(path.join(root,'assets/audio/platinum-memory-score.m4a')),web=fs.readFileSync(path.join(root,'web/public/audio/platinum-memory-score.m4a')),receipt=JSON.parse(fs.readFileSync(path.join(root,'assets/audio/platinum-memory-score.json'),'utf8'));
 assert.deepEqual(native,web);assert.equal(crypto.createHash('sha256').update(native).digest('hex'),receipt.sha256);assert.equal(receipt.seconds,25.6);assert.equal(receipt.codec,'aac');assert.equal(receipt.channels,2);assert.ok(receipt.decoded_peak<.8);assert.ok(receipt.decoded_loop_boundary_delta<.005);assert.match(receipt.provenance,/no third-party samples/);
});
