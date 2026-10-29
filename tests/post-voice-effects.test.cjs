const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const scope={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../shared/postVoiceEffects.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
const {applyPostPlayback,postPlaybackSettings,normalizePostPlayback}=scope.exports;

test('voice presets change pitch and pace on the same video player, keeping source audio synchronized',()=>{
  const player={playbackRate:1,preservesPitch:true,webkitPreservesPitch:true,currentTime:7};
  applyPostPlayback(player,{voiceEffect:'chipmunk',trimStart:5,trimEnd:9});
  assert.equal(player.playbackRate,1.5);assert.equal(player.preservesPitch,false);assert.equal(player.webkitPreservesPitch,false);
  assert.equal(player.currentTime,7,'choosing a voice must not seek the clip');
  applyPostPlayback(player,{voiceEffect:'deep'});assert.equal(player.playbackRate,.75);
});

test('a reused player restores natural pitch for the next original clip',()=>{
  const player={playbackRate:1,preservesPitch:true};
  applyPostPlayback(player,{voiceEffect:'chipmunk'});
  applyPostPlayback(player,{speed:1.5});
  assert.equal(player.playbackRate,1.5);assert.equal(player.preservesPitch,true);
  applyPostPlayback(player,null);assert.equal(player.playbackRate,1);assert.equal(player.preservesPitch,true);
});

test('viewer speed combines with authored speed without losing the saved effect or exceeding audible rates',()=>{
  assert.equal(postPlaybackSettings({speed:2,voiceEffect:'deep'},1.5).rate,2.25);
  assert.equal(postPlaybackSettings({speed:3,voiceEffect:'chipmunk'},3).rate,4);
  assert.equal(postPlaybackSettings({speed:1,voiceEffect:'original'},NaN).rate,1);
});

test('shared post playback snapshots allow only supported bounded fields',()=>{
  const recipe=normalizePostPlayback({speed:Infinity,voiceEffect:'forged',muted:'true',trimStart:-9,trimEnd:'12',soundtrack:{url:'untrusted'},coverUrl:'untrusted'});
  assert.equal(recipe.speed,1);assert.equal(recipe.voiceEffect,'original');assert.equal(recipe.muted,false);assert.equal(recipe.trimStart,0);assert.equal(recipe.trimEnd,null);
  assert.equal('soundtrack' in recipe,false);assert.equal('coverUrl' in recipe,false);
  assert.deepEqual(Object.keys(recipe).sort(),['muted','speed','trimEnd','trimStart','voiceEffect']);
});
