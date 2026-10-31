const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const id='10000000-0000-4000-8000-000000000001',user='10000000-0000-4000-8000-000000000002';
async function render(row,available=true){
 const m={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/users/deletions/page.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module:m,exports:m.exports,require(name){
  if(name==='react/jsx-runtime')return require(name);
  if(name==='next/link')return({href,children,...props})=>React.createElement('a',{href,...props},children);
  if(name==='@/components/Shell')return({children,title})=>React.createElement('main',{},React.createElement('h1',{},title),children);
  if(name==='@/components/CommandForm')return({children})=>React.createElement('form',{},children);
  if(name==='@/lib/adminAuth')return{requirePermission:async()=>({id:user,sessionId:id})};
  if(name==='@/lib/supabaseAdmin')return{serviceClient:()=>({rpc:async()=>({data:{rows:[{id,user_id:user,source:'self_service',reason:'financial_records',status:'retention_review',created_at:'2026-10-30T00:00:00Z',full_name:'Synthetic member',username:'synthetic',version:'f'.repeat(32),files_total:0,files_erased:0,...row}],total:1,operator_review_available:available},error:null})})};
  if(name==='@/lib/adminRpcAvailability')return{isMissingAdminRpc:()=>false};
  if(name==='@/lib/adminErasureReview')return{ERASURE_HOLDS:{financial_records:'Financial or order records require retention review.'}};
  if(name==='./actions')return{reviewErasure:async()=>{throw Error('Rendering must not submit a review')}};
  throw Error('Unexpected import '+name);
 }});
 return renderToStaticMarkup(await m.exports.default({searchParams:Promise.resolve({})}));
}
test('actual queue does not turn an uninventoried hold into a zero-file erasure claim',async()=>{
 const html=await render({});assert.match(html,/Stored-file inventory is awaiting review/);assert.doesNotMatch(html,/0 of 0 stored files verified erased/);
 assert.match(html,/Recheck and resume eligible erasure/);assert.match(html,/name="confirm" value="RESUME"/);
});
test('actual queue removes dead profile links after identity preparation or completion',async()=>{
 for(const state of [{identity_prepared:true,status:'retention_review'},{identity_prepared:true,status:'identity_pending'},{identity_prepared:null,status:'completed',completed_at:'2026-10-30T00:01:00Z'}]){
  const html=await render(state);assert.doesNotMatch(html,new RegExp(`href="/users/${user}"`));
  if(state.status==='completed')assert.match(html,/Verified complete/);
 }
});
test('actual queue keeps review actions unavailable on the older read-only contract',async()=>{
 const html=await render({},false);assert.doesNotMatch(html,/<form|Recheck and resume eligible erasure|Add review note/);
});
