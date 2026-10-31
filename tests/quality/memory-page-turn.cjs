const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..');
const compile=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function load(file,require=()=>{},globals={}){const module={exports:{}};vm.runInNewContext(compile(read(file)),{module,exports:module.exports,require,...globals});return module.exports;}
const rules=load('shared/memoryBookTurn.ts'),design=load('shared/memoryBookDesign.ts');
const {MemoryBookTurnMachine,memoryTurnProgress,memoryTurnShouldCommit,memoryTurnDuration,memoryTurnAngle}=rules;
const ids=['one','two','three'];
function walk(node){return Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];}

test('turn bounds never wrap, including an empty book',()=>{
 const m=new MemoryBookTurnMachine(ids);assert.equal(m.begin(-1),null);m.sync(ids,2);assert.equal(m.begin(1),null);m.sync([],20);assert.equal(m.index,0);assert.equal(m.begin(1),null);assert.equal(m.begin(-1),null);
});
test('short drags cancel, deliberate drags commit, and flicks must move in the intended direction',()=>{
 assert.equal(memoryTurnShouldCommit(memoryTurnProgress(-35,350,1),0,1),false);
 assert.equal(memoryTurnShouldCommit(memoryTurnProgress(-130,350,1),0,1),true);
 assert.equal(memoryTurnShouldCommit(.05,-.7,1),true);assert.equal(memoryTurnShouldCommit(.05,.7,1),false);
 assert.equal(memoryTurnShouldCommit(.05,.7,-1),true);assert.equal(memoryTurnShouldCommit(.001,10,-1),false);
 assert.equal(memoryTurnProgress(100,350,1),0);assert.equal(memoryTurnProgress(-10000,350,1),1);
});
test('rapid navigation stays locked through commit until the new React page is acknowledged',()=>{
 const m=new MemoryBookTurnMachine(ids),first=m.begin(1);assert.equal(m.begin(1),null);assert.equal(m.begin(-1),null);
 assert.equal(m.finish(first.token,true),1);assert.equal(m.finish(first.token,true),null);assert.equal(m.begin(1),null);
 m.sync(ids,1);const second=m.begin(1);assert.equal(second.from,1);assert.equal(second.to,2);assert.equal(m.finish(first.token,true),null);assert.equal(m.turn.token,second.token);
});
test('a cancelled, reordered or replaced book rejects its old animation callback',()=>{
 const m=new MemoryBookTurnMachine(ids),old=m.begin(1,true);m.move(old.token,.5);m.cancel();const current=m.begin(1);
 assert.equal(m.finish(old.token,true),null);assert.equal(m.turn.token,current.token);m.sync(['two','one','three'],0);assert.equal(m.finish(current.token,true),null);assert.equal(m.index,0);
 const next=m.begin(1);m.sync(['new-book'],0);assert.equal(m.finish(next.token,true),null);assert.equal(m.turn,null);
});
test('front and back hinge angles are continuous and reduced motion has no timed turn',()=>{
 assert.ok(memoryTurnAngle(0,1)===0);assert.equal(memoryTurnAngle(.5,1),-90);assert.equal(memoryTurnAngle(1,1),-180);
 assert.equal(memoryTurnAngle(0,-1),-180);assert.equal(memoryTurnAngle(.5,-1),-90);assert.ok(memoryTurnAngle(1,-1)===0);
 assert.equal(memoryTurnDuration(.1,true,true),0);assert.equal(memoryTurnDuration(.8,false,true),0);assert.ok(memoryTurnDuration(.8,true,false)<memoryTurnDuration(.1,true,false));
});

