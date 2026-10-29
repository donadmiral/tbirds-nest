const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const sources = { StoryViewer: compile('StoryViewer.tsx'), StoryRings: compile('StoryRings.tsx') };
function shared(name) { const file = path.resolve(__dirname, '../../shared', name + '.ts'), exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: relative => shared(relative.replace('./', '')) }); return exports; }

const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node,...nodes(node.props?.children)];
const content = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : content(node?.props?.children ?? '');
function scenario(name, { own=true, video=false, hasStories=true } = {}) {
  let cursor=0,dirty=true,tree,effects=[],id=0,reactions=0,closed=0;
  const slots=[],intervals=new Map(),timeouts=new Map(),listeners=new Map();
  const story={id:'story',user_id:'author',media_type:video?'video':'image',media_url:'https://media.test/story',caption:'Caption remains readable',duration_sec:10,created_at:'2026-10-22T12:00:00Z'};
  const user={user_id:'author',full_name:'Author',story_count:1};
  let identity=own?'author':'viewer', authListener;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const hooks={Fragment:'Fragment',useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{const n=typeof value==='function'?value(slots[i]):value;if(!Object.is(n,slots[i])){slots[i]=n;dirty=true;}}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
  const player={currentTime:0,paused:false,ended:false,playCalls:0,pauseCalls:0,play(){this.paused=false;this.playCalls++;return Promise.resolve();},pause(){this.paused=true;this.pauseCalls++;}};
  const client={auth:{onAuthStateChange:fn=>{authListener=fn;return{data:{subscription:{unsubscribe(){authListener=null;}}}};},getSession:async()=>({data:{session:{user:{id:identity}}}})},rpc:async()=>({data:[],error:null}),from(){const query={select(){return query;},eq(){return query;},in(){return query;},maybeSingle(){return query;},then(ok,bad){return Promise.resolve({data:[],error:null}).then(ok,bad);}};return query;}};
  const document={hidden:false,addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n),createElement:()=>({removeAttribute(){},load(){}})};
  const imports={react:hooks,'../../shared/storyColorMatrix':shared('storyColorMatrix'),'../../shared/trendingStories':{loadTrendingStories:async()=>[]},'@/lib/contentMedia':{hydrateStoryMedia:async rows=>rows},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'@/lib/supabase/client':{createClient:()=>client},'@/lib/media':{displayImageUrl:x=>x},'@/lib/feed':{timeAgo:()=> 'now'},'@/lib/stories':{getCatchupFeed:async()=>hasStories?[user]:[],getUserStories:async()=>identity?[story]:[],getStoryPoll:async()=>null,getMyStoryReactions:async()=>[],markStoryViewed:async()=>{},toggleStoryReaction:async()=>{reactions++;return{reacted:true};},REACTION_EMOJIS:['heart'],STORY_FILTERS:[]}};
  const timers={setInterval:fn=>{const n=++id;intervals.set(n,fn);return n;},clearInterval:n=>intervals.delete(n),setTimeout:(fn,ms)=>{const n=++id;timeouts.set(n,{fn,ms});return n;},clearTimeout:n=>timeouts.delete(n)};
  const exports={};vm.runInNewContext(sources[name],{exports,require:n=>imports[n]??new Proxy({},{get:(_,key)=>String(key)}),document,window:{...timers,addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)},Image:function(){},console,queueMicrotask,...timers});
  const props=name==='StoryViewer'?{users:[user],startIndex:0,onClose(){closed++;}}:{};
  function render(){let n=0;while(dirty){if(++n>40)throw Error('Render loop');dirty=false;cursor=0;tree=exports[name](props);nodes(tree).forEach(node=>{if(node.type==='video'&&node.props.ref)node.props.ref.current=player;});const pending=effects;effects=[];pending.forEach(fn=>fn());}return tree;}
  render();return{get tree(){return render();},get intervals(){return intervals.size;},get reactions(){return reactions;},get closed(){return closed;},player,
    button(label){return nodes(render()).find(n=>n.type==='button'&&n.props['aria-label']===label);},
    async flush(){for(let n=0;n<8;n++){await new Promise(resolve=>setImmediate(resolve));render();}},
    click(label,detail=1){const b=this.button(label);assert.ok(b,label);b.props.onClick({detail});render();},
    zone(){return nodes(render()).find(n=>n.props?.onDoubleClick);},
    timeout(ms){for(const[n,t]of [...timeouts])if(t.ms===ms){timeouts.delete(n);t.fn();}render();},
    changeViewer(next){identity=next;authListener?.('SIGNED_OUT',next?{user:{id:next}}:null);render();},
    unmount(){slots.forEach(s=>s?.cleanup?.());},
  };
}

