const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const test=require('node:test');const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const compile=file=>ts.transpileModule(fs.readFileSync(path.resolve(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(file,name,props,imports={}) {
 let cursor=0,dirty=true,tree,effects=[];const slots=[];
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={useRef(v){const i=cursor++;return slots[i]??={current:v};},useState(v){const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],next=>{const n=typeof next==='function'?next(slots[i]):next;if(!Object.is(n,slots[i])){slots[i]=n;dirty=true;}}];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 const exports={};vm.runInNewContext(compile(file),{exports,require:p=>p==='react'?hooks:p==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:imports[p]??new Proxy({},{get:(_,key)=>key}),console,Date,Set,Map,URL,setTimeout,clearTimeout,document:{activeElement:null,body:{style:{}},addEventListener(){},removeEventListener(){}},window:{visualViewport:null},requestAnimationFrame:()=>0,cancelAnimationFrame(){},HTMLElement:class HTMLElement{},crypto:{randomUUID:()=> 'new-sticker'}});
 function render(){let n=0;while(dirty){if(++n>30)throw Error('render loop');dirty=false;cursor=0;tree=exports[name](props);const pending=effects;effects=[];pending.forEach(fn=>fn());}return tree;}
 return{get tree(){return render();},update(next){Object.assign(props,next);dirty=true;},async flush(){for(let i=0;i<15;i++){await Promise.resolve();render();}},unmount(){slots.forEach(s=>s?.cleanup?.());}};
}
function helpers(){const exports={};vm.runInNewContext(compile('../shared/storyMentions.ts'),{exports});return exports;}
test('canvas presents degrees but persists native-compatible radians and current text mentions',()=>{
 let value=[{id:'s',kind:'text',text:'Hello @musa',mentions:[{id:'m',username:'musa'}],nx:.5,ny:.5,scale:1,rotation:Math.PI/2,color:'#fff'}];let h;
 h=harness('components/StoryEditor.tsx','StoryEditor',{value,children:null,onChange:v=>{value=v;h.update({value});}},{'./useStoryPostEditorFit':{useStoryPostEditorFit:()=>({stageRef:{current:null},topbarRef:{current:null},dockRef:{current:null},keepOwnerPlacement(){}})},'./storyTextAppearance':{stickerCss:()=>({})},'./StoryEngine':{extraFontCss:()=>({}),STICKER_ANIM_CSS:''},'../../shared/storyMentions':helpers(),'../../shared/storyCanvas':{storyStickerLabel:(kind,text)=>({text})},'@/lib/supabase/client':{createClient:()=>({from:()=>({select(){return this;},in(){return Promise.resolve({data:[]});}})})}});
 const sticker=nodes(h.tree).find(n=>n.props?.['aria-label']?.startsWith('Edit text sticker'));assert.match(sticker.props.style.transform,/rad\)/);sticker.props.onClick();
 const styleTab=nodes(h.tree).find(n=>n.props?.role==='tab'&&n.props.children==='Style');styleTab.props.onClick();
 const rotation=nodes(h.tree).find(n=>n.props?.['aria-label']==='Sticker rotation');assert.equal(rotation.props.value,90);rotation.props.onChange({target:{value:'180'}});assert.equal(value[0].rotation,Math.PI);
 const input=nodes(h.tree).find(n=>n.type==='textarea'&&n.props.value==='Hello @musa');input.props.onChange({target:{value:'Hello'}});assert.equal(value[0].mentions.length,0);h.unmount();
});
function linkScenario({allowed=true,expiry=Date.now()+60000,sessionGate,storyGate}={}) {
 let listener,owner='a';const calls=[];
 const client = {
   auth: {
     getSession: () => sessionGate?.promise ?? Promise.resolve({ data: { session: { user: { id: owner } } } }),
     onAuthStateChange: fn => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
   },
   rpc: async (name, args) => { calls.push({ name, args, owner }); return { data: allowed, error: null }; },
   from(table) {
     return {
       select() { return this; }, eq() { return this; },
       maybeSingle() {
         return table === 'stories'
           ? storyGate?.promise ?? Promise.resolve({ data: { user_id: 'author', expires_at: new Date(expiry).toISOString(), created_at: 'now' } })
           : Promise.resolve({ data: { full_name: 'Author', username: 'author', avatar_url: null } });
       },
     };
   },
 };
 const h=harness('components/StoryLink.tsx','StoryLink',{storyId:'exact-story'},{'@/lib/supabase/client':{createClient:()=>client},'next/navigation':{useRouter:()=>({push(){}})},'./StoryViewer':{StoryViewer:'StoryViewer'},'next/link':{default:'Link'}});
 h.changeOwner=next=>{owner=next;listener('SIGNED_OUT',next?{user:{id:next}}:null);};h.calls=calls;return h;
}
test('exact story links preserve the requested ID after checking visibility and expiry',async()=>{const h=linkScenario();await h.flush();assert.equal(h.tree.type,'StoryViewer');assert.equal(h.tree.props.initialStoryId,'exact-story');assert.equal(h.calls[0].args.p_story_id,'exact-story');h.unmount();});
test('denied or expired story links do not silently open the author next story',async()=>{for(const options of[{allowed:false},{expiry:Date.now()-1000}]){const h=linkScenario(options);await h.flush();assert.notEqual(h.tree.type,'StoryViewer');h.unmount();}});
test('signout defeats late initial auth and pending story metadata',async()=>{const sessionGate=deferred();const h=linkScenario({sessionGate});h.tree;h.changeOwner(null);sessionGate.resolve({data:{session:{user:{id:'old-owner'}}}});await h.flush();assert.notEqual(h.tree.type,'StoryViewer');assert.equal(h.calls.length,0);h.unmount();const storyGate=deferred();const second=linkScenario({storyGate});await second.flush();second.changeOwner(null);storyGate.resolve({data:{user_id:'author',expires_at:new Date(Date.now()+60000).toISOString()}});await second.flush();assert.notEqual(second.tree.type,'StoryViewer');second.unmount();});
