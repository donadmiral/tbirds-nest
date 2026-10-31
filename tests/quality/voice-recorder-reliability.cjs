const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/controllers/messages/useVoiceRecorder.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function scenario(options={}) {
 let cursor=0,now=1000000,sequence=0,unmounted=false;
 const slots=[],effects=[],timers=new Map();
 const counts={permission:0,prepare:0,record:0,stop:0},modes=[],records=[];
 const recorder={uri:null,isRecording:false,
  prepareToRecordAsync:async()=>{counts.prepare++;if(options.prepare)await options.prepare();},
  record:opts=>{counts.record++;records.push(opts);if(options.recordThrows)throw Error('record failed');recorder.isRecording=true;},
  stop:async()=>{counts.stop++;if(options.stop)await options.stop();recorder.isRecording=false;recorder.uri='file://voice.m4a';},
 };
 const same=(a,b)=>a?.length===b?.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={
  useRef:value=>{const i=cursor++;return slots[i]??(slots[i]={current:value});},
  useState:value=>{const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],next=>{assert.equal(unmounted,false,'no state update after unmount');slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useCallback:(fn,deps)=>{const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
  useEffect:(fn,deps)=>{const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
 };
 const audio={AudioModule:{requestRecordingPermissionsAsync:async()=>{counts.permission++;return options.permission?await options.permission():{granted:true};},setAudioModeAsync:async mode=>{modes.push(mode);if(options.mode)await options.mode(mode);}},AudioQuality:{MAX:127},IOSOutputFormat:{MPEG4AAC:'aac'},RecordingPresets:{HIGH_QUALITY:{android:{},ios:{}}},useAudioRecorder:()=>recorder,useAudioRecorderState:()=>({metering:-20})};
 const exports={};
 const context={exports,require:name=>{if(name==='react')return react;if(name==='expo-audio')return audio;throw Error(name);},Date:{now:()=>now},setInterval:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)};
 vm.runInNewContext(source,context);
 const render=()=>{cursor=0;const api=exports.useVoiceRecorder();while(effects.length)effects.shift()();return api;};
 render();
 return{get api(){return render();},recorder,counts,modes,records,timers,exports,
  advance:seconds=>{now+=seconds*1000;for(const fn of [...timers.values()])fn();},
  unmount:()=>{for(const slot of slots)slot?.cleanup?.();unmounted=true;},
 };
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
test('duplicate start requests acquire the microphone only once',async()=>{
 const permission=deferred(),h=scenario({permission:()=>permission.promise});
 const first=h.api.start();assert.equal(await h.api.start(),false);assert.equal(h.counts.permission,1);
 permission.resolve({granted:true});assert.equal(await first,true);assert.equal(h.counts.prepare,1);assert.equal(h.counts.record,1);
 await h.api.cancel();assert.equal(h.timers.size,0);
});
test('concurrent stops share the finalized file; retry keeps it until explicitly cleared',async()=>{
 const gate=deferred(),h=scenario({stop:()=>gate.promise});await h.api.start();h.advance(12);
 const first=h.api.stop(),second=h.api.stop();assert.equal(h.counts.stop,1);gate.resolve();
 const [a,b]=await Promise.all([first,second]);assert.equal(a.uri,'file://voice.m4a');assert.equal(a.durationSec,12);assert.equal(b,a);
 assert.equal(await h.api.stop(),a);assert.equal(await h.api.start(),false);assert.equal(h.api.result,a);
 h.api.clearResult();assert.equal(h.api.result,null);assert.equal(await h.api.start(),true);await h.api.cancel();
});
test('cancelling the permission prompt cannot start a late recording or release the operation lock early',async()=>{
 const permission=deferred(),h=scenario({permission:()=>permission.promise});const start=h.api.start();await h.api.cancel();
 assert.equal(await h.api.start(),false);permission.resolve({granted:true});assert.equal(await start,false);
 assert.equal(h.counts.prepare,0);assert.equal(h.counts.record,0);assert.equal(h.api.recording,false);
});
test('cancelling during preparation cleans the native recorder and restores playback mode',async()=>{
 const prepare=deferred(),h=scenario({prepare:()=>prepare.promise});const start=h.api.start();await flush();await flush();
 assert.equal(h.counts.prepare,1);await h.api.cancel();assert.equal(await h.api.start(),false);
 prepare.resolve();assert.equal(await start,false);assert.equal(h.counts.record,0);assert.equal(h.counts.stop,1);
 assert.equal(h.modes.at(-1).allowsRecording,false);assert.equal(h.api.result,null);
});
test('cancelling an in-flight stop suppresses its result and blocks a new recording until cleanup completes',async()=>{
 const gate=deferred(),h=scenario({stop:()=>gate.promise});await h.api.start();h.advance(6);
 const stop=h.api.stop();await h.api.cancel();assert.equal(await h.api.start(),false);
 gate.resolve();assert.equal(await stop,null);assert.equal(h.api.result,null);assert.equal(h.api.seconds,0);assert.equal(h.counts.stop,1);
 assert.equal(await h.api.start(),true);await h.api.cancel();
});
test('permission denial is visible and does not prepare or change audio mode',async()=>{
 const h=scenario({permission:async()=>({granted:false})});assert.equal(await h.api.start(),false);
 assert.match(h.api.error,/Microphone access/);assert.equal(h.counts.prepare,0);assert.equal(h.modes.length,0);
});
test('native start failure releases a prepared recording and audio mode',async()=>{
 const h=scenario({recordThrows:true});assert.equal(await h.api.start(),false);
 assert.equal(h.counts.stop,1);assert.equal(h.modes.at(-1).allowsRecording,false);assert.match(h.api.error,/start recording/);
});
test('stop failure still restores playback mode and permits another attempt',async()=>{
 const h=scenario({stop:async()=>{throw Error('disk failure');}});await h.api.start();h.advance(3);
 assert.equal(await h.api.stop(),null);assert.equal(h.modes.at(-1).allowsRecording,false);assert.match(h.api.error,/save the recording/);
 assert.equal(await h.api.start(),true);await h.api.cancel();
});
test('unmounting while prepare resolves later cleans up without updating unmounted state',async()=>{
 const gate=deferred(),h=scenario({prepare:()=>gate.promise});const start=h.api.start();await flush();await flush();h.unmount();gate.resolve();
 assert.equal(await start,false);assert.equal(h.counts.record,0);assert.equal(h.counts.stop,1);assert.equal(h.modes.at(-1).allowsRecording,false);
});
test('the native limit and displayed/file durations remain capped at five minutes',async()=>{
 const h=scenario();await h.api.start();assert.equal(h.records[0].forDuration,300);h.advance(450);
 assert.equal(h.api.seconds,300);assert.equal(h.api.atLimit,true);assert.equal(h.timers.size,0);
 const saved=await h.api.stop();assert.equal(saved.durationSec,300);assert.equal(h.api.recording,false);
});

test('a stale URI cannot turn a failed active stop into a successful voice note',async()=>{
 const h=scenario({stop:async()=>{throw Error('stop failed');}});h.recorder.uri='file://old-voice.m4a';await h.api.start();h.advance(4);
 assert.equal(await h.api.stop(),null);assert.equal(h.api.result,null);assert.match(h.api.error,/save the recording/);
});
test('a native duration-limit finalization remains sendable when stop reports already stopped',async()=>{
 const h=scenario({stop:async()=>{throw Error('already stopped');}});await h.api.start();h.advance(300);h.recorder.uri='file://finished.m4a';h.recorder.isRecording=false;
 const saved=await h.api.stop();assert.equal(saved.uri,'file://finished.m4a');assert.equal(saved.durationSec,300);
});
test('cancel during audio-mode setup restores playback and keeps the lock until cleanup finishes',async()=>{
 const setup=deferred(),cleanup=deferred(),h=scenario({mode:mode=>mode.allowsRecording?setup.promise:cleanup.promise});
 const start=h.api.start();await flush();await h.api.cancel();setup.resolve();await flush();
 assert.equal(await h.api.start(),false);assert.equal(h.counts.prepare,0);cleanup.resolve();assert.equal(await start,false);
});
