// Exercises the installed Supabase SDK with synthetic storage/fetch only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient, processLock } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../..');
const base = 'https://media-concurrency.invalid';
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const raw = `${base}/storage/v1/object/public/post-media/${owner}/photo.jpg`;
const signed = `${base}/storage/v1/object/sign/post-media/${owner}/photo.jpg?token=synthetic`;
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function compile(file, additions = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, Request, Response, AbortController, setTimeout, clearTimeout, console, ...additions });
  return module.exports;
}
const media = compile('shared/contentMedia.ts');
const { profileRead } = compile('src/utils/profileRead.ts');
// Token identity must not change when the wall clock crosses a second between
// creating a synthetic session and verifying its request in the fetch fixture.
const fixtureExpiresAt = Math.floor(Date.now()/1000)+3600;
function jwt(id) {
  return [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'), Buffer.from(JSON.stringify({sub:id,exp:fixtureExpiresAt})).toString('base64url'),'synthetic-signature'].join('.');
}
const session = id => ({ access_token:jwt(id), refresh_token:'synthetic-refresh-'+id, expires_at:fixtureExpiresAt, token_type:'bearer', user:{id} });
function sdk({ holdUser = false, holdSigner = false, authFailure = false } = {}) {
  const storage = new Map(), calls = [], users = [], signers = [];
  const key = 'media-fixture-'+Math.random(); storage.set(key, JSON.stringify(session(owner)));
  const client = createClient(base, 'test-only-public-key', {
    auth:{storageKey:key,autoRefreshToken:false,persistSession:true,detectSessionInUrl:false,lock:processLock,
      storage:{getItem:async key=>storage.get(key)??null,setItem:async(key,value)=>{storage.set(key,value);},removeItem:async key=>{storage.delete(key);}}},
    global:{fetch:async(input,init)=>{
      const url=new URL(input),authorization=new Headers(init?.headers).get('authorization'); calls.push({path:url.pathname,authorization});
      if(url.pathname==='/auth/v1/user') {
        const id=authorization===`Bearer ${jwt(other)}`?other:owner;
        const response=()=>new Response(JSON.stringify(authFailure?{msg:'Verification failed',code:'bad_jwt'}:{id}),{status:authFailure?401:200,headers:{'Content-Type':'application/json'}});
        if(holdUser){const gate=deferred();users.push({release:()=>gate.resolve(response())});return gate.promise;}
        return response();
      }
      if(url.pathname==='/functions/v1/content-media-sign') {
        const response=()=>new Response(JSON.stringify({urls:[{key:`post-media/${owner}/photo.jpg`,url:signed}],expiresAt:Date.now()+300000}),{headers:{'Content-Type':'application/json'}});
        if(holdSigner){const gate=deferred();signers.push({release:()=>gate.resolve(response())});return gate.promise;}
        return response();
      }
      if(url.pathname.startsWith('/rest/v1/'))return new Response(JSON.stringify({is_owner:true,books:[]}),{headers:{'Content-Type':'application/json'}});
      throw Error('Unexpected synthetic request '+url.pathname);
    }},
  });
  return {client,calls,users,signers,releaseUsers(){users.splice(0).forEach(x=>x.release());},releaseSigners(){signers.splice(0).forEach(x=>x.release());}};
}
async function drainUntil(check) { for(let i=0;i<30&&!check();i++)await turn(); assert.ok(check(),'expected SDK request to reach synthetic fetch'); }

test('installed SDK reproduces the old lock stall: getUser() blocks unrelated profile queries before fetch', async () => {
  const h=sdk({holdUser:true}); await h.client.auth.getSession();
  const auth=h.client.auth.getUser(); await drainUntil(()=>h.users.length===1);
  let readFinished=false;
  const query=Promise.resolve(h.client.rpc('get_memory_albums',{p_owner:owner})).then(value=>{readFinished=true;return value;});
  await turn(); await turn();
  assert.equal(readFinished,false); assert.equal(h.calls.some(x=>x.path.startsWith('/rest/v1/')),false);
  h.releaseUsers(); await Promise.all([auth,query]); assert.equal(readFinished,true);
  await h.client.auth.stopAutoRefresh();
});

test('post and album media verification run concurrently without holding session or database reads', async () => {
  const h=sdk({holdUser:true}); await h.client.auth.getSession();
  const post=media.hydrateContentMedia(h.client,base,[{id:owner,media_url:raw}],'post');
  const book=media.hydrateContentMedia(h.client,base,[{id:other,cover_page:{story_id:owner,media_url:raw}}],'memory_album');
  try {
    await drainUntil(()=>h.users.length===2);
    let sessionFinished=false,queryFinished=false;
    const local=h.client.auth.getSession().then(()=>{sessionFinished=true;});
    const query=Promise.resolve(h.client.rpc('get_memory_albums',{p_owner:owner})).then(()=>{queryFinished=true;});
    await drainUntil(()=>sessionFinished&&queryFinished);
    assert.equal(h.users.length,2,'verification is still deliberately pending');
    h.releaseUsers(); await Promise.all([local,query]);
    const [posts,books]=await Promise.all([post,book]);
    assert.equal(posts[0].media_url,signed); assert.equal(books[0].cover_page.media_url,signed);
    const calls=h.calls.filter(x=>x.path==='/functions/v1/content-media-sign');
    assert.equal(calls.length,2); assert.ok(calls.every(x=>x.authorization===`Bearer ${jwt(owner)}`));
  } finally { h.releaseUsers(); await Promise.allSettled([post,book]); await h.client.auth.stopAutoRefresh(); }
});

test('failed server verification cannot reach the signer or return raw media', async () => {
  const h=sdk({authFailure:true});
  await assert.rejects(media.hydrateContentMedia(h.client,base,[{id:owner,media_url:raw}],'post'),/Sign in again/);
  assert.equal(h.calls.some(x=>x.path==='/functions/v1/content-media-sign'),false);
  await h.client.auth.stopAutoRefresh();
});

test('A to B to A account changes during signing invalidate the original capability result', async () => {
  const h=sdk({holdSigner:true});
  const work=media.hydrateContentMedia(h.client,base,[{id:owner,media_url:raw}],'post');
  const rejected=assert.rejects(work,/account changed/);
  try {
    await drainUntil(()=>h.signers.length===1);
    const changed=await h.client.auth.setSession(session(other));
    assert.equal(changed.error,null);assert.equal(changed.data.user.id,other);
    const restored=await h.client.auth.setSession(session(owner));
    assert.equal(restored.error,null);assert.equal(restored.data.user.id,owner);
    h.releaseSigners(); await rejected;
  } finally { h.releaseSigners(); await Promise.allSettled([work]); await h.client.auth.stopAutoRefresh(); }
});

function transport(fetcher) {
  let captured;
  compile('src/services/supabase.ts',{
    __DEV__:false,fetch:fetcher,process:{env:{EXPO_PUBLIC_SUPABASE_URL:base,EXPO_PUBLIC_SUPABASE_ANON_KEY:'test-only-key'}},
    require(name){
      if(name==='@supabase/supabase-js')return{processLock,createClient(_url,_key,options){captured=options.global.fetch;return{};}};
      if(name==='react-native')return{Platform:{OS:'web'},AppState:{addEventListener(){throw Error('web transport fixture must not add native listeners');}}};
      if(name==='@react-native-async-storage/async-storage')return{};
      if(name==='react-native-url-polyfill/auto')return{};
      throw Error(name);
    },
  });
  return captured;
}
test('a request cancelled before transport does not start network work',async()=>{
  let calls=0; const fetcher=transport(async()=>{calls++;return new Response('{}');});
  const controller=new AbortController();controller.abort();
  await assert.rejects(fetcher(base,{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(fetcher(new Request(base,{signal:controller.signal})),{name:'AbortError'});
  assert.equal(calls,0);
});
test('transport removes its caller abort listener after success and failure',async()=>{
  for(const failure of [false,true]){
    const listeners=new Set();let nativeSignal;
    const caller={aborted:false,addEventListener(_event,fn){listeners.add(fn);},removeEventListener(_event,fn){listeners.delete(fn);}};
    const gate=deferred(),fetcher=transport((_input,init)=>{nativeSignal=init.signal;return gate.promise;});
    const work=fetcher(base,{signal:caller});assert.equal(listeners.size,1);
    for(const fn of listeners)fn();assert.equal(nativeSignal.aborted,true);
    if(failure){gate.reject(Error('network failure'));await assert.rejects(work,/network failure/);}
    else{gate.resolve(new Response('{}'));await work;}
    assert.equal(listeners.size,0);
  }
});
test('a profile read deadline includes the SDK pre-fetch wait and cancels late transport',async()=>{
  let signal,finish,calls=0;
  const fetcher=transport(async()=>{calls++;return new Response('{}');});
  const gate=deferred();
  const query={abortSignal(value){signal=value;return this;},then(resolve,reject){finish=gate.promise.then(()=>fetcher(base,{signal}));return finish.then(resolve,reject);}};
  await assert.rejects(profileRead(query,5),/too long/);
  assert.equal(signal.aborted,true);assert.equal(calls,0);
  gate.resolve();await assert.rejects(finish,{name:'AbortError'});assert.equal(calls,0);
});
