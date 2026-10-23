const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const sdk = require('@supabase/supabase-js');

const uid = '10000000-0000-4000-8000-000000000002';
const sid = '10000000-0000-4000-8000-000000000003';
const fid = '10000000-0000-4000-8000-000000000004';
const origin = 'https://admin-review.example.invalid';
const secret = 'synthetic-recovery-signing-secret-for-tests-only';
function form(values) { const f = new FormData(); for (const [key,value] of Object.entries(values)) f.set(key,value); return f; }

function harness(options = {}) {
  let clock = Math.floor(Date.now()/1000);
  class TestDate extends Date { static now() { return clock * 1000; } }
  const env = { NODE_ENV: 'production', VERCEL_ENV: 'preview', ADMIN_AUTH_ORIGINS: origin,
    NEXT_PUBLIC_SUPABASE_URL: 'https://qa.example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-publishable', SUPABASE_SERVICE_ROLE_KEY: secret };
  const stored = new Map(), writes = [], requests = [], revocations = [];
  const jar = { get: key => stored.has(key) ? { value: stored.get(key) } : undefined,
    set(key,value,config) { writes.push({key,value,config}); if (config.maxAge===0) stored.delete(key); else stored.set(key,value); },
    delete(key) { stored.delete(key); } };
  const token = (aal = 'aal1', method = 'recovery', timestamp=clock) => [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid,session_id:sid,exp:clock+3600,aal,amr:[{method,timestamp}]})).toString('base64url'),'test'].join('.');
  const user = { id:uid,email:'staff@example.invalid',aud:'authenticated',created_at:new Date().toISOString(),app_metadata:{},user_metadata:{},factors: options.factors || [] };
  const session = (access_token=token()) => ({access_token,refresh_token:'synthetic-refresh',expires_in:3600,expires_at:clock+3600,token_type:'bearer',user});
  let active = options.active !== false, consumed = false, challenge = null;
  const authorized = async value => {
    if (!active || !value) return null;
    try { const c=JSON.parse(Buffer.from(value.split('.')[1],'base64url')); if(c.sub!==uid||c.session_id!==sid||c.exp<=clock)return null;
      return {id:uid,sessionId:sid,aal:c.aal,role:'super_admin',email:user.email}; } catch {return null;}
  };
  const fetch = async (input,init={}) => {
    const url = new URL(input), method=init.method||'GET', body=init.body?JSON.parse(init.body):null;
    requests.push({url,method,body,headers:new Headers(init.headers)});
    let payload=user,status=200;
    if(url.pathname==='/auth/v1/recover') {
      challenge=body.code_challenge;
      status=options.recoverStatus||200; payload=status===200?{}:{code:'synthetic_error',msg:'private provider detail'};
    } else if(url.pathname==='/auth/v1/token') {
      assert.equal(url.searchParams.get('grant_type'),'pkce');
      const actual = crypto.createHash('sha256').update(body.code_verifier).digest('base64url');
      if(body.auth_code!=='synthetic-code'||actual!==challenge||consumed) {status=400;payload={code:'flow_state_expired',msg:'Invalid code'};}
      else {consumed=true;payload=session();}
    } else if(url.pathname==='/auth/v1/factors/'+fid+'/challenge') payload={id:'synthetic-challenge',expires_at:clock+60};
    else if(url.pathname==='/auth/v1/factors/'+fid+'/verify') {
      if(body.code!=='123456'){status=400;payload={code:'mfa_verification_failed',msg:'Invalid code'};}
      else payload=session(token('aal2'));
    } else if(url.pathname==='/auth/v1/user' && method==='PUT') {
      if(options.updateError){status=422;payload={code:options.updateError,msg:'private provider detail'};}
      else payload=user;
    } else if(url.pathname!=='/auth/v1/user') throw new Error('Unexpected mock request '+url.pathname);
    return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
  };
  const service={auth:{getUser:async()=>({data:{user},error:null}),admin:{signOut:async(t,scope)=>{
    revocations.push({token:t,scope});if(options.revokeFailure)return {error:{status:503}};active=false;return {error:null};
  }}}};
  const anonClient=()=>sdk.createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch}});
  const modules = {};
  function load(file) {
    if(modules[file])return modules[file];
    const module={exports:{}};
    const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,Buffer,URL,Headers,Map,Date:TestDate,process:{env},fetch,
      require(name){
        if(name==='server-only')return {};
        if(name==='next/headers')return {cookies:async()=>jar,headers:async()=>new Headers({origin:options.origin||origin})};
        if(name==='./adminAuth')return {adminFromToken:authorized};
        if(name==='./supabaseAdmin'||name==='@/lib/supabaseAdmin')return {anonClient,serviceClient:()=>service};
        if(name.startsWith('@/lib/'))return load(name.replace('@/','')+'.ts');
        if(name.startsWith('./adminRecovery'))return load('lib/'+name.slice(2)+'.ts');
        return require(name);
      }},{filename:file});modules[file]=module.exports;return module.exports;
  }
  const recovery=load('lib/adminRecovery.ts'),actions=load('app/reset-password/actions.ts');
  return {clock:()=>clock, advance:seconds=>{clock+=seconds;}, env,stored,writes,requests,revocations,recovery,actions,session,token,user,
    setActive:value=>{active=value;},load,
    async start(){const result=await actions.requestPasswordReset(form({email:'Staff@Example.Invalid'}));assert.equal(result.success,true);const url=requests.find(r=>r.url.pathname.endsWith('/recover')).url;
      const redirect=new URL(url.searchParams.get('redirect_to'));return {redirect, flowId:redirect.searchParams.get('sb_flow_id')};},
    async exchange(flowId){const client=await recovery.recoveryPkceClient();return client.auth.exchangeCodeForSession('synthetic-code',flowId?{flowId}:undefined);},
  };
}

