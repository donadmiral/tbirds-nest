const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..'),later=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const words=value=>Array.isArray(value)?value.map(words).join(' '):typeof value==='string'?value:value&&typeof value==='object'?words(value.props?.children):'';
function library(platform,{heldRead,heldMutation}={}){
 let cursor=0,dirty=true,tree,owner='account-a',reads=0,mutations=0,timerId=0;const slots=[],effects=[],listeners=new Set(),timers=new Map();
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
  useRef(value){const i=cursor++;return slots[i]??={current:value};},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!same(old?.deps,deps)){const slot={deps};slots[i]=slot;effects.push(()=>{old?.cleanup?.();slot.cleanup=fn();});}},
 };
 react.useLayoutEffect=react.useEffect;
 const auth={getSession:async()=>({data:{session:{user:{id:owner}}}}),getUser:async()=>({data:{user:{id:owner}},error:null}),onAuthStateChange(fn){listeners.add(fn);return{data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};}};
 const row=()=>({id:owner,title:'Fresh '+owner,duration_sec:5,status:'ready',reuse_allowed:false});
 const client={auth,rpc:async name=>{if(name==='list_my_original_audio'){reads++;if(reads===1&&heldRead)return heldRead.promise;return{data:[row()],error:null};}mutations++;if(mutations===1&&heldMutation)return heldMutation.promise;return{data:null,error:null};}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const deadlines={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'shared/soundtrackPicker.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:deadlines,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
 const mods={react,'react/jsx-runtime':jsx,'../../shared/soundtrackPicker':deadlines,'../../../../shared/soundtrackPicker':deadlines,'next/link':{default:'a',__esModule:true},'lucide-react':{ArrowLeft:'Icon',Music2:'Icon',RefreshCw:'Icon'},'@/lib/supabase/client':{createClient:()=>client},'@/components/OriginalAudioUpload':{OriginalAudioUpload:'Uploader'},'@/components/memory/useMemoryDialog':{useMemoryDialog:()=>({current:null})},'@/components/PostSoundtrack':{PostSoundtrack:'Soundtrack'},'react-native':{ActivityIndicator:'Spinner',Alert:{alert(){}},Modal:'Modal',ScrollView:'Scroll',Text:'Text',TouchableOpacity:'Button',View:'View'},'@expo/vector-icons':{Feather:'Icon'},'./SafeArea':{SafeAreaView:'SafeArea'},'./PostSoundtrack':{default:'Soundtrack',__esModule:true},'../services/supabase':{supabase:client}};
 const file=platform==='web'?'web/app/settings/audio/page.tsx':'src/components/OriginalAudioLibrary.tsx',exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,console,require(name){assert.ok(name in mods,name);return mods[name];}});
 const Component=platform==='web'?exports.default:exports.OriginalAudioLibrary;
 function render(force=false){if(force)dirty=true;let rounds=0;while(dirty){assert.ok(++rounds<30,'library renders settle');dirty=false;cursor=0;tree=Component({owner:'account-a',onClose(){}});while(effects.length)effects.shift()();}return tree;}
 render();
 return{render,async flush(){for(let n=0;n<8;n++){await new Promise(setImmediate);render();}},auth(id,event='SIGNED_IN'){owner=id;for(const callback of listeners)callback(event,{user:{id}});render();},button(label='Allow reuse'){const button=nodes(tree).find(node=>['button','Button'].includes(node.type)&&words(node).trim()===label);assert.ok(button,'control: '+label);return button;},press(button){(button.props.onClick??button.props.onPress)();},expire(){for(const[id,fn]of [...timers]){timers.delete(id);fn();}},text:()=>words(tree),get reads(){return reads;},get mutations(){return mutations;},get listeners(){return listeners.size;},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
for(const platform of ['web','native']){
 test(platform+' library rejects an old A-to-B-to-A load and unsubscribes on close',async()=>{
  const pending=later(),h=library(platform,{heldRead:pending});await h.flush();h.auth('account-b');await h.flush();h.auth('account-a');await h.flush();
  assert.match(h.text(),/Fresh account-a/);pending.resolve({data:[{id:'old',title:'Old secret audio',status:'ready',duration_sec:5}],error:null});await h.flush();assert.doesNotMatch(h.text(),/Old secret/);h.unmount();assert.equal(h.listeners,0);
 });
 test(platform+' library serializes reuse changes and an old mutation cannot lock the next login',async()=>{
  const pending=later(),h=library(platform,{heldMutation:pending});await h.flush();const button=h.button();h.press(button);h.press(button);await h.flush();assert.equal(h.mutations,1);
  h.auth('account-b');await h.flush();h.auth('account-a');await h.flush();assert.equal(h.button().props.disabled,false);
  pending.resolve({data:null,error:Error('Old request failed')});await h.flush();assert.doesNotMatch(h.text(),/could not save/);h.press(h.button());await h.flush();assert.equal(h.mutations,2);h.unmount();
 });
 test(platform+' token refresh preserves the loaded original library',async()=>{
  const h=library(platform);await h.flush();const before=h.reads;h.auth('account-a','TOKEN_REFRESHED');await h.flush();assert.equal(h.reads,before);assert.match(h.text(),/Fresh account-a/);h.unmount();
 });
 test(platform+' a stalled library read exposes retry and cannot overwrite the recovered list',async()=>{
  const pending=later(),h=library(platform,{heldRead:pending});await h.flush();h.expire();await h.flush();assert.match(h.text(),/could not load/);
  h.press(h.button(platform==='web'?'Retry':'Retry library'));h.render();await h.flush();assert.match(h.text(),/Fresh account-a/);
  pending.resolve({data:[{id:'late',title:'Late original',status:'ready',duration_sec:5}],error:null});await h.flush();assert.doesNotMatch(h.text(),/Late original/);h.unmount();
 });
}