test('visible story playback button responds to pointer and keyboard activation with one timer',async()=>{
  const h=scenario('StoryViewer',{video:true});await h.flush();assert.equal(h.intervals,1);
  h.click('Pause story');assert.equal(h.intervals,0);assert.equal(h.player.paused,true);assert.ok(h.button('Play story'));
  h.click('Play story',0);assert.equal(h.intervals,1);assert.equal(h.player.paused,false);assert.ok(h.button('Pause story'));h.unmount();
});
test('hold gestures do not undo an explicit pause and remain usable after play',async()=>{
  const h=scenario('StoryViewer');await h.flush();h.click('Pause story');h.zone().props.onPointerDown();h.timeout(200);h.zone().props.onPointerUp();assert.equal(h.intervals,0);assert.ok(h.button('Play story'));
  h.click('Play story');h.timeout(60);h.zone().props.onPointerDown();h.timeout(200);assert.equal(h.intervals,0);h.zone().props.onPointerUp();assert.equal(h.intervals,1);h.unmount();
});
test('the center double-tap reaction remains independent of the visible playback button',async()=>{
  const h=scenario('StoryViewer',{own:false});await h.flush();const zone=h.zone();assert.equal(zone.type,'div');assert.equal(zone.props['aria-hidden'],'true');
  await zone.props.onDoubleClick();await h.flush();assert.equal(h.reactions,1);assert.equal(h.intervals,1);h.unmount();
});
test('own caption has reserved space above the memory action',async()=>{
  const h=scenario('StoryViewer');await h.flush();const caption=nodes(h.tree).find(n=>n.type==='p'&&content(n)==='Caption remains readable');assert.ok(caption.props.className.includes('bottom-28'));assert.ok(!caption.props.className.includes('bottom-20'));h.unmount();
});
test('own story uses a native button with a separate labelled create link',async()=>{
  const h=scenario('StoryRings');await h.flush();const own=h.button('View your story');assert.ok(own);assert.equal(own.props.type,'button');assert.equal(nodes(own).filter(n=>n.type==='a').length,0);
  const add=nodes(h.tree).find(n=>n.type==='a'&&n.props['aria-label']==='Create a story');assert.equal(add.props.href,'/story/new');assert.ok(add.props.className.includes('h-11'));h.click('View your story',0);assert.ok(nodes(h.tree).some(n=>n.type==='StoryViewer'));h.unmount();
});
test('an empty own story still exposes ordinary create links without nested anchors',async()=>{
  const h=scenario('StoryRings',{hasStories:false});await h.flush();const links=nodes(h.tree).filter(n=>n.type==='a');assert.equal(links.length,2);for(const link of links){assert.equal(link.props.href,'/story/new');assert.equal(nodes(link).filter(n=>n.type==='a').length,1);}h.unmount();
});


test('manual pause permits Next while a completed long hold consumes its click',async()=>{
  const h=scenario('StoryViewer');await h.flush();h.click('Pause story');h.click('Next');assert.equal(h.closed,1);h.unmount();
  const held=scenario('StoryViewer');await held.flush();const next=held.button('Next');next.props.onPointerDown();held.timeout(200);next.props.onPointerUp();next.props.onClick({detail:1});assert.equal(held.closed,0);
  held.click('Next',0);assert.equal(held.closed,1);held.unmount();
});

test('signing out immediately clears story media, reply and playback', async()=>{
  const h=scenario('StoryViewer');await h.flush();
  assert.ok(nodes(h.tree).some(n=>n.props?.src==='https://media.test/story'));
  h.changeViewer(null);await h.flush();
  assert.ok(!nodes(h.tree).some(n=>n.props?.src==='https://media.test/story'));
  assert.equal(h.intervals,0);h.unmount();
});

test('holding a nested card uses the whole surface and consumes the eventual click', async () => {
  const h=scenario('StoryViewer',{video:true}); await h.flush();
  const surface=nodes(h.tree).find(n=>n.props?.onPointerDownCapture);
  surface.props.onPointerDownCapture({button:0,isPrimary:true,clientX:80,clientY:220});
  h.timeout(200); assert.equal(h.intervals,0); assert.equal(h.player.paused,true);
  surface.props.onPointerUpCapture(); assert.equal(h.intervals,1);
  let prevented=0,stopped=0;
  surface.props.onClickCapture({detail:1,preventDefault:()=>prevented++,stopPropagation:()=>stopped++});
  assert.equal(prevented,1); assert.equal(stopped,1); assert.equal(h.closed,0);
  h.unmount();
});
test('cancelling a surface hold or dragging a slider does not leave the viewer paused', async () => {
  const h=scenario('StoryViewer'); await h.flush();
  const surface=nodes(h.tree).find(n=>n.props?.onPointerDownCapture);
  surface.props.onPointerDownCapture({button:0,isPrimary:true,clientX:10,clientY:10});
  surface.props.onPointerMoveCapture({clientX:55,clientY:10});h.timeout(200);assert.equal(h.intervals,1);
  surface.props.onPointerDownCapture({button:0,isPrimary:true,clientX:10,clientY:10});h.timeout(200);assert.equal(h.intervals,0);
  surface.props.onPointerCancelCapture();assert.equal(h.intervals,1);h.unmount();
});

test('typing into a question sticker pauses playback until focus leaves the field', async () => {
  const h=scenario('StoryViewer',{video:true});await h.flush();
  const surface=nodes(h.tree).find(n=>n.props?.onFocusCapture);
  surface.props.onFocusCapture({target:{closest:()=>({})}});assert.equal(h.intervals,0);
  surface.props.onPointerDownCapture({button:0,isPrimary:true,clientX:10,clientY:10});h.timeout(200);surface.props.onPointerUpCapture();assert.equal(h.intervals,0);
  surface.props.onBlurCapture({relatedTarget:null});assert.equal(h.intervals,1);h.unmount();
});
