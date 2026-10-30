const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto').webcrypto;
const root=path.resolve(__dirname,'../..'),owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',sound='20000000-0000-4000-8000-000000000001';
function wav(seconds=2){const rate=22050,bytes=Buffer.alloc(44+rate*seconds*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return new File([bytes],'Voice.wav',{type:'audio/wav'});}
function fixture(options={}){
 const calls=[],listeners=new Set(),cache=new Map();let current=options.owner||owner;
 const client={auth:{getSession:async()=>({data:{session:{user:{id:current},access_token:'captured-token'}}}),onAuthStateChange:fn=>{listeners.add(fn);return{data:{subscription:{unsubscribe(){listeners.delete(fn);}}}};}},rpc:async(name,args)=>{calls.push({name,args});if(name==='get_original_audio_capabilities')return options.legacy?{data:null,error:{code:'PGRST202'}}:{data:{version:1,uploadsEnabled:false},error:null};if(name==='reserve_original_audio')return{data:{id:args.p_request_id,path:`${args.p_expected_user}/${args.p_request_id}.wav`,status:'reserved'},error:null};return{data:options.denied?[]:[{id:sound,title:'Original',url:'canonical',duration_sec:2,source:options.catalog?'library':'original',max_excerpt_sec:30}],error:null};}};
 const hydrate={hydrateSoundMedia:async rows=>rows.map(row=>({...row,url:'private-delivery'}))};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Uint8Array,ArrayBuffer,DataView,TextDecoder,crypto,AbortController,setTimeout,clearTimeout,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon'}},fetch:async(url,request)=>{calls.push({url,request});if(url.includes('/storage/')){if(options.switchDuringUpload){current=other;for(const fn of listeners)fn('SIGNED_IN',{user:{id:other}});}return new Response('{}');}return new Response(JSON.stringify({soundId:sound}));},require:name=>{if(name==='./supabase/client')return{createClient:()=>client};if(name==='./contentMedia')return hydrate;return load(path.relative(root,path.resolve(path.dirname(path.join(root,file)),name+'.ts')));}});return exports;}
 return{api:load('web/lib/storyAudio.ts'),client,calls,listeners};
}
test('web original upload reserves, uploads without overwrite, verifies and returns a server ID without a playback token',async()=>{
 const h=fixture(),audio=await h.api.uploadStoryAudio(wav(),owner,h.client);
 assert.equal(audio.kind,'sound');assert.equal(audio.soundId,sound);assert.equal(audio.url,undefined);assert.equal(audio.durationSec,2);assert.equal(audio.rightsAttested,true);
 const reserve=h.calls.find(row=>row.name==='reserve_original_audio');assert.equal(reserve.args.p_expected_user,owner);assert.equal(reserve.args.p_reuse,false);assert.equal(reserve.args.p_rights_attested,true);
 const upload=h.calls.find(row=>row.url?.includes('/storage/'));assert.equal(upload.request.headers['x-upsert'],'false');assert.match(upload.url,/music-audio/);assert.equal(upload.request.headers.Authorization,'Bearer captured-token');
 assert.ok(h.calls.some(row=>row.url?.includes('/music-asset-finalize')));assert.equal(h.listeners.size,0);
});
test('actual byte format, duration and size fail before any reservation or Storage write',async()=>{
 for(const file of [wav(.2),wav(601),new File(['not an audio file'.repeat(50)],'bad.mp3',{type:'audio/mpeg'}),{size:52428801,arrayBuffer(){throw Error('must not read an oversized file');}}]){const h=fixture();await assert.rejects(()=>h.api.uploadStoryAudio(file,owner,h.client));assert.equal(h.calls.length,0);}
});
test('account changes before or during upload cannot attach audio to another account',async()=>{
 for(const options of [{owner:other},{switchDuringUpload:true}]){const h=fixture(options);await assert.rejects(()=>h.api.uploadStoryAudio(wav(),owner,h.client),/account/);assert.ok(!h.calls.some(row=>row.url?.includes('/music-asset-finalize')));assert.equal(h.listeners.size,0);}
});
test('previews use the verified sound ID and never trust arbitrary or older audio URLs',async()=>{
 const h=fixture();assert.equal(await h.api.storyAudioPreview({kind:'sound',soundId:sound,url:'https://untrusted.invalid'},h.client),'private-delivery');
 await assert.rejects(()=>h.api.storyAudioPreview({kind:'voiceover',url:'canonical'},h.client),/needs verification/);
 const denied=fixture({denied:true});await assert.rejects(()=>denied.api.storyAudioPreview({kind:'sound',soundId:sound},denied.client),/no longer available/);
});
test('the story library requests only server-authorized sound rows for story use',async()=>{
 const h=fixture();assert.equal((await h.api.listStorySounds(h.client)).length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(row=>row.name==='list_playable_sounds').args)),{p_use:'story',p_query:'',p_limit:100});
});

test('an older backend cannot return playable story audio before the verified library is installed',async()=>{const h=fixture({legacy:true});assert.equal((await h.api.listStorySounds(h.client)).length,0);await assert.rejects(()=>h.api.storyAudioPreview({kind:'sound',soundId:sound},h.client),/not available in this app environment/);assert.ok(h.calls.every(row=>row.name==='get_original_audio_capabilities'));});
test('story audio rejects catalogue rows even if a backend returns one',async()=>{const h=fixture({catalog:true});assert.equal((await h.api.listStorySounds(h.client)).length,0);await assert.rejects(()=>h.api.storyAudioPreview({kind:'sound',soundId:sound},h.client),/no longer available/);});
