const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..'),cache=new Map();
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function load(file,require,globals={}){const module={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.join(root,file),'utf8')),{module,exports:module.exports,require,...globals});return module.exports;}
function finance(name){if(cache.has(name))return cache.get(name);const result=load('shared/monetization/'+name+'.ts',id=>finance(id.slice(2)),{setTimeout,clearTimeout,URL});cache.set(name,result);return result;}
const availability=finance('availability'),client=finance('client'),commerce=finance('commerce');
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
function walk(node){return Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];}
function words(node){return Array.isArray(node)?node.map(words).join(' '):node&&typeof node==='object'?words(node.props?.children):typeof node==='string'?node:'';}

test('the new finance and commerce release gates are fixed off',()=>{assert.equal(availability.CREATOR_COMMERCE_ENABLED,false);assert.equal(availability.FINANCE_OPERATIONS_ENABLED,false);});
test('excluded statement, product and commerce services issue zero reads or writes',async()=>{
 let requests=0;const db={rpc:async()=>{requests++;return{data:null,error:null};}};
 for(const action of [()=>client.readCreatorStatement(db,'owner'),()=>commerce.readCreatorCommerce(db,'owner'),()=>commerce.saveCreatorProduct(db,'owner',{})])await assert.rejects(action,/unavailable in this release/);
 assert.equal(requests,0);
});
for(const platform of ['native','web'])test(`${platform} creator product panel immediately explains unavailability without a spinner, form or missing RPC`,async()=>{
 const effects=[];let requests=0;
 const react={useState:value=>[typeof value==='function'?value():value,()=>{}],useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
 const module=load(platform==='native'?'src/components/CreatorCommercePanel.tsx':'web/components/CreatorCommercePanel.tsx',name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return jsx;if(name==='react-native')return{View:'View',Text:'Text',TextInput:'Input',TouchableOpacity:'Button',ActivityIndicator:'Spinner'};
  if(name.endsWith('/availability'))return availability;if(name.endsWith('/commerce'))return{readCreatorCommerce:()=>{requests++;return Promise.reject(Error());},saveCreatorProduct:()=>{requests++;return Promise.reject(Error());}};
  if(name.endsWith('useTheme'))return{useTheme:()=>({t:{ink:{primary:'#000'}}}),themedSheet:()=>({})};if(name.endsWith('/client'))return{createClient:()=>({rpc:()=>{requests++;}})};return{};
 });
 const tree=module.default({owner:'owner',approved:true});effects.forEach(fn=>fn());await Promise.resolve();assert.match(words(tree),/unavailable in this release/);assert.equal(requests,0);assert.equal(walk(tree).filter(n=>['button','Button','form','input','Input','Spinner'].includes(n.type)).length,0);
});
function adminModule(file,role='finance_admin'){
 let checks=0,service=0;
 const mod=load(file,name=>{
  if(name==='react/jsx-runtime')return jsx;if(name==='next/link')return{default:'Link',__esModule:true};if(name==='@/components/Shell')return{default:'Shell',__esModule:true};
  if(name==='@/lib/adminAuth')return{requireDesk:async()=>{checks++;return{id:'admin',sessionId:'session',role};}};
  if(name==='@/lib/supabaseAdmin')return{serviceClient:()=>{service++;throw Error('An excluded finance client must not be created');}};
  if(name==='next/navigation')return{notFound:()=>{throw Error('not found');}};if(name==='@/lib/paymentPage')return{paymentSearch:value=>value};
  if(name.endsWith('/availability'))return availability;return{};
 });return{mod,get checks(){return checks;},get service(){return service;}};
}
// The existing transfer report is read-only and is covered by the operations
// payment-reporting suite. Creator finance commands remain unavailable.
for(const file of ['admin-web/app/payments/creators/page.tsx'])test(`${file} preserves staff authorization and renders unavailable without financial queries`,async()=>{
 const h=adminModule(file);const tree=await h.mod.default({searchParams:Promise.resolve({})});assert.equal(h.checks,1);assert.equal(h.service,0);assert.equal(tree.type,'Shell');assert.match(words(tree),/unavailable in this release/);assert.ok(walk(tree).some(n=>n.type==='Link'&&n.props.href==='/dashboard'));
});
test('creator review action remains unavailable even if an old client submits its form',async()=>{
 const h=adminModule('admin-web/app/payments/creators/actions.ts');const result=await h.mod.reviewCreator(null,{get:()=>{throw Error('No submitted financial command should be processed');}});assert.match(result.error,/unavailable in this release/);assert.equal(h.checks,1);assert.equal(h.service,0);
 const denied=adminModule('admin-web/app/payments/creators/actions.ts','support_agent');await assert.rejects(()=>denied.mod.reviewCreator(null,{}),/Finance permission/);assert.equal(denied.service,0);
});
