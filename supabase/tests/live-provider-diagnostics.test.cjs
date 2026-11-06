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
test('eject diagnostics preserve the original request and response and emit only fixed response metadata',async()=>{
 const room='pc-live-'+'b'.repeat(32),target=`https://api.daily.co/v1/rooms/${room}/eject`;
 const secret='credential-123456789012345678901234567890',identity='10000000-0000-4000-8000-000000000001';
 for(const [status,body,expected] of [
  [200,{ejectedIds:[]},{code:'unclassified',no_current_call:false,ejected_ids_array:true,ejected_ids_count:0}],
  [200,{ejectedIds:[identity],private:secret},{code:'unclassified',no_current_call:false,ejected_ids_array:true,ejected_ids_count:1}],
  [200,{unexpected:secret,ejectedIds:identity},{code:'unclassified',no_current_call:false,ejected_ids_array:false,ejected_ids_count:null}],
  [404,{error:'not-found',info:`room ${room} does not seem to be hosting a call currently`},{code:'not-found',no_current_call:true,ejected_ids_array:false,ejected_ids_count:null}],
  [404,{error:'not-found',info:'room pc-live-'+'c'.repeat(32)+' does not seem to be hosting a call currently'},{code:'not-found',no_current_call:false,ejected_ids_array:false,ejected_ids_count:null}],
  [400,{error:secret,info:`Bearer ${secret} https://private.test/${identity}`},{code:'unclassified',no_current_call:false,ejected_ids_array:false,ejected_ids_count:null}],
 ]){
  const original=Response.json(body,{status}),logs=[],init={method:'POST',headers:{Authorization:'Bearer '+secret},body:JSON.stringify({user_ids:[identity],ban:true})};
  const wrapped=withProviderDiagnostics(async(input,options)=>{assert.equal(input,target);assert.equal(options,init);return original;},value=>logs.push(value));
  const response=await wrapped(target,init);
  assert.equal(response,original);assert.deepEqual(await response.json(),body);
  assert.deepEqual(JSON.parse(JSON.stringify(logs)),[{event:'live_provider_eject_response',action:'eject',status,body_kind:'object',...expected}]);
  for(const privateValue of [secret,identity,room,target,'private.test','Bearer'])assert.ok(!JSON.stringify(logs).includes(privateValue));
 }
});
test('malformed and oversized eject responses retain their original bytes and bounded classifications',async()=>{
 const target='https://api.daily.co/v1/rooms/pc-live-'+'d'.repeat(32)+'/eject';
 for(const [body,kind] of [['x'.repeat(9000),'too_large'],['<html>private vendor failure</html>','non_json'],['[]','non_object']]){
  const original=new Response(body,{status:503}),logs=[];
  const response=await withProviderDiagnostics(async()=>original,value=>logs.push(value))(target);
  assert.equal(response,original);assert.equal(await response.text(),body);assert.equal(logs.length,1);
  assert.equal(logs[0].body_kind,kind);assert.equal(logs[0].code,'unclassified');assert.equal(logs[0].status,503);
  assert.equal(logs[0].ejected_ids_array,false);assert.equal(logs[0].ejected_ids_count,null);
  assert.ok(JSON.stringify(logs).length<300);assert.ok(!JSON.stringify(logs).includes('private vendor'));
 }
});
test('eject diagnostics cannot change behavior when the log sink fails and never inspect an unrelated room or origin',async()=>{
 const target='https://api.daily.co/v1/rooms/pc-live-'+'e'.repeat(32)+'/eject';
 const original=Response.json({ejectedIds:[]});
 assert.equal(await withProviderDiagnostics(async()=>original,()=>{throw Error('unavailable log sink');})(target),original);
 for(const unrelated of ['https://api.daily.co/v1/rooms/unrelated/eject',target.replace('api.daily.co','private.invalid')]){
  const response=Response.json({secret:'keep-private'},{status:404}),logs=[];
  assert.equal(await withProviderDiagnostics(async()=>response,value=>logs.push(value))(unrelated),response);
  assert.equal(logs.length,0);assert.equal((await response.json()).secret,'keep-private');
 }
});
