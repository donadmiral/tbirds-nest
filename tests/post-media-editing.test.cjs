const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const scope={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../shared/postMediaEditing.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
const {postAspectRatio,postTrimWindow,normalizePostCaptions,postCaptionAt,applyPostCaptionTiming,normalizePostRotation,postRotationParts}=scope.exports;

test('new post frames default to 4:5 and preserve existing square, landscape and original recipes',()=>{
  assert.equal(postAspectRatio(null,1920,1080),.8);
  assert.equal(postAspectRatio({aspect:'square'},1920,1080),1);
  assert.equal(postAspectRatio({aspect:'landscape'}),1.91);
  assert.equal(postAspectRatio({aspect:'original'},1920,1080),16/9);
  assert.equal(postAspectRatio({aspectRatio:16/9,aspect:'square'}),16/9);
  for(const aspectRatio of [NaN,Infinity,0,-1,100])assert.equal(postAspectRatio({aspectRatio}),.8);
});
test('trim selection bounds stay valid and selected cover frames are before end of file',()=>{
  const trimmed=postTrimWindow(10,7,20);assert.equal(trimmed.start,7);assert.equal(trimmed.end,10);assert.equal(trimmed.coverEnd,9.95);
  const reversed=postTrimWindow(10,20,-1);assert.ok(reversed.start>=0&&reversed.end>reversed.start&&reversed.end<=10);
  const short=postTrimWindow(.04,0,.04);assert.ok(short.coverEnd>=0&&short.coverEnd<short.end);
  const empty=postTrimWindow(NaN,Infinity,-1);assert.equal(empty.duration,0);assert.equal(empty.coverEnd,0);
});
test('caption normalization removes blanks and invalid windows, clamps duration, and bounds text and count',()=>{
  const captions=normalizePostCaptions([{text:' ',start:0,end:5},{text:'Too late',start:10,end:12},{text:'  Our weekend  ',start:-5,end:99,style:'unknown',position:'unknown'},...Array.from({length:12},(_,i)=>({text:'x'.repeat(200),start:i,end:5}))],5);
  assert.equal(captions[0].text,'Our weekend');assert.equal(captions[0].start,0);assert.equal(captions[0].end,5);assert.equal(captions[0].style,'clean');assert.equal(captions[0].position,'bottom');assert.ok(captions.length<=8);assert.ok(captions.every(c=>c.text.length<=160&&c.end>c.start&&c.end<=5));
});
test('captions use absolute source time, disappear on their end boundary, and prefer a newer overlapping cue',()=>{
  const cues=[{id:'one',text:'First',start:5,end:9,style:'clean',position:'bottom'},{id:'two',text:'Second',start:7,end:8,style:'bold',position:'top'}];
  assert.equal(postCaptionAt(cues,4.9),null);assert.equal(postCaptionAt(cues,5).text,'First');assert.equal(postCaptionAt(cues,7).text,'Second');assert.equal(postCaptionAt(cues,8).text,'First');assert.equal(postCaptionAt(cues,9),null);
  assert.equal(postCaptionAt([{text:'Long clip',start:700,end:710}],705).text,'Long clip');
});

test('caption timing commits finite fractional drafts, rejects invalid text and clamps to the trimmed clip',()=>{
 const cue={id:'cue',text:'Moment',start:2,end:8,style:'clean',position:'bottom'};
 const precise=applyPostCaptionTiming(cue,{start:'2.5',end:'9.25'},2,10);assert.equal(precise.start,2.5);assert.equal(precise.end,9.25);
 const invalid=applyPostCaptionTiming(cue,{start:'',end:'not a number'},2,10);assert.equal(invalid.start,2);assert.equal(invalid.end,8);
 const bounded=applyPostCaptionTiming(cue,{start:'-9',end:'99'},2,10);assert.equal(bounded.start,2);assert.equal(bounded.end,10);
});
test('rotation parts preserve full turns, right-angle bases and signed straighten endpoints',()=>{
 for(const value of [-450,-180,-135,-90,-45,0,45,90,135,180,270,450]){const parts=postRotationParts(value);assert.ok(parts.straighten>=-45&&parts.straighten<=45);assert.equal(normalizePostRotation(parts.base+parts.straighten),normalizePostRotation(value));}
 assert.equal(postRotationParts(45).straighten,45);assert.equal(postRotationParts(-45).straighten,-45);assert.equal(normalizePostRotation(270),-90);
});
