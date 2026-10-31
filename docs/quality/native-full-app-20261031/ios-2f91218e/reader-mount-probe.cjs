'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const root='/workspace/scratch/f9638ed3020b/platinum-circles',file=path.join(root,'tests/quality/native-memory-album-loading.cjs');
let source=fs.readFileSync(file,'utf8').split("\ntest('held optional reactions")[0];
function replace(before,after){assert.ok(source.includes(before),`probe anchor missing ${before.slice(0,70)}`);source=source.replace(before,after)}
replace('heldAuth = false, heldMedia = false, heldAnimation = false, reducedMotion = true, platform', 'heldAuth = false, heldMedia = false, heldAnimation = false, reducedMotion = true, holdReduceMotion = false, platform');
replace('const animationAcknowledgements = [];','const animationAcknowledgements = []; const counts = { renders:0, authReads:0, audioCreates:0, soundtrackReads:0, animationStarts:0, animationStops:0, animationValues:0, intervalStarts:0, intervalClears:0 }; const activeIntervals=new Set();');
replace('class AnimatedValue { setValue() {} stopAnimation() {} interpolate() { return 1; } }','class AnimatedValue { setValue() { counts.animationValues++; } stopAnimation() { counts.animationStops++; } interpolate() { return 1; } }');
replace('isReduceMotionEnabled: async () => reducedMotion','isReduceMotionEnabled: () => holdReduceMotion ? new Promise(()=>{}) : Promise.resolve(reducedMotion)');
replace('start(callback) {\n        if (typeof callback', 'start(callback) {\n        counts.animationStarts++;\n        if (typeof callback');
replace('getSession: () => session.promise','getSession: () => { counts.authReads++; return session.promise; }');
replace("'src/services/supabase': { supabase },", "'src/services/supabase': { supabase, SUPABASE_URL:'https://uaulhuelcfkjwojtymmw.supabase.co' },\n    'expo-av': { Audio:{Sound:{createAsync(){counts.audioCreates++; throw Error('unexpected audio creation before reader opened')}}}},\n    'src/services/soundtrackService':{getSoundtrack(){counts.soundtrackReads++; throw Error('unexpected soundtrack lookup before reader opened')}},");
replace("    'src/services/contentMedia': {\n      hydrateMemoryAlbumMedia: rows => heldMedia ? queued(media, { rows }) : Promise.resolve(rows),\n      hydrateStoryMedia: async rows => rows,\n    },\n",'');
replace("    'src/hooks/useMemoryPlayback': { useMemoryPlayback: () => 0 },\n",'');
replace("    'src/hooks/useSoundtrackPlayer': { useSoundtrackPlayer: () => ({ error: null, loading: false }) },\n",'');
replace("if (key.startsWith('shared/')) return load(`${key}.ts`);","if (key.startsWith('shared/') || key.startsWith('src/hooks/') || key === 'src/services/contentMedia') return load(`${key}.ts`);");
replace("setInterval: fn => ({ fn }), clearInterval() {}, requestAnimationFrame", "setInterval: (fn,ms) => { counts.intervalStarts++; const timer={fn,ms};activeIntervals.add(timer);return timer; }, clearInterval(timer) { if(timer){counts.intervalClears++;activeIntervals.delete(timer)} }, requestAnimationFrame");
replace('dirty = false; cursor = 0; tree = Component(props);','dirty = false; cursor = 0; counts.renders++; tree = Component(props);');
replace('books, reactions, toggles, media, soundtrackSaves, session, flush,','books, reactions, toggles, media, soundtrackSaves, session, flush, counts, activeIntervals,\n    activity(state) { appState.currentState=state;for(const fn of [...appListeners])fn(state); },\n    stats(){return { ...counts, bookReads:books.length, reactionReads:reactions.length, activeIntervals:[...activeIntervals].map(x=>x.ms), authSubscriptions:authListeners.size, appSubscriptions:appListeners.size, loading:h.loading() }},');
source+='\nmodule.exports={harness,book,OWNER};\n';
const m={exports:{}};
vm.runInNewContext(source,{module:m,exports:m.exports,require:createRequire(file),__dirname:path.dirname(file),__filename:file,process,console,setImmediate,setTimeout,clearTimeout,URL,AbortController},{filename:file});
const {harness,book,OWNER}=m.exports;
(async()=>{
const rows=[];
for(const holdReduceMotion of [false,true]){
 const h=harness({heldAuth:true,heldAnimation:true,reducedMotion:false,holdReduceMotion});
 try{
  await h.flush();const initial=h.stats();assert.equal(initial.bookReads,0);assert.ok(initial.loading);assert.equal(initial.audioCreates,0);assert.equal(initial.soundtrackReads,0);
  const before=initial.renders;for(let i=0;i<10;i++)await h.flush();assert.equal(h.counts.renders,before,'held auth must settle without render feedback');
  h.session.resolve({data:{session:{user:{id:OWNER},access_token:'synthetic-test-token'}},error:null});await h.flush();const auth=h.stats();assert.equal(auth.bookReads,1);assert.ok(auth.loading);
  const authRenders=auth.renders;for(let i=0;i<10;i++)await h.flush();assert.equal(h.counts.renders,authRenders);assert.equal(h.books.length,1,'pending book must not trigger repeated loads');
  await h.authorize(book());const loaded=h.stats();assert.equal(loaded.loading,false);assert.ok(h.visible('Edit memory book'));assert.ok(h.visible('Open book'));assert.equal(loaded.audioCreates,0);assert.equal(loaded.soundtrackReads,0);assert.equal(loaded.bookReads,1);assert.equal(loaded.reactionReads,1);
  const loadedRenders=loaded.renders;for(let i=0;i<10;i++)await h.flush();assert.equal(h.counts.renders,loadedRenders,'loaded reader must settle with optional reactions held');
  h.activity('background');await h.flush();h.activity('active');await h.flush();const resumed=h.stats();assert.equal(resumed.bookReads,2,'one explicit active event causes one required refresh');assert.equal(resumed.loading,false,'warm refresh keeps authorized content');
  h.dispose();const disposed=h.stats();assert.equal(disposed.authSubscriptions,0);assert.equal(disposed.appSubscriptions,0);assert.equal(disposed.activeIntervals.length,0);
  rows.push({case:holdReduceMotion?'reduce-motion callback held':'reduce-motion callback resolved',initial,authorizedPending:auth,loaded,resumed,disposed,status:'PASS'});
 }finally{h.dispose()}
}
const inputs=['src/screens/profile/MemoryAlbumScreen.tsx','src/hooks/useMemoryPlayback.ts','shared/useMemoryPlayback.ts','shared/memoryPlayback.ts','src/hooks/useSoundtrackPlayer.ts','shared/useMemorySoundtrackSave.ts','src/services/contentMedia.ts','shared/contentMedia.ts','tests/quality/native-memory-album-loading.cjs','tests/native/memory-fixture.cjs'].map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')}));
console.log(JSON.stringify({scope:'Two scratch actual-screen/actual-playback/soundtrack/media-helper probes, controlled React hooks/native primitives/auth/book promises. Not native runtime validation or proof that the iPhone did not stall.',cases:rows,source:inputs,limits:['Navigation useIsFocused, CallContext, theme and safe-area contexts remain controlled.','Native Animated, AppState, AccessibilityInfo and Audio delivery are simulated; holding callbacks cannot emulate UIKit main-run-loop behavior.','Actual media hydrator executes on the real two-text-page navigation fixture; no private-media hydration calls are needed.','Only explicit active lifecycle event triggers a second required load in this probe.','Absent artifact body/auth traces prevent assigning the real native spinner to a required wait.']},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
