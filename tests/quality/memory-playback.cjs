const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../../shared/memoryPlayback.ts'),'utf8');
const moduleObject={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleObject,exports:moduleObject.exports});
const {createMemoryPlaybackClock,memoryPhotoDuration}=moduleObject.exports;
test('photos advance after their displayed duration, never before the first ready frame',()=>{
 const clock=createMemoryPlaybackClock();assert.equal(clock.step('photo',0,false,6000).progress,0);
 assert.equal(clock.step('photo',50000,true,6000).end,false);
 assert.equal(clock.step('photo',53000,true,6000).progress,.5);
 assert.equal(clock.step('photo',56000,true,6000).end,true);
 assert.equal(clock.step('photo',57000,true,6000).end,false,'completion emits only once');
});
test('pausing or backgrounding preserves elapsed time and never skips pages on return',()=>{
 const clock=createMemoryPlaybackClock();clock.step('one',0,true,6000);clock.step('one',2000,true,6000);clock.pause();
 assert.equal(clock.step('one',60000,false,6000).progress,1/3);
 assert.equal(clock.step('one',120000,true,6000).progress,1/3);
 assert.equal(clock.step('one',124000,true,6000).end,true);
});
test('manual next, previous, album switch and replay each start a fresh page clock',()=>{
 const clock=createMemoryPlaybackClock();clock.step('album:one:0',0,true,3000);clock.step('album:one:0',3000,true,3000);
 for(const key of ['album:two:0','album:one:0','other:one:0','other:one:1'])assert.equal(clock.step(key,9000,true,3000).progress,0);
});
test('photo durations are finite and readable even when old metadata is invalid',()=>{
 assert.equal(memoryPhotoDuration({duration_sec:8}),8000);assert.equal(memoryPhotoDuration({duration_sec:.1}),3000);
 for(const duration_sec of [0,-3,NaN,Infinity,'6',null])assert.equal(memoryPhotoDuration({duration_sec}),6000);
 assert.equal(memoryPhotoDuration({duration_sec:9999}),30000);
});

function playbackHook() {
 const slots=[],timers=new Map();let cursor=0,now=0,nextTimer=0;
 const hooks={
  useRef(initial){const i=cursor++;return slots[i]||(slots[i]={current:initial});},
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,j)=>value!==old.deps[j])){old?.cleanup?.();slots[i]={deps,cleanup:effect()};}},
 };
 const factoryModule={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../shared/useMemoryPlayback.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  module:factoryModule,exports:factoryModule.exports,require:name=>{assert.equal(name,'./memoryPlayback','shared hook has no React import');return moduleObject.exports;},
  Date:{now:()=>now},setInterval:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),
 });
 const usePlayback=factoryModule.exports.createMemoryPlaybackHook(hooks);
 return{render(key,active,duration,onEnd=()=>{}){cursor=0;return usePlayback(key,active,duration,onEnd);},tick(time){now=time;for(const fn of [...timers.values()])fn();},dispose(){for(const slot of slots)slot.cleanup?.();},get timers(){return timers.size;}};
}
test('the portable hook retains progress, uses the latest completion callback, and releases its timer',()=>{
 const h=playbackHook(),ended=[];
 assert.equal(h.render('photo',true,6000,()=>ended.push('old')),0);assert.equal(h.timers,1);
 h.tick(3000);assert.equal(h.render('photo',true,6000,()=>ended.push('current')),.5);
 h.tick(6000);h.tick(7000);assert.deepEqual(ended,['current']);assert.equal(h.render('photo',true,6000),1);
 h.dispose();assert.equal(h.timers,0);
});
test('the portable hook pauses elapsed time and hides the old page progress before the next effect',()=>{
 const h=playbackHook();h.render('photo',true,6000);h.tick(2000);assert.equal(h.render('photo',false,6000),1/3);assert.equal(h.timers,0);
 h.tick(90000);assert.equal(h.render('photo',true,6000),1/3);h.tick(92000);assert.equal(h.render('photo',true,6000),2/3);
 assert.equal(h.render('next',true,6000),0);h.tick(95000);assert.equal(h.render('next',true,6000),.5);h.dispose();
});
