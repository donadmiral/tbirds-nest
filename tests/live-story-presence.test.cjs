const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks={}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true }}).outputText;
  vm.runInNewContext(code,{exports,require:name=>mocks[name] ?? load(path.join(path.dirname(file),name+'.ts')),AbortController,setTimeout,clearTimeout,URL});
  return exports;
}
const { createLiveStoryPresence, liveStorySessions, LIVE_STORY_PRESENCE_TTL } = load('shared/liveStoryPresence.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const live = (n=1, state='live') => ({id:id(n),host:{id:id(n+100),full_name:'Author'},state});
const page = (items=[],view=true) => ({items,capabilities:{view},next_cursor:null});
const flush = () => new Promise(resolve=>setImmediate(resolve));
test('multiple story surfaces share two bounded directory requests, including own and followed live-only hosts',async()=>{
  let calls=0,now=100;const store=createLiveStoryPresence(async filter=>{calls++;return page([live(filter==='mine'?2:1)]);},()=>now);
  await Promise.all([store.refresh('viewer'),store.refresh('viewer'),store.refresh('viewer')]);
  assert.equal(calls,2);assert.equal(liveStorySessions(store.getSnapshot(),'viewer',now).length,2);
  await store.refresh('viewer');assert.equal(calls,2);
  now+=LIVE_STORY_PRESENCE_TTL;assert.equal(liveStorySessions(store.getSnapshot(),'viewer',now).length,0);
  await store.refresh('viewer');assert.equal(calls,4);
});
test('directory refresh adds started lives and removes ended lives, with no false badges for setup/reconnecting/replay',async()=>{
  let items=[];const store=createLiveStoryPresence(async filter=>page(filter==='mine'?[]:items));
  await store.refresh('viewer');assert.equal(store.getSnapshot().sessions.length,0);
  items=[live(1),live(2,'starting'),live(3,'reconnecting'),live(4,'ended'),{...live(5),ended_at:'2026-11-04T12:00:00Z'}];
  await store.refresh('viewer',true);assert.equal(store.getSnapshot().sessions.length,1);assert.equal(store.getSnapshot().sessions[0].id,id(1));
  items=[live(1,'ended')];await store.refresh('viewer',true);assert.equal(store.getSnapshot().sessions.length,0);
});
test('revoked capability, missing row, malformed response and failed refresh all remove existing live presence',async()=>{
  let response=page([live()]),fail=false;const store=createLiveStoryPresence(async()=>{if(fail)throw Error('Offline');return response;});
  for(const replacement of [page([live()],false),page(),{items:'invalid'}]){
    response=page([live()]);await store.refresh('viewer',true);assert.equal(store.getSnapshot().sessions.length,1);
    response=replacement;await store.refresh('viewer',true);assert.equal(store.getSnapshot().sessions.length,0);
  }
  response=page([live()]);await store.refresh('viewer',true);fail=true;await store.refresh('viewer',true);assert.equal(store.getSnapshot().sessions.length,0);
});
test('account replacement aborts old requests and late responses cannot repopulate the next account',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});let block=true;const signals=[];
  const store=createLiveStoryPresence(async(_,signal)=>{signals.push(signal);if(block)await held;return page([live()]);});
  const pending=store.refresh('1:old');await flush();store.reset('2:new');assert.ok(signals.every(signal=>signal.aborted));
  assert.equal(liveStorySessions(store.getSnapshot(),'1:old').length,0);block=false;await store.refresh('2:new');
  release();await pending;assert.equal(store.getSnapshot().scope,'2:new');
  store.reset(null);assert.equal(store.getSnapshot().sessions.length,0);
});
const nodes = node => !node || typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
test('native live bubble routes the ring and story independently without nesting touch controls',()=>{
  const actions=[];const jsx=(type,props)=>({type,props});
  const Bubble=load('src/components/stories/LiveStoryBubble.tsx',{
    react:{},'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Image:'Image',Text:'Text',TouchableOpacity:'Button',View:'View'},
    '@react-navigation/native':{useNavigation:()=>({navigate:(...args)=>actions.push(args)})},'../../theme/useTheme':{themedSheet:fn=>fn({surface:{canvas:'#fff',sunken:'#eee'},ink:{primary:'#000',inverse:'#fff'},brand:{base:'#000'}})},
  }).default;
  let story=0;const tree=Bubble({session:live(),onStory:()=>story++});
  const buttons=nodes(tree).filter(node=>node.type==='Button');assert.equal(buttons.length,2);assert.equal(nodes(buttons[0]).filter(node=>node.type==='Button').length,1);
  buttons[0].props.onPress();assert.equal(actions[0][0],'LiveSession');assert.equal(actions[0][1].sessionId,id(1));buttons[1].props.onPress();assert.equal(story,1);
  assert.equal(Bubble({session:live(1,'ended')}),null);assert.equal(Bubble({session:live(1,'reconnecting')}),null);
  assert.equal(nodes(Bubble({session:live()})).filter(node=>node.type==='Button').length,1);
});

