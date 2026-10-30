const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..'),base='https://project.supabase.co',owner='00000000-0000-4000-8000-000000000001';
function compile(file, imports, extra={}) {
 const exports={};const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,URL,console,Date,process:{env:{NEXT_PUBLIC_SUPABASE_URL:base}},require:name=>{assert.ok(name in imports,`Unexpected import ${name}`);return imports[name];},...extra});return exports;
}
for (const file of ['web/lib/chatMedia.ts','src/services/chatMediaService.ts']) {
 test(file+' delivers group avatars without persistent signed URLs and rejects late account responses',async()=>{
  let listener,user='one',pending;const calls=[];
  const client={auth:{getSession:async()=>({data:{session:{user:{id:user}}}}),onAuthStateChange:fn=>{listener=fn;return{data:{subscription:{unsubscribe(){}}}};}},rpc:async(name,args)=>{calls.push({name,urls:Array.from(args.p_urls)});if(pending)await pending;return{data:args.p_urls.map(u=>({bucket_id:'chat-media',object_path:u.split('/public/chat-media/')[1],token:'a'.repeat(64),expires_at:new Date(Date.now()+300000).toISOString()}))};}};
  const m=compile(file,{'@/lib/supabase/client':{createClient:()=>client},'./supabase':{supabase:client,SUPABASE_URL:base},'../../shared/mediaDelivery':compile('shared/mediaDelivery.ts',{})});
  const rows=[{id:'legacy',group_avatar_url:`${base}/storage/v1/object/public/chat-media/${owner}/avatar.jpg?t=1`},{id:'public',group_avatar_url:'https://images.test/avatar.png'}];
  const signed=await m.signGroupAvatars(rows);assert.match(signed[0].group_avatar_url,/\/functions\/v1\/media-content\/chat-media\//);assert.equal(signed[1].group_avatar_url,rows[1].group_avatar_url);assert.deepEqual(calls[0],{name:'issue_chat_object_delivery',urls:[`${base}/storage/v1/object/public/chat-media/${owner}/avatar.jpg`]});
  let done;pending=new Promise(resolve=>done=resolve);const request=m.signGroupAvatars(rows);await new Promise(resolve=>setImmediate(resolve));user='two';listener('SIGNED_IN',{user:{id:user}});done();assert.equal((await request)[0].group_avatar_url,null);
 });
}
const shared=compile('shared/applicationCv.ts',{});
for(const file of ['web/lib/applicationCv.ts','src/services/applicationCvService.ts'])test(file+' re-signs legacy CV references instead of opening old public URLs',async()=>{
 const calls=[];const client={storage:{from:bucket=>({createSignedUrl:async(p,ttl)=>{calls.push({bucket,path:p,ttl});return{data:{signedUrl:'https://signed.test/cv'}};}})}};
 const m=compile(file,{'../../shared/applicationCv':shared,'@supabase/supabase-js':{},'react-native-get-random-values':{},'expo-file-system/legacy':{},'base64-arraybuffer':{},'./supabase':{supabase:client,SUPABASE_URL:base}});
 const call=reference=>file.startsWith('web')?m.applicationCvDownload(client,reference):m.applicationCvUrl(reference);
 assert.equal(await call(`${base}/storage/v1/object/public/chat-files/${owner}/resume.pdf?t=123`),'https://signed.test/cv');assert.deepEqual(calls,[{bucket:'chat-files',path:`${owner}/resume.pdf`,ttl:60}]);
 await assert.rejects(call(`https://evil.test/storage/v1/object/public/chat-files/${owner}/resume.pdf`));
 await assert.rejects(call(`${base}/storage/v1/object/public/chat-files/${owner}/%2e%2e/resume.pdf`));
});
