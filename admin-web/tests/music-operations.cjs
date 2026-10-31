const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const exportsValue={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/musicReport.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsValue,Date,Number});
const {musicReportWindow,musicUsageCsv}=exportsValue;
test('UTC music reports accept bounded exact dates and reject rollover, reverse and oversized windows',()=>{
 assert.equal(musicReportWindow('2026-10-01','2026-11-01').start,'2026-10-01T00:00:00.000Z');
 for(const pair of [[null,'2026-11-01'],['2026-02-30','2026-03-01'],['2026-11-01','2026-10-01'],['2026-10-01','2026-11-02'],['2026-10-1','2026-10-02']])assert.equal(musicReportWindow(...pair),null);
});
test('CSV quotes fields and neutralizes external-title spreadsheet formulas',()=>{
 for(const title of ['=HYPERLINK("https://example.test")',' +SUM(1,2)','\t@evil','-1+1']){
  const csv=musicUsageCsv([{day:'2026-10-30',event_type:'attachment',provider_id:'platinum',provider_track_id:null,title,use_kind:'post',territory:'Unknown',operations:'1'}]);assert.ok(csv.includes('"\''));assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.endsWith('\r\n'));
 }
 const csv=musicUsageCsv([{day:'2026-10-30',event_type:'attachment',provider_id:'platinum',provider_track_id:'id',title:'Text, "quote"\nnext',use_kind:'post',territory:'US',operations:'9'}]);assert.ok(csv.includes('"Text, ""quote""\nnext"'));
});
function loadModule(file,modules){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,File,FormData,Response,URL,Date,Number,Promise,JSON,require:name=>{if(name in modules)return modules[name];throw new Error('Unexpected import '+name);}});return exports;}
function actions(){const calls=[];const state={error:null,denied:false};const exports=loadModule('app/music/actions.ts',{
 'next/navigation':{redirect:url=>{throw new Error('REDIRECT '+url);}},'next/cache':{revalidatePath:url=>calls.push({cache:url})},
 '@/lib/adminAuth':{requirePermission:async permission=>{calls.push({permission});if(state.denied)throw new Error('Forbidden');return{id:'verified-staff',sessionId:'verified-session'};}},
 '@/lib/supabaseAdmin':{serviceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{error:state.error};}})},
 });return{...exports,calls,state};}
function form(content='{"version":1,"tracks":[]}'){const data=new FormData();data.set('manifest',new File([content],'manifest.json',{type:'application/json'}));data.set('providerId','provider');data.set('requestId','10000000-0000-4000-8000-000000000001');data.set('actor','untrusted-substitution');return data;}
test('catalogue staging action binds writes to the current verified staff and session',async()=>{
 const a=actions();await assert.rejects(()=>a.stageMusicCatalogue(form()),/REDIRECT \/music\?result=staged/);
 const write=a.calls.find(c=>c.name==='admin_stage_music_catalogue');assert.equal(write.args.p_actor,'verified-staff');assert.equal(write.args.p_session,'verified-session');assert.equal(write.args.p_provider,'provider');assert.equal(a.calls[0].permission,'post_moderate');
});
test('catalogue action rejects malformed, oversized and missing files before any database write',async()=>{
 for(const data of [form('not-json'),form('x'.repeat(262145)),new FormData()]){const a=actions();await assert.rejects(()=>a.stageMusicCatalogue(data),/invalid-catalogue/);assert.equal(a.calls.some(c=>c.name),false);}
});
test('staff authentication and failed staging never produce a saved result',async()=>{
 const blocked=actions();blocked.state.denied=true;await assert.rejects(()=>blocked.stageMusicCatalogue(form()),/Forbidden/);assert.equal(blocked.calls.some(c=>c.name),false);
 const failed=actions();failed.state.error={message:'Service unavailable'};await assert.rejects(()=>failed.stageMusicCatalogue(form()),/catalogue-failed/);assert.equal(failed.calls.some(c=>c.cache),false);
});
test('report route validates dates, rechecks staff and returns errors without a fake download',async()=>{
 const calls=[];let fail=false;const route=loadModule('app/api/music/report/route.ts',{
 '@/lib/adminAuth':{requirePermission:async()=>({id:'staff',sessionId:'session'})},'@/lib/supabaseAdmin':{serviceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return fail?{error:{message:'Offline'},data:null}:{error:null,data:{metric:'server_operations_not_plays_or_royalties',rows:[]}};}})},'@/lib/musicReport':exportsValue,
 });
 let response=await route.GET(new Request('https://example.test/api/music/report?start=2026-02-30&end=2026-03-01'));assert.equal(response.status,400);assert.equal(calls.length,0);
 response=await route.GET(new Request('https://example.test/api/music/report?start=2026-10-01&end=2026-10-31'));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.ok(response.headers.get('Content-Disposition').includes('attachment'));assert.equal(calls[0].args.p_session,'session');
 fail=true;response=await route.GET(new Request('https://example.test/api/music/report?start=2026-10-01&end=2026-10-31'));assert.equal(response.status,503);assert.equal(response.headers.has('Content-Disposition'),false);
});