test('installed SDK sends PKCE reset and redeems it only with the same browser verifier',async()=>{
  const h=harness(),{redirect,flowId}=await h.start();
  assert.equal(redirect.origin,origin);assert.equal(redirect.pathname,'/reset-password/callback');assert.equal(flowId,null); // Default SDK preserves the exact allowlisted callback URL.
  const send=h.requests[0];assert.equal(send.body.email,'staff@example.invalid');assert.equal(send.body.code_challenge_method,'s256');
  assert.ok(h.writes.length>=3);for(const w of h.writes){assert.equal(w.config.httpOnly,true);assert.equal(w.config.secure,true);assert.equal(w.config.path,'/reset-password');assert.equal(w.config.maxAge,600);}
  const stranger=harness();const missing=await stranger.exchange(flowId);assert.ok(missing.error);assert.equal(stranger.requests.length,0);
  const exchanged=await h.exchange(flowId);assert.equal(exchanged.error,null);assert.equal(await h.recovery.beginRecovery(exchanged.data.session),true);
  assert.equal((await h.recovery.recoveryView()).needsMfa,false);
  assert.ok(h.stored.has('pc_admin_recovery'));assert.equal(h.stored.has('pc_admin_token'),false);
  assert.ok((await h.exchange(flowId)).error,'replay cannot redeem the consumed verifier');
});

test('unknown account and every provider error produce identical reset feedback without raw error text',async()=>{
  const messages=[];
  for(const recoverStatus of [200,400,401,422,429,500,503]){
    const h=harness({recoverStatus});const result=await h.actions.requestPasswordReset(form({email:'staff@example.invalid'}));messages.push(JSON.stringify(result));
  }
  assert.equal(new Set(messages).size,1);assert.equal(messages[0].includes('private provider detail'),false);
});

test('untrusted origin cannot send email or start a recovery session',async()=>{
  const h=harness({origin:'https://attacker.invalid'});
  assert.equal((await h.actions.requestPasswordReset(form({email:'staff@example.invalid'}))).success,false);assert.equal(h.requests.length,0);
});

test('expired or modified verifier cookies cannot redeem an email code even when manually replayed',async()=>{
  const h=harness(),{flowId}=await h.start();h.advance(601);
  assert.ok((await h.exchange(flowId)).error);assert.equal(h.requests.filter(r=>r.url.pathname.endsWith('/token')).length,0);
  const altered=harness(),started=await altered.start();const key=[...altered.stored.keys()].find(k=>k==='pc-admin-recovery-code-verifier');
  altered.stored.set(key,altered.stored.get(key)+'x');assert.ok((await altered.exchange(started.flowId)).error);
});

