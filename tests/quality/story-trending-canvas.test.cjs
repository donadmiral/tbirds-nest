const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname,'../..');
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports, require: name => { if (name in mocks) return mocks[name]; throw new Error(name); }, setTimeout, clearTimeout});
  return exports;
}
const {resolveTrendingStories,loadTrendingStories} = load('shared/trendingStories.ts');
const {moveStorySticker,storyStickerLabel} = load('shared/storyCanvas.ts');
const rank = (id, owner = id) => ({story_id:id,user_id:owner});
const media = (id, patch = {}) => ({id,user_id:id,media_type:'image',media_url:'https://signed.example/'+id,thumbnail_url:null,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),...patch});
test('ranked previews reject missing, denied, expired, mismatched and duplicate author media', () => {
  const ranks = ['good','missing','denied','expired','wrong','text','second'].map(id => rank(id,id === 'second' ? 'good' : id));
  const rows = [media('good'),media('denied',{media_url:null}),media('expired',{expires_at:'2020-01-01'}),media('wrong',{user_id:'someone-else'}),media('text',{media_type:'text',media_url:null}),media('second',{user_id:'good'})];
  assert.equal(JSON.stringify(resolveTrendingStories(ranks,rows).map(x=>x.story_id)), JSON.stringify(['good','text']));
  assert.equal(ranks[0].thumb,undefined,'input ranking stays immutable');
});
function source(patch = {}) {
  return {session: async()=>({data:{session:{user:{id:'viewer'}}},error:null}),ranked: async()=>({data:[rank('a')],error:null}),stories:async()=>({data:[media('a')],error:null}),...patch};
}
test('network failures and signing failures never reuse unresolved ranking rows', async () => {
  await assert.rejects(()=>loadTrendingStories(source({ranked:async()=>({data:null,error:'offline'})}),async rows=>rows),/could not be loaded/);
  await assert.rejects(()=>loadTrendingStories(source({stories:async()=>({data:[],error:'denied'})}),async rows=>rows),/could not be loaded/);
  await assert.rejects(()=>loadTrendingStories(source(),async()=>{throw new Error('signing unavailable')}),/signing unavailable/);
  assert.equal((await loadTrendingStories(source(),async rows=>rows.map(row=>({...row,media_url:null})))).length,0);
});
test('account change during signing discards the previous account preview', async () => {
  let owner='viewer'; const api=source({session:async()=>({data:{session:{user:{id:owner}}},error:null})});
  assert.equal((await loadTrendingStories(api,async rows=>{owner='new-viewer';return rows;})).length,0);
});
test('signed out caller performs no ranking request',async()=>{
  let called=false;
  assert.equal((await loadTrendingStories(source({session:async()=>({data:{session:null},error:null}),ranked:async()=>{called=true;}}),async rows=>rows)).length,0);
  assert.equal(called,false);
});
test('canvas movement preserves grab offset, snaps to centre and clamps overscroll',()=>{
  const moved=moveStorySticker({nx:.2,ny:.3},10,20,100,200); assert.ok(Math.abs(moved.nx-.3)<.001); assert.ok(Math.abs(moved.ny-.4)<.001);
  const centre=moveStorySticker({nx:.48,ny:.49},0,0,400,800); assert.equal(centre.nx,.5); assert.equal(centre.ny,.5); assert.equal(centre.vertical,true);
  const clamped=moveStorySticker({nx:.2,ny:.3},-200,1000,100,200); assert.equal(clamped.nx,.05);assert.equal(clamped.ny,.95);
});
test('edited text updates interactive question, countdown and location metadata',()=>{
  assert.equal(storyStickerLabel('quiz','New question').quizQuestion,'New question');
  assert.equal(storyStickerLabel('countdown','Launch').countdownTitle,'Launch');
  assert.equal(storyStickerLabel('location','Harare').locationDisplayName,'Harare');
  assert.equal(storyStickerLabel('hashtag','#Zimbabwe').hashtag,'Zimbabwe');
});
function bridge(fail=false) {return load('src/components/stories/DualCameraComposerBridge.ts',{
  'react-native':{Image:{getSize:(_uri,ok,error)=>fail?error():ok(1000,1500)}},
  'expo-video-thumbnails':{getThumbnailAsync:async()=>({width:1080,height:1920})},
  './dual/dualCaptureTypes':{DEFAULT_LAYOUT:{mode:'pip_front_small'}}
});}
test('dual capture preserves Android content URIs and real portrait video dimensions',async()=>{
  const b=bridge();const asset=await b.prepareDualAsset({frontPath:'content://photo/1',rearPath:'file:///video.mp4',mode:'video'});
  assert.equal(asset.frontUri,'content://photo/1');assert.equal(asset.rearDimensions.width,1080);assert.equal(asset.rearDimensions.height,1920);
  assert.equal(b.normalizeCaptureUri('/photo.jpg'),'file:///photo.jpg');
  assert.equal(b.buildComposerParams(asset,{mode:'broken',assets:[]}).mode,'dual');
  assert.equal(b.buildComposerParams(asset,{assets:[]}).assets[0],asset);
});
test('dual capture fails visibly instead of constructing a zero-size missing image',async()=>{
  await assert.rejects(()=>bridge(true).prepareDualAsset({frontPath:'/missing',rearPath:'/other',mode:'photo'}),/could not be opened/);
});