function nativeHarness(initial={}){
 let cursor=0,props={pageIds:ids,index:0,width:330,height:440,active:true,reduceMotion:false,spine:'#8B2436',title:'Book',children:{type:'LivePlayer',props:{}},renderPreview:i=>({type:'StaticPreview',props:{index:i}}),...initial};
 const slots=[],effects=[],layouts=[],commits=[],turning=[],animations=[],ref={current:null};
 let clock=0,timerId=0;const timers=new Map();
 const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((v,i)=>v!==b[i]);
 const effect=(fn,deps,queue)=>{const i=cursor++,old=slots[i];if(changed(old?.deps,deps)){slots[i]={deps,cleanup:old?.cleanup,phase:queue===layouts?'layout':'passive'};queue.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}};
 const react={forwardRef:f=>f,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useMemo(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},useCallback(fn,deps){return react.useMemo(()=>fn,deps);},useLayoutEffect:(fn,deps)=>effect(fn,deps,layouts),useEffect:(fn,deps)=>effect(fn,deps,effects),useImperativeHandle:(handle,fn,deps)=>effect(()=>{handle.current=fn();},deps,layouts)};
 class Value{constructor(value){this.value=value;this.animation=null;}setValue(value){this.value=value;}interpolate(options){return{value:this,options};}stopAnimation(){const a=this.animation;if(a&&!a.done){a.done=true;a.callback?.({finished:false});}}}
 const native={Animated:{Value,View:'AnimatedView',timing:(value,options)=>({start:callback=>{const a={value,options,callback,done:false};value.animation=a;animations.push(a);}})},Easing:{out:v=>v,cubic:x=>x},PanResponder:{create:handlers=>({panHandlers:handlers})},Platform:{OS:'ios'},StyleSheet:{absoluteFill:{position:'absolute'},absoluteFillObject:{position:'absolute'},create:x=>x},Text:'Text',TouchableOpacity:'Button',View:'View'};
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const mod=load('src/components/memory/MemoryPageTurn.tsx',name=>name==='react'?react:name==='react/jsx-runtime'?runtime:name==='next/image'?{default:'img'}:name==='react-native'?native:name==='expo-image'?{Image:'Image'}:name.endsWith('memoryBookTurn')?rules:design,{setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{at:clock+ms,fn});return id;},clearTimeout:id=>timers.delete(id)});
 const h={commits,turning,animations,timers,ref,module:mod,render(next={},flushPassive=true){props={...props,...next};cursor=0;const tree=mod.default({...props,onCommit:v=>commits.push(v),onTurningChange:v=>turning.push(v)},ref);while(layouts.length)layouts.shift()();if(flushPassive)h.flushPassive();return tree;},flushPassive(){while(effects.length)effects.shift()();},advance(ms){clock+=ms;for(let i=0;i<1000;i++){const due=[...timers].filter(([,v])=>v.at<=clock).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0]);if(!due.length)return;const[id,item]=due[0];timers.delete(id);item.fn();}throw new Error('Unbounded native timer loop');},unmount(flushPassive=true){for(const slot of slots){if(!slot?.cleanup)continue;const cleanup=slot.cleanup;slot.cleanup=undefined;if(slot.phase==='passive'&&!flushPassive)effects.push(cleanup);else cleanup();}},finish(index=animations.length-1,finished=true){const a=animations[index];a.done=true;a.value.value=a.options.toValue;a.callback({finished});},preview(page){cursor=0;return mod.MemoryTurnPreview({page,index:0});}};h.render();return h;
}
test('native swipe completes or returns to its starting page, including interrupted gestures',()=>{
 const h=nativeHarness({index:1});let tree=h.render();assert.equal(tree.props.onMoveShouldSetPanResponder(null,{dx:-5,dy:0}),false);assert.equal(tree.props.onMoveShouldSetPanResponder(null,{dx:-25,dy:40}),false);
 tree.props.onPanResponderGrant(null,{dx:-15});tree.props.onPanResponderMove(null,{dx:-45});tree.props.onPanResponderRelease(null,{vx:0});assert.equal(h.animations.at(-1).options.toValue,0);h.finish();assert.deepEqual(h.commits,[]);
 tree=h.render();tree.props.onPanResponderGrant(null,{dx:-15});tree.props.onPanResponderMove(null,{dx:-180});tree.props.onPanResponderTerminate();assert.equal(h.animations.at(-1).options.toValue,0);h.finish();assert.deepEqual(h.commits,[]);
 tree=h.render();tree.props.onPanResponderGrant(null,{dx:-15});tree.props.onPanResponderMove(null,{dx:-180});tree.props.onPanResponderRelease(null,{vx:0});assert.equal(h.animations.at(-1).options.toValue,1);h.finish();assert.deepEqual(h.commits,[2]);
});
test('native rapid taps, stale callbacks and route changes cannot skip pages',()=>{
 const h=nativeHarness();h.ref.current.turn(1);h.ref.current.turn(1);h.ref.current.turn(1);assert.equal(h.animations.length,1);h.finish();assert.deepEqual(h.commits,[1]);h.ref.current.turn(1);assert.equal(h.animations.length,1);
 h.render({index:1});h.ref.current.turn(1);assert.equal(h.animations.length,2);h.ref.current.cancel();h.ref.current.turn(-1);h.finish(1);assert.deepEqual(h.commits,[1]);h.finish(2);assert.deepEqual(h.commits,[1,0]);
 h.render({index:0});h.ref.current.turn(1);h.render({pageIds:['new'],index:0});h.finish(3);assert.deepEqual(h.commits,[1,0]);
});
test('native reduced motion navigates immediately without starting a page animation',()=>{
 const h=nativeHarness({reduceMotion:true});h.ref.current.turn(1);h.ref.current.turn(1);assert.deepEqual(h.commits,[1]);assert.equal(h.animations.length,0);h.render({index:1});h.ref.current.turn(-1);assert.deepEqual(h.commits,[1,0]);
});
test('native turn reaches its requested page when the native completion callback never arrives',()=>{
 const h=nativeHarness();h.ref.current.turn(1);const duration=h.animations[0].options.duration;
 h.advance(duration-1);assert.deepEqual(h.commits,[]);h.advance(1);assert.deepEqual(h.commits,[1]);assert.equal(h.timers.size,0);
 h.finish(0,false);h.finish(0,true);assert.deepEqual(h.commits,[1]);h.ref.current.turn(1);assert.equal(h.animations.length,1);
 h.render({index:1});h.ref.current.turn(1);h.advance(h.animations[1].options.duration);assert.deepEqual(h.commits,[1,2]);
});
test('native completion or interruption wins before the duration and leaves no pending timer',()=>{
 for(const finished of [true,false]){const h=nativeHarness();h.ref.current.turn(1);h.finish(0,finished);assert.equal(h.timers.size,0);h.advance(10000);h.finish(0,true);assert.deepEqual(h.commits,finished?[1]:[]);}
});
test('native cancelled swipe unlocks at its settling duration even without native completion',()=>{
 const h=nativeHarness({index:1});let tree=h.render();tree.props.onPanResponderGrant(null,{dx:-15});tree.props.onPanResponderMove(null,{dx:-45});assert.equal(h.timers.size,0);tree.props.onPanResponderRelease(null,{vx:0});
 h.advance(h.animations[0].options.duration);assert.deepEqual(h.commits,[]);assert.equal(h.turning.at(-1),false);assert.equal(h.timers.size,0);
 tree=h.render();assert.equal(walk(tree).find(n=>n.type==='AnimatedView'&&n.props.importantForAccessibility==='auto')?.props.pointerEvents,'auto');
 h.ref.current.turn(-1);h.advance(h.animations[1].options.duration);assert.deepEqual(h.commits,[0]);h.finish(0,true);assert.deepEqual(h.commits,[0]);
});
test('native committed swipe uses its remaining duration and preserves one live media child',()=>{
 const h=nativeHarness();let tree=h.render();tree.props.onPanResponderGrant(null,{dx:-15});tree.props.onPanResponderMove(null,{dx:-180});tree.props.onPanResponderRelease(null,{vx:0});
 const duration=h.animations[0].options.duration;assert.ok(duration<rules.MEMORY_TURN_MS);assert.equal(walk(h.render()).filter(n=>n.type==='LivePlayer').length,1);
 h.advance(duration);assert.deepEqual(h.commits,[1]);h.render({index:1});assert.equal(h.turning.at(-1),false);assert.equal(h.timers.size,0);
});
for(const [name,invalidate] of [
 ['explicit cancellation',h=>h.ref.current.cancel()],
 ['route inactivity',h=>h.render({active:false})],
 ['book replacement',h=>h.render({pageIds:['replacement'],index:0})],
 ['external page selection',h=>h.render({index:2})],
 ['reduced motion change',h=>h.render({reduceMotion:true})],
 ['size change',h=>h.render({width:500,height:600})],
 ['unmount',h=>h.unmount()],
])test(`native ${name} retires both the duration and late native completion`,()=>{
 const h=nativeHarness();h.ref.current.turn(1);invalidate(h);assert.equal(h.timers.size,0);h.advance(10000);h.finish(0,true);assert.deepEqual(h.commits,[]);
});
for(const [name,next] of [['inactive route',{active:false}],['resized book',{width:500}],['reduced motion',{reduceMotion:true}]])test(`native ${name} rejects completion before passive effects flush`,()=>{
 const h=nativeHarness();h.ref.current.turn(1);h.render(next,false);h.advance(h.animations[0].options.duration);h.finish(0,true);assert.deepEqual(h.commits,[]);h.flushPassive();assert.equal(h.timers.size,0);
});
test('native unmount rejects completion before passive cleanup flushes',()=>{
 const h=nativeHarness();h.ref.current.turn(1);h.unmount(false);h.advance(h.animations[0].options.duration);h.finish(0,true);assert.deepEqual(h.commits,[]);h.flushPassive();assert.equal(h.timers.size,0);
});
test('native equivalent page arrays preserve the active turn while distinct identities cancel it',()=>{
 const h=nativeHarness();h.ref.current.turn(1);h.render({pageIds:[...ids]});h.advance(h.animations[0].options.duration);assert.deepEqual(h.commits,[1]);
 const other=nativeHarness({pageIds:['a|b','c']});other.ref.current.turn(1);other.render({pageIds:['a','b|c']});other.advance(other.animations[0].options.duration);other.finish(0,true);assert.deepEqual(other.commits,[]);
});
test('native animated sheets keep exactly one live media child and static adjacent previews',()=>{
 const h=nativeHarness();assert.equal(walk(h.render()).filter(n=>n.type==='LivePlayer').length,1);h.ref.current.turn(1);let nodes=walk(h.render());assert.equal(nodes.filter(n=>n.type==='LivePlayer').length,1);assert.equal(nodes.filter(n=>n.type==='StaticPreview').length,1);assert.equal(nodes.find(n=>n.type==='AnimatedView'&&n.props.accessibilityElementsHidden===true)?.props.pointerEvents,'none');
 h.finish();h.render({index:1});h.ref.current.turn(-1);nodes=walk(h.render());assert.equal(nodes.filter(n=>n.type==='LivePlayer').length,1);assert.equal(nodes.filter(n=>n.type==='StaticPreview').length,1);
});
test('turning video pages only use an authorized poster or a text fallback on both platforms',()=>{
 for(const file of ['src/components/memory/MemoryPageTurn.tsx','web/components/memory/MemoryPageTurn.tsx']){
  const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},react={forwardRef:f=>f,useState:()=>[[],()=>{}]};
  const mod=load(file,name=>name==='react'?react:name==='react/jsx-runtime'?runtime:name==='next/image'?{default:'img'}:name==='react-native'?{View:'View',Text:'Text',Platform:{OS:'ios'},StyleSheet:{absoluteFillObject:{},create:x=>x}}:name==='expo-image'?{Image:'Image'}:name.endsWith('memoryBookTurn')?rules:name.endsWith('memoryBookDesign')?design:{default:{}});
  for(const thumbnail_url of ['authorized.jpg',null]){const nodes=walk(mod.MemoryTurnPreview({page:{media_type:'video',media_url:'authorized.mp4',thumbnail_url},index:0}));assert.equal(nodes.filter(n=>['video','audio','Video','VideoView','VideoThumb'].includes(n.type)).length,0);assert.equal(nodes.filter(n=>n.type==='img'||n.type==='Image').length,thumbnail_url?1:0);}
 }
});
test('cover stamps use the chosen memory date and never invent a trip date',()=>{
 assert.equal(design.memoryCoverDate(null),null);assert.equal(design.memoryCoverDate('invalid'),null);const date=design.memoryCoverDate('2026-06-26T12:00:00Z');assert.equal(date.month,'JUN');assert.equal(date.year,'2026');assert.equal(date.ticket,'26·06·2026');assert.equal(design.memoryCoverMedia({media_type:'image',media_url:'signed.jpg',taken_at:'2026-06-26'}).takenAt,'2026-06-26');
});

