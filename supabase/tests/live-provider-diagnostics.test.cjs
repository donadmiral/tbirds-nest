const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const moduleBox={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../functions/live-core/providerDiagnostics.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleBox,exports:moduleBox.exports,URL,Request,Response,TextDecoder});
const {withProviderDiagnostics,redactProviderReason}=moduleBox.exports;
const url='https://api.daily.co/v1/rooms/pc-live-'+'a'.repeat(32)+'/live-streaming/stop';
test('redacts credentials, signed URLs, identifiers and email from operator reasons',()=>{
 const reason=redactProviderReason('Invalid instanceId 10000000-0000-4000-8000-000000000001 at https://private.test/a?ticket=secret user@example.test Bearer abcdefghijklmnop abcdefghijklmnopqrstuvwxyz123456');
 for(const secret of ['10000000','private.test','ticket','user@example','abcdefghijklmnop'])assert.ok(!reason.includes(secret));
 assert.ok(reason.includes('instanceId'));assert.ok(reason.length<=180);
});
test('logs only redacted control rejection and returns original response untouched',async()=>{
 const original=Response.json({error:'invalid-request-error',info:'Invalid instanceId 10000000-0000-4000-8000-000000000001'},{status:400}),logs=[];
 const wrapped=withProviderDiagnostics(async()=>original,v=>logs.push(v));
 const response=await wrapped(url,{method:'POST',headers:{Authorization:'Bearer never-log-this'}});
 assert.equal(response,original);assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid-request-error');
 assert.equal(logs.length,1);assert.equal(logs[0].action,'stop');assert.equal(logs[0].status,400);assert.ok(!JSON.stringify(logs).includes('never-log-this'));assert.ok(!JSON.stringify(logs).includes('10000000'));
});
test('successes and unrelated endpoints are never inspected or logged',async()=>{
 for(const [target,status] of [[url,200],['https://private.invalid/sign',400],['https://api.daily.co/v1/meeting-tokens',400]]){
  const original=Response.json({secret:'keep-private'},{status}),logs=[];
  const response=await withProviderDiagnostics(async()=>original,v=>logs.push(v))(target);
  assert.equal(response,original);assert.equal(logs.length,0);assert.equal((await response.json()).secret,'keep-private');
 }
});
test('oversized and non-JSON vendor errors do not alter failure handling',async()=>{
 for(const body of ['x'.repeat(9000),'<html>Unavailable</html>']){
  const original=new Response(body,{status:400}),logs=[];
  const response=await withProviderDiagnostics(async()=>original,v=>logs.push(v))(url);
  assert.equal(response,original);assert.equal(await response.text(),body);assert.equal(logs.length,0);
 }
});
