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