function webHarness(reduced=false){
 let cursor=0,clock=0,frameId=0,props={pageIds:ids,index:0,active:true,spine:'#8B2436',title:'Book',children:{type:'LivePlayer',props:{}},renderPreview:i=>({type:'StaticPreview',props:{index:i}})};
 const slots=[],layouts=[],effects=[],commits=[],turning=[],frames=new Map(),ref={current:null},capture=new Set(),paint=new Map();
 const rootNode={clientWidth:330,style:{setProperty:(name,value)=>paint.set(name,value)},setPointerCapture:id=>capture.add(id),hasPointerCapture:id=>capture.has(id),releasePointerCapture:id=>capture.delete(id)};
 const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((v,i)=>v!==b[i]);
 const effect=(fn,deps,queue)=>{const i=cursor++,old=slots[i];if(changed(old?.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};queue.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}};
 const react={forwardRef:f=>f,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useMemo(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},useCallback(fn,deps){return react.useMemo(()=>fn,deps);},useLayoutEffect:(fn,deps)=>effect(fn,deps,layouts),useEffect:(fn,deps)=>effect(fn,deps,effects),useImperativeHandle:(handle,fn,deps)=>effect(()=>{handle.current=fn();},deps,layouts)};
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const mod=load('web/components/memory/MemoryPageTurn.tsx',name=>name==='react'?react:name==='react/jsx-runtime'?runtime:name==='next/image'?{default:'img'}:name.endsWith('memoryBookTurn')?rules:name.endsWith('memoryBookDesign')?design:{default:{}},{performance:{now:()=>clock},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:reduced,addEventListener(){},removeEventListener(){}}),document:{hidden:false,addEventListener(){},removeEventListener(){}}});
 const h={commits,turning,frames,ref,paint,capture,render(next={}){props={...props,...next};cursor=0;const tree=mod.MemoryPageTurn({...props,onCommit:v=>commits.push(v),onTurningChange:v=>turning.push(v)},ref);tree.props.ref.current=rootNode;while(layouts.length)layouts.shift()();while(effects.length)effects.shift()();return tree;},step(ms){clock+=ms;const calls=[...frames.values()];frames.clear();calls.forEach(fn=>fn(clock));}};h.render();return h;
}
const pointer=(x,y=100,time=0)=>({pointerId:1,button:0,clientX:x,clientY:y,timeStamp:time,target:{closest:()=>null}});
test('web pointer cancellation and vertical scrolling preserve the current page',()=>{
 const h=webHarness();let tree=h.render();tree.props.onPointerDown(pointer(250));tree.props.onPointerMove(pointer(245,150,30));tree.props.onPointerUp(pointer(245,150,100));assert.equal(h.frames.size,0);assert.deepEqual(h.commits,[]);
 tree=h.render();tree.props.onPointerDown(pointer(250));tree.props.onPointerMove(pointer(60,100,40));assert.ok(h.capture.has(1));tree.props.onPointerCancel(pointer(60,100,80));h.step(600);assert.deepEqual(h.commits,[]);assert.equal(h.capture.size,0);assert.equal(h.render().props['data-memory-turn'],'idle');
});
test('web committed swipe changes one page and preserves the single media child during the hinge',()=>{
 const h=webHarness();let tree=h.render();tree.props.onPointerDown(pointer(250));tree.props.onPointerMove(pointer(50,100,60));tree=h.render();assert.equal(tree.props['data-memory-turn'],'forward');assert.equal(walk(tree).filter(n=>n.type==='LivePlayer').length,1);assert.equal(walk(tree).filter(n=>n.type==='StaticPreview').length,1);assert.ok(Number(h.paint.get('--book-angle'))<-90);tree.props.onPointerUp(pointer(50,100,200));h.step(600);assert.deepEqual(h.commits,[1]);
 h.ref.current.turn(1);assert.equal(h.frames.size,0);h.render({index:1});h.ref.current.turn(-1);assert.equal(h.render().props['data-memory-turn'],'backward');h.step(600);assert.deepEqual(h.commits,[1,0]);
});
test('web tap and keyboard requests share a lock, and reduced motion commits without a frame',()=>{
 const h=webHarness();h.ref.current.turn(1);h.ref.current.turn(1);h.ref.current.turn(-1);assert.equal(h.frames.size,1);h.step(600);assert.deepEqual(h.commits,[1]);h.render({index:1});h.ref.current.turn(1);h.ref.current.cancel();h.step(600);assert.deepEqual(h.commits,[1]);
 const r=webHarness(true);r.ref.current.turn(1);assert.equal(r.frames.size,0);assert.deepEqual(r.commits,[1]);r.ref.current.turn(1);assert.deepEqual(r.commits,[1]);r.render({index:1});r.ref.current.turn(1);assert.deepEqual(r.commits,[1,2]);
});