test('ordinary login, stale recovery, untrusted user and revoked sessions cannot authorize reset',async()=>{
  for(const [method,age] of [['password',0],['otp',0],['recovery',601]]){
    const h=harness();assert.equal(await h.recovery.beginRecovery(h.session(h.token('aal1',method,h.clock()-age))),false);assert.equal(h.stored.has('pc_admin_recovery'),false);
  }
  const h=harness();h.setActive(false);assert.equal(await h.recovery.beginRecovery(h.session()),false);
  h.setActive(true);assert.equal(await h.recovery.beginRecovery(h.session()),true);h.setActive(false);assert.equal(await h.recovery.recoveryView(),null);
});

test('password update uses end-user SDK, revokes global sessions, clears recovery, and cannot be replayed',async()=>{
  const h=harness();await h.recovery.beginRecovery(h.session());
  const f=form({password:'new long unique passphrase',confirmation:'new long unique passphrase'});
  const result=await h.actions.updateRecoveryPassword(f);assert.equal(result.success,true);assert.match(result.message,/Password updated/);
  const update=h.requests.find(r=>r.method==='PUT');assert.equal(update.url.pathname,'/auth/v1/user');assert.equal(update.headers.get('authorization'),'Bearer '+h.token());assert.equal(update.body.password,'new long unique passphrase');
  assert.equal(h.revocations[0].scope,'global');assert.equal(h.stored.has('pc_admin_recovery'),false);assert.equal(h.stored.has('pc_admin_token'),false);
  assert.equal((await h.actions.updateRecoveryPassword(f)).success,false);assert.equal(h.requests.filter(r=>r.method==='PUT').length,1);
});

test('MFA-protected recovery requires own verified factor and preserves original deadline',async()=>{
  const h=harness({factors:[{id:fid,factor_type:'totp',status:'verified',friendly_name:'Phone authenticator'}]});await h.recovery.beginRecovery(h.session());
  const before=h.load('lib/adminRecoverySeal.ts').openRecovery(h.stored.get('pc_admin_recovery'),secret,h.clock());h.advance(100);
  const f=form({password:'new long unique passphrase',confirmation:'new long unique passphrase'});
  assert.equal((await h.actions.updateRecoveryPassword(f)).success,false);assert.equal(h.requests.some(r=>r.method==='PUT'),false);
  assert.equal((await h.actions.verifyRecoveryAuthenticator(form({factorId:'foreign',code:'123456'}))).success,false);
  assert.equal((await h.actions.verifyRecoveryAuthenticator(form({factorId:fid,code:'000000'}))).success,false);
  assert.equal((await h.actions.verifyRecoveryAuthenticator(form({factorId:fid,code:'123456'}))).success,true);
  const after=h.load('lib/adminRecoverySeal.ts').openRecovery(h.stored.get('pc_admin_recovery'),secret,h.clock());assert.equal(after.expiresAt,before.expiresAt);
  assert.equal((await h.recovery.recoveryView()).needsMfa,false);assert.equal((await h.actions.updateRecoveryPassword(f)).success,true);
});

test('unsupported MFA has an explicit state, and password update cannot silently bypass it',async()=>{
  const h=harness({factors:[{id:fid,factor_type:'phone',status:'verified'}]});await h.recovery.beginRecovery(h.session());
  assert.equal((await h.recovery.recoveryView()).unsupportedMfa,true);
  assert.equal((await h.actions.updateRecoveryPassword(form({password:'new long unique passphrase',confirmation:'new long unique passphrase'}))).success,false);
});

test('password success with failed revocation is reported honestly, and invalid passwords never mutate',async()=>{
  const h=harness({revokeFailure:true});await h.recovery.beginRecovery(h.session());
  for(const values of [{password:'short',confirmation:'short'},{password:'long correct password',confirmation:'different'},{password:'é'.repeat(40),confirmation:'é'.repeat(40)}])assert.equal((await h.actions.updateRecoveryPassword(form(values))).success,false);
  assert.equal(h.requests.length,0);
  const result=await h.actions.updateRecoveryPassword(form({password:'new long unique passphrase',confirmation:'new long unique passphrase'}));assert.equal(result.success,true);assert.match(result.message,/sign-out could not be confirmed/);
});
