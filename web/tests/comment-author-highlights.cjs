const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function compile(file,overrides={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>overrides[name]??{default:name},Map,Set,Promise,console,setTimeout,clearTimeout});return module.exports;}
const highlights=compile('../shared/commentHighlights.ts');
const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
const words=node=>!node?'':Array.isArray(node)?node.map(words).join(' '):typeof node==='object'?words(node.props?.children):String(node);
function harness({uid='author',off=false,fail=false}={}){
 const slots=[],calls=[];let cursor=0,dirty=true,effects=[],tree,pinned='two',liked=true,postId='post',rpcOverride=null;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},useState(value){const i=cursor++;if(!slots[i])slots[i]={value:typeof value==='function'?value():value};return[slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;dirty=true;}];},useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn};return slots[i].value;},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 const rows=['one','two'].map((id,i)=>({id,post_id:'post',user_id:'commenter',body:'Comment '+id,content:null,parent_comment_id:null,likes_count:i===0?1:0,dislikes_count:0,created_at:'2026-10-29T00:00:00Z'}));
 const client={auth:{getSession:async()=>({data:{session:{user:{id:uid}}}})},from(table){let selection='',filters=[];const q={select(v){selection=v;return q;},eq(k,v){filters.push([k,v]);return q;},in(){return q;},order(){return q;},maybeSingle(){return q;},then(resolve,reject){let data=null,error=null;if(table==='posts')data={user_id:'author',comment_policy:off?'off':'everyone'};if(table==='post_comments'){data=rows;if(fail)error={message:'offline'};}if(table==='profiles')data=[{id:'commenter',full_name:'Commenter',username:'commenter',avatar_url:null}];if(table==='post_comment_pins')data=pinned?{comment_id:pinned}:null;if(table==='comment_reactions')data=selection==='comment_id'?(liked?[{comment_id:'one'}]:[]):uid==='author'&&liked?[{comment_id:'one',value:1}]:[];return Promise.resolve({data,error}).then(resolve,reject);}};return q;},async rpc(name,args){calls.push({name,args});if(rpcOverride)return rpcOverride(name,args);if(name==='set_comment_pinned'){pinned=args.p_pinned?args.p_comment_id:null;return{data:{pinned_comment_id:pinned},error:null};}liked=!liked;return{data:{value:liked?1:0,likes:liked?1:0,dislikes:0},error:null};}};
 const runtime={jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
 const module=compile('components/Comments.tsx',{'react':hooks,'react/jsx-runtime':runtime,'@/lib/supabase/client':{createClient:()=>client},'@/lib/profileLookup':{profilePath:(_name,id)=>'/profile/'+id},'@/lib/commentCounts':{refreshCommentCount:async()=>{}},'../../shared/commentHighlights':highlights,'lucide-react':new Proxy({}, {get:(_,name)=>name})});
 function render(){let guard=0;while(dirty){if(++guard>20)throw Error('render loop');dirty=false;cursor=0;tree=module.Comments({postId});const pending=effects;effects=[];pending.forEach(run=>run());}}
 return{calls,setPost(value){postId=value;dirty=true;},setRpc(value){rpcOverride=value;},get tree(){return tree;},async settle(){for(let i=0;i<12;i++){render();await new Promise(resolve=>setImmediate(resolve));}render();},nodes:()=>walk(tree),words:()=>words(tree)};
}

test('real comment component shows author likes and a pinned comment first',async()=>{
 const h=harness();await h.settle();assert.match(h.words(),/Pinned by author/);assert.match(h.words(),/Liked by author/);
 const commentRows=h.nodes().filter(n=>n.type==='div'&&['one','two'].includes(n.key));assert.deepEqual(commentRows.map(n=>n.key),['two','one']);
 const menu=h.nodes().find(n=>n.props?.['aria-label']==='Comment actions');menu.props.onClick();await h.settle();
 const unpin=h.nodes().find(n=>n.type==='button'&&words(n).includes('Unpin comment'));assert.ok(unpin);await unpin.props.onClick();await h.settle();
 assert.equal(h.calls.at(-1).name,'set_comment_pinned');assert.equal(h.calls.at(-1).args.p_pinned,false);assert.doesNotMatch(h.words(),/Pinned by author/);
});
test('only the post author receives pin actions; an actual author unlike removes the badge',async()=>{
 const viewer=harness({uid:'reader'});await viewer.settle();viewer.nodes().find(n=>n.props?.['aria-label']==='Comment actions').props.onClick();await viewer.settle();assert.ok(!viewer.nodes().some(n=>n.type==='button'&&/pin comment/i.test(words(n))));
 const author=harness();await author.settle();const one=author.nodes().find(n=>n.type==='div'&&n.key==='one');const like=walk(one).find(n=>n.props?.['aria-label']==='Like comment');await like.props.onClick();await author.settle();assert.doesNotMatch(author.words(),/Liked by author/);
});
test('off comments and fetch failures do not leave a loading spinner or pretend the thread is empty',async()=>{
 const off=harness({off:true});await off.settle();assert.match(off.words(),/Comments are turned off/);assert.ok(!off.nodes().some(n=>n.type==='textarea'));assert.doesNotMatch(off.words(),/Loading comments/);
 const failed=harness({fail:true});await failed.settle();assert.match(failed.words(),/Comments could not load/);assert.doesNotMatch(failed.words(),/No comments yet|Loading comments/);
});


test('a retained action from a previous post cannot start a new mutation after switching posts',async()=>{
 const h=harness();await h.settle();h.nodes().find(n=>n.props?.['aria-label']==='Comment actions').props.onClick();await h.settle();
 const oldUnpin=h.nodes().find(n=>n.type==='button'&&words(n).includes('Unpin comment')).props.onClick;
 h.setPost('another-post');await h.settle();await oldUnpin();await h.settle();
 assert.equal(h.calls.length,0);assert.match(h.words(),/Pinned by author/);
});

test('an in-flight pin response cannot change the next post, even after returning to the original post',async()=>{
 for(const returnToOriginal of [false,true]){
  const h=harness();await h.settle();h.nodes().find(n=>n.props?.['aria-label']==='Comment actions').props.onClick();await h.settle();
  let resolve;const pending=new Promise(done=>{resolve=done;});h.setRpc(()=>pending);
  const oldMutation=h.nodes().find(n=>n.type==='button'&&words(n).includes('Unpin comment')).props.onClick();
  assert.equal(h.calls.length,1);h.setPost('another-post');await h.settle();
  if(returnToOriginal){h.setPost('post');await h.settle();}
  resolve({data:{pinned_comment_id:null},error:null});await oldMutation;await h.settle();
  assert.match(h.words(),/Pinned by author/);assert.equal(h.calls.length,1);
 }
});
