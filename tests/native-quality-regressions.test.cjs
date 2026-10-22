const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function compile(source, globals = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, console, ...globals });
  return module.exports;
}
function callback(file, name, globals, last = false) {
  const source = read(file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), found = [];
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) found.push(node.initializer.getText(ast)); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found.length, name);
  return compile('export const run = ' + (last ? found.at(-1) : found[0]), { useCallback: fn => fn, ...globals }).run;
}
const light = compile(read('src/constants/tokens/light.ts')).light;
const dark = compile(read('src/constants/tokens/dark.ts')).dark;
function styles(file, theme) {
  const source = read(file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let factory;
  function visit(node) { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'themedSheet') factory = node.arguments[0].getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(factory, file);
  const constants = { NAVY: '#0B1E3D', RED: '#DC2626', SCREEN_W: 390, GUTTER: 12, HAIR: 1, StyleSheet: { hairlineWidth: 1 } };
  for (const key of ['typeSize', 'fontWeight', 'space', 'radius']) constants[key] = new Proxy({}, { get: () => 16 });
  return compile('export const factory = ' + factory, constants).factory(theme);
}
function rgb(color, background = [255,255,255]) {
  if (color.startsWith('#')) { let hex = color.slice(1); if (hex.length === 3) hex = hex.split('').map(x => x+x).join(''); return [0,2,4].map(i => parseInt(hex.slice(i,i+2),16)); }
  const parts = color.match(/[\d.]+/g).map(Number), alpha = parts[3] ?? 1;
  return parts.slice(0,3).map((v,i) => v*alpha+background[i]*(1-alpha));
}
function contrast(fg, bg) {
  const b = rgb(bg), f = rgb(fg,b);
  const luminance = c => c.map(x => x/255).map(x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4).reduce((sum,x,i) => sum+x*[.2126,.7152,.0722][i],0);
  const a = luminance(f), z = luminance(b); return (Math.max(a,z)+.05)/(Math.min(a,z)+.05);
}
for (const [mode, theme] of [['light',light],['dark',dark]]) {
  test(`${mode}: meaningful metadata and primary button pairs remain readable`, () => {
    assert.ok(contrast(theme.ink.muted, theme.surface.canvas)>=4.5);
    assert.ok(contrast(theme.ink.secondary, theme.surface.raised)>=4.5);
    const pairs = [
      ['src/screens/market/MarketScreen.tsx','chipActive','chipTxtActive'],
      ['src/components/market/MarketFilterSheet.tsx','chipOn','chipTxtOn'],
      ['src/components/jobs/JobListRow.tsx','logo','logoTxt'],
      ['src/components/SendMoneySheet.tsx','pay','payTxt'],
      ['src/components/SendMoneySheet.tsx','cta','ctaTxt'],
      ['src/components/LinkIntoBankSheet.tsx','cta','ctaTxt'],
      ['src/screens/market/CreateListingScreen.tsx','cta','ctaTxt'],
      ['src/screens/market/CreateListingScreen.tsx','currBtn','currTxt'],
      ['src/screens/market/ListingDetailScreen.tsx','cta','ctaTxt'],
      ['src/screens/jobs/JobsScreen.tsx','hsLogo','hsLogoTxt'],
      ['src/screens/jobs/JobsScreen.tsx','hsApply','hsApplyTxt'],
      ['src/screens/jobs/JobsScreen.tsx','hsDot','hsDotTxt'],
      ['src/screens/jobs/JobsScreen.tsx','actionApply','actionApplyTxt'],
      ['src/screens/jobs/JobsScreen.tsx','actionRecommend','actionRecommendTxt'],
      ['src/screens/jobs/JobsScreen.tsx','submitBtn','submitBtnTxt'],
      ['src/screens/jobs/JobsScreen.tsx','catChipActive','catChipTxtActive'],
      ['src/screens/jobs/JobsScreen.tsx','switchBtn','switchBtnTxt'],
      ['src/screens/jobs/JobsScreen.tsx','switchBtnOn','switchBtnTxtOn'],
      ['src/screens/jobs/JobDetailScreen.tsx','logoBlock','logoTxt'],
      ['src/screens/studio/StudioScreen.tsx','band','bandTitle'],
      ['src/screens/studio/StudioScreen.tsx','band','bandMeta'],
      ['src/screens/studio/StudioScreen.tsx','primaryBtn','primaryTxt'],
      ['src/screens/studio/StudioScreen.tsx','filterChipOn','filterTxtOn'],
      ['src/screens/studio/StudioHiringAdsSegs.tsx','primaryBtn','primaryTxt'],
      ['src/screens/studio/StudioHiringAdsSegs.tsx','catChipOn','catTxtOn'],
      ['src/screens/profile/SettingsScreen.tsx','pwSubmitBtn','pwSubmitBtnTxt'],
      ['src/screens/profile/SettingsScreen.tsx','profileCardAvatarFb','profileCardAvatarTxt'],
    ];
    for (const [file, surface, text] of pairs) {
      const s = styles(file,theme), ratio = contrast(s[text].color,s[surface].backgroundColor);
      assert.ok(ratio >= 4.5, `${file} ${surface}/${text}: ${ratio}`);
    }
  });
}
function marketHarness(readPage) {
  const state = { rows: [], error: false, pageError: false }, requests = [], request = { current: 0 }, page = { current: { offset:0, hasMore:false, busy:false } };
  const set = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const globals = { request, page, PAGE_SIZE:30, search:'', category:null, filters:{}, marketTab:'browse', meProfile:{ id:'owner', location:'Harare' },
    setPageFailed:set('pageError'),setLoadingMore:set('loadingMore'),setLoading:set('loading'),setLoadFailed:set('error'),setRefreshing:set('refreshing'),setListings:set('rows'),setSavedIds:set('saved'),
    marketService:{ getMarketFeed: async opts => { requests.push(opts); return readPage(opts); }, getSavedIds:async()=>new Set() }, };
  return { run:callback('src/screens/market/MarketScreen.tsx','load',globals),state,requests,page,request };
}
const listing = id => ({ id:String(id), title:'Listing '+id });
function saveHarness() {
  const context = {}, state = { saved: new Set(['item']), rows: [listing('item')] }, ref = { current: context };
  const pendingSaves = { current: new Map() }, calls = [], alerts = [];
  const toggleSaved = () => new Promise((resolve,reject) => calls.push({resolve,reject}));
  const run = callback('src/screens/market/MarketScreen.tsx', 'toggleSave', {
    saveContext:context,saveContextRef:ref,pendingSaves,savedIds:state.saved,marketTab:'saved',
    marketService:{toggleSaved},setSavedIds:fn=>{state.saved=fn(state.saved);},setListings:fn=>{state.rows=fn(state.rows);},
    Alert:{alert:(...args)=>alerts.push(args)},
  });
  return {run,state,ref,calls,alerts,pendingSaves};
}
test('a late unsave from Saved cannot remove a listing after switching views', async () => {
  const h = saveHarness();
  const saving = h.run('item');
  await h.run('item'); assert.equal(h.calls.length,1);
  h.ref.current = {};
  h.state.rows = [listing('item'),listing('browse-only')];
  h.calls[0].resolve(); await saving;
  assert.deepEqual(h.state.rows.map(row=>row.id),['item','browse-only']);
  assert.equal(h.pendingSaves.current.size,0);
});
test('a late save failure cannot restore the previous account saved state or show an alert', async () => {
  const h = saveHarness();
  const saving = h.run('item');
  h.ref.current = {};
  h.state.saved = new Set(['new-account-item']);
  h.calls[0].reject(new Error('network')); await saving;
  assert.deepEqual([...h.state.saved],['new-account-item']);
  assert.equal(h.alerts.length,0);
});
test('market scroll loads beyond 30, deduplicates overlap, and stops at the last page', async () => {
  const all = Array.from({length:67},(_,i)=>listing(i));
  const h = marketHarness(({offset,limit})=>all.slice(offset,offset+limit));
  await h.run(); assert.equal(h.state.rows.length,30); assert.equal(h.page.current.hasMore,true);
  await h.run({append:true}); assert.equal(h.state.rows.length,60);
  await h.run({append:true}); assert.equal(h.state.rows.length,67); assert.equal(h.page.current.hasMore,false);
  await h.run({append:true}); assert.equal(h.requests.length,3);
  assert.deepEqual(h.requests.map(x=>x.offset),[0,30,60]);
});
test('failed next page preserves loaded listings and retry uses the same offset', async () => {
  let fail = true;
  const h=marketHarness(({offset,limit})=>{ if(offset&&fail)throw Error('offline'); return Array.from({length:70},(_,i)=>listing(i)).slice(offset,offset+limit); });
  await h.run(); await h.run({append:true}); assert.equal(h.state.rows.length,30); assert.equal(h.state.pageError,true); assert.equal(h.page.current.offset,30);
  fail=false; await h.run({append:true}); assert.equal(h.state.rows.length,60); assert.equal(h.state.pageError,false);
});
test('invalidated market response never replaces a newer query result', async () => {
  let resolve;
  const h=marketHarness(()=>new Promise(done=>{resolve=done}));
  const work=h.run(); h.request.current++; resolve([listing('stale')]); await work; assert.equal(h.state.rows.length,0);
});
test('account standing transport failure does not become a clean record', async()=>{
  let rows=['previous'], error=false; const chain={select(){return this},eq(){return this},order(){return this},limit:async()=>({data:null,error:Error('offline')})};
  const run=callback('src/screens/profile/AccountStandingScreen.tsx','load',{request:{current:0},profile:{id:'owner'},setRows:v=>rows=v,setLoadError:v=>error=v,supabase:{from:()=>chain}});
  await run();assert.equal(error,true);assert.equal(rows,null);
});
test('campaign refresh failure preserves known campaigns and exposes the error',async()=>{
  let rows=[{id:'running'}],error=false;
  const run=callback('src/screens/studio/StudioHiringAdsSegs.tsx','load',{loadRequest:{current:0},setLoading(){},setRefreshing(){},setLoadError:v=>error=v,setRows:v=>rows=v,supabase:{rpc:async()=>({data:null,error:Error('offline')})}},true);
  await run(true);assert.equal(error,true);assert.equal(rows[0].id,'running');
});
for(const invalid of [false,true])test(`MFA removal ${invalid?'rejects an invalid code':'verifies before removing the factor'}`,async()=>{
 const calls=[];
 const run=callback('src/screens/profile/TwoFactorScreen.tsx','confirmTurnOff',{disablingFactor:{id:'factor'},busy:false,disableCode:'123456',setBusy(){},setDisablingFactor(){},setDisableCode(){},load:async()=>{},Alert:{alert(){}},supabase:{auth:{mfa:{challenge:async()=>{calls.push('challenge');return{data:{id:'challenge'}}},verify:async()=>{calls.push('verify');return{error:invalid?Error('invalid'):null}},unenroll:async()=>{calls.push('unenroll');return{error:null}}}}}});
 await run();assert.deepEqual(calls,invalid?['challenge','verify']:['challenge','verify','unenroll']);
});
const { webcrypto } = require('node:crypto');
const cvContract = compile(read('shared/applicationCv.ts'));
function cvHarness({owner='11111111-1111-4111-8111-111111111111',size=4,uploadError=null}={}) {
  const uploads=[],signs=[];
  const service=compile(read('src/services/applicationCvService.ts'),{crypto:webcrypto,URL,require(name){
    if(name==='react-native-get-random-values')return{};
    if(name==='../../shared/applicationCv')return cvContract;
    if(name==='base64-arraybuffer')return{decode:s=>Uint8Array.from(Buffer.from(s,'base64')).buffer};
    if(name==='expo-file-system/legacy')return{getInfoAsync:async()=>({exists:true,isDirectory:false,size}),EncodingType:{Base64:'base64'},readAsStringAsync:async()=>Buffer.from('test').toString('base64')};
    if(name==='./supabase')return{SUPABASE_URL:'https://fixture.supabase.co',supabase:{auth:{getUser:async()=>({data:{user:{id:owner}}})},storage:{from:bucket=>({upload:async(path,bytes,options)=>{uploads.push({bucket,path,bytes,options});return{error:uploadError}},createSignedUrl:async(path,ttl,options)=>{signs.push({bucket,path,ttl,options});return{data:{signedUrl:'https://fixture.supabase.co/storage/v1/object/sign/application-cvs/file'}}}})}}};
    throw Error(name);
  }});
  return{...service,uploads,signs};
}
const owner='11111111-1111-4111-8111-111111111111', job='22222222-2222-4222-8222-222222222222';
test('new native CV upload is private, immutable, typed and opened through a short-lived authorized link',async()=>{
 const h=cvHarness(), reference=await h.uploadApplicationCv(owner,job,{name:'resume.pdf',uri:'file:///resume.pdf'});
 assert.ok(cvContract.applicationCvPath(reference));assert.equal(h.uploads.length,1);assert.equal(h.uploads[0].bucket,'application-cvs');assert.equal(h.uploads[0].options.upsert,false);assert.equal(h.uploads[0].options.contentType,'application/pdf');assert.ok(h.uploads[0].path.startsWith(owner+'/'+job+'/'));
 await h.applicationCvUrl(reference,'resume.pdf');assert.equal(h.signs[0].ttl,60);assert.equal(h.signs[0].options.download,'resume.pdf');
});
test('CV upload rejects account changes, oversized files and storage errors without a public fallback',async()=>{
 const changed=cvHarness({owner:'another'});await assert.rejects(changed.uploadApplicationCv(owner,job,{name:'resume.pdf',uri:'file:///resume.pdf'}),/account changed/);assert.equal(changed.uploads.length,0);
 const large=cvHarness({size:9*1024*1024});await assert.rejects(large.uploadApplicationCv(owner,job,{name:'resume.pdf',uri:'file:///resume.pdf'}),/8 MB/);assert.equal(large.uploads.length,0);
 const denied=cvHarness({uploadError:Error('denied')});await assert.rejects(denied.uploadApplicationCv(owner,job,{name:'resume.pdf',uri:'file:///resume.pdf'}),/private CV/);assert.equal(denied.uploads.length,1);
});
test('CV opening refuses foreign links, arbitrary schemes, malformed references and unrelated storage buckets',async()=>{
 const h=cvHarness();
 for(const ref of ['https://evil.invalid/resume.pdf','javascript:alert(1)','application-cvs/../secret','https://fixture.supabase.co/storage/v1/object/public/avatars/file','https://attacker@fixture.supabase.co/storage/v1/object/public/chat-files/file'])await assert.rejects(h.applicationCvUrl(ref),/unavailable/);
 const legacy='https://fixture.supabase.co/storage/v1/object/public/chat-files/legacy.pdf';assert.equal(await h.applicationCvUrl(legacy),legacy);assert.equal(h.signs.length,0);
});
test('market service sends pagination offset through the ranked feed contract',async()=>{
 const calls=[];
 const {marketService}=compile(read('src/services/marketService.ts'),{require(name){
  if(name==='./supabase')return{supabase:{rpc:async(name,args)=>{calls.push({name,args});return{data:[],error:null}}}};
  if(name==='../stores/actorStore')return{authorId:id=>id};if(name==='./flagsService')return{flagsService:{}};throw Error(name);
 }});
 await marketService.getMarketFeed({offset:60,limit:31});assert.equal(calls[0].args.p_offset,60);assert.equal(calls[0].args.p_limit,31);
});