function nativeStrip({ following=[], stories=[], spot=[] }={}) {
  let cursor=0,dirty=true,tree,effects=[],scope=[];
  const actions=[],slots=[];const jsx=(type,props,key)=>({type,props,key});
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={memo:x=>x,useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(slots[i],value)){slots[i]=value;dirty=true;}}];},useRef(value){const i=cursor++;return slots[i]??={current:value};},useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
  const native=new Proxy({Animated:{createAnimatedComponent:x=>x}}, {get:(o,k)=>o[k]??k});
  const channel={on(){return channel;},subscribe(){return channel;}};
  const Strip=load('src/components/stories/StoryStrip.tsx',{
    react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'react-native':native,
    '../../hooks/useLiveStoryPresence':{useLiveStoryPresence:()=>following},'./LiveStoryBubble':{__esModule:true,default:'LiveStoryBubble'},
    '../../theme/useTheme':{themedSheet:fn=>fn({surface:{canvas:'#fff',hairline:'#eee'},ink:{inverse:'#fff'}})},
    '../TierName':{default:'TierName'},'../VerifiedBadge':{default:'VerifiedBadge'},'@expo/vector-icons':{Feather:'Feather'},'react-native-svg':{Circle:'Circle'},
    '@react-navigation/native':{useNavigation:()=>({navigate:(...args)=>actions.push(args)}),useFocusEffect:fn=>react.useEffect(fn,[fn])},
    '../../services/storiesService':{storiesService:{getCatchupFeed:async()=>stories}},'../../stores/authStore':{useAuthStore:()=>({profile:{id:id(200),full_name:'Self'}})},
    '../../services/supabase':{supabase:{rpc:async()=>({data:spot}),channel:()=>channel,removeChannel(){}}},'../../services/flagsService':{flagsService:{isEnabled:async()=>true}},
    '../../services/storyReadiness':{prefetchStoryEntry(){},invalidateStoryEntries(){}},
  }).default;
  const render=()=>{let n=0;while(dirty){if(++n>30)throw Error('Render loop');dirty=false;cursor=0;tree=Strip({});const pending=effects;effects=[];pending.forEach(fn=>fn());}return tree;};
  render();return{get tree(){return render();},actions,async flush(){for(let i=0;i<6;i++){await flush();render();}},refresh(){dirty=true;render();},cleanup(){slots.forEach(s=>s?.cleanup?.());}};
}
test('actual native story strip deduplicates followed live hosts and preserves their story sequence',async()=>{
  const session=live();const following=[session,live(2)];const stories=[{user_id:session.host.id,full_name:'Author',has_unseen:true}];
  const h=nativeStrip({following,stories});await h.flush();
  let bubbles=nodes(h.tree).filter(n=>n.type==='LiveStoryBubble');assert.equal(bubbles.length,2);
  const both=bubbles.find(n=>n.props.session.id===session.id);assert.equal(typeof both.props.onStory,'function');both.props.onStory();
  assert.equal(h.actions[0][0],'StoryViewer');assert.deepEqual(Array.from(h.actions[0][1].userIds),[session.host.id]);
  assert.equal(bubbles.find(n=>n.props.session.id===id(2)).props.onStory,undefined);
  following.splice(0);h.refresh();assert.equal(nodes(h.tree).filter(n=>n.type==='LiveStoryBubble').length,0);
  assert.ok(nodes(h.tree).some(n=>n.key===session.host.id),'The original story remains after live ends');h.cleanup();
});
test('actual native story strip gives a live spotlight host a separate Story action without a duplicate ring',async()=>{
  const session=live();const h=nativeStrip({following:[session],spot:[{user_id:session.host.id,story_id:id(50),full_name:'Author'}]});await h.flush();
  const bubbles=nodes(h.tree).filter(n=>n.type==='LiveStoryBubble');assert.equal(bubbles.length,1);bubbles[0].props.onStory();
  assert.equal(h.actions[0][0],'StoryViewer');assert.equal(h.actions[0][1].startUserId,session.host.id);h.cleanup();
});
