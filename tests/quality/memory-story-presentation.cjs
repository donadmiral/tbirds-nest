const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const compile=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
function load(source,require=()=>({}),globals={}){const module={exports:{}};vm.runInNewContext(compile(source),{module,exports:module.exports,require,...globals});return module.exports;}
const rules=load(read('shared/memoryStoryPresentation.ts'));
const recipe={trimStart:.5,trimEnd:3.5,speed:1.5,mix:{orig:40},fit:'cover',scale:1.2,translateNX:.1,translateNY:-.2};
const stickers=[{id:'text',kind:'text',text:'A saved moment',style:'bold',color:'#FFFFFF',nx:.4,ny:.3,scale:1,rotation:.2},{id:'drawing',kind:'drawing',strokes:[{tool:'pen',color:'#FF0000',width:5,points:[{x:.1,y:.2},{x:.8,y:.7}]}]}];
const page={id:'page',media_url:'clip.mp4',media_type:'video',media_transform:recipe,filter_id:'warm',duration_sec:3,stickers};
function walk(node){return Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];}
function hooks(){let cursor=0;const slots=[],pending=[];const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((value,index)=>value!==b[index]);const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(fn,deps){const index=cursor++,old=slots[index];if(changed(old?.deps,deps)){slots[index]={deps,cleanup:old?.cleanup};pending.push(()=>{old?.cleanup?.();slots[index].cleanup=fn();});}}};react.useLayoutEffect=react.useEffect;react.useCallback=(fn,deps)=>{const index=cursor++;if(changed(slots[index]?.deps,deps))slots[index]={deps,value:fn};return slots[index].value;};react.useMemo=(fn,deps)=>{const index=cursor++;if(changed(slots[index]?.deps,deps))slots[index]={deps,value:fn()};return slots[index].value;};return{react,begin(){cursor=0;},flush(){while(pending.length)pending.shift()();},dispose(){for(const slot of slots)slot?.cleanup?.();}};}
function player(){const listeners=new Map();return{duration:4,status:'readyToPlay',currentTime:0,playing:false,plays:0,pauses:0,play(){this.playing=true;this.plays++;},pause(){this.playing=false;this.pauses++;},addListener(name,fn){const group=listeners.get(name)||new Set();listeners.set(name,group);group.add(fn);return{remove:()=>group.delete(fn)};},emit(name,value){for(const fn of listeners.get(name)||[])fn(value);},get listeners(){return[...listeners.values()].reduce((n,v)=>n+v.size,0);}};}
function nativeVideo(){const hook=hooks(),pv=player(),appListeners=new Set(),app={currentState:'active',addEventListener:(_name,fn)=>{appListeners.add(fn);return{remove:()=>appListeners.delete(fn)};}};let call='idle',initialized=false,props={url:'clip.mp4',page,active:true,onRetry(){}};
 const source=read('src/screens/profile/MemoryAlbumScreen.tsx');const code=source.slice(source.indexOf('function PageVideo('))+'\nmodule.exports.PageVideo=PageVideo;';
 const mod=load(code,name=>name==='react/jsx-runtime'?jsx:{},{...hook.react,React:hook.react,...rules,View:'View',Text:'Text',TouchableOpacity:'Button',Feather:'Icon',VideoView:'Video',MemoryStoryFrame:'Frame',useVideoPlayer(_url,init){if(!initialized){initialized=true;init(pv);}return pv;},useCallContext:()=>({callState:call}),AppState:app});
 const h={pv,render(next={}){props={...props,...next};hook.begin();const tree=mod.PageVideo(props);hook.flush();return tree;},background(){app.currentState='background';for(const fn of appListeners)fn();},foreground(){app.currentState='active';for(const fn of appListeners)fn();},call(value){call=value;h.render();},dispose:()=>hook.dispose()};h.render();return h;}
function webVideo(){const hook=hooks(),events=new Map(),videoEvents=new Map(),frames=new Map();let nextFrame=0;const doc={hidden:false,documentElement:{dataset:{}},addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)};const video={duration:4,currentTime:0,paused:true,plays:0,pauses:0,play(){this.paused=false;this.plays++;for(const fn of videoEvents.get('play')||[])fn();return Promise.resolve();},pause(){this.paused=true;this.pauses++;for(const fn of videoEvents.get('pause')||[])fn();},addEventListener(name,fn){const list=videoEvents.get(name)||new Set();list.add(fn);videoEvents.set(name,list);},removeEventListener(name,fn){videoEvents.get(name)?.delete(fn);},requestVideoFrameCallback(fn){frames.set(++nextFrame,fn);return nextFrame;},cancelVideoFrameCallback(id){frames.delete(id);}};let props={src:'clip.mp4',page,ownerId:'owner',active:true,onRetry(){}};
 const source=read('web/components/MemoryAlbum.tsx');const start=source.indexOf('function MemoryVideo('),end=source.indexOf('\nexport function MemoryAlbumView',start);
 const mod=load(source.slice(start,end)+'\nmodule.exports.MemoryVideo=MemoryVideo;',name=>name==='react/jsx-runtime'?jsx:{},{...hook.react,...rules,MemoryStoryFrame:'Frame',MessageButton:'Message',VolumeX:'VolumeX',Volume2:'Volume2',document:doc,window:{addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)}});
 const h={video,doc,events,frames,frame(time){video.currentTime=time;const current=[...frames.values()];frames.clear();current.forEach(fn=>fn());},render(next={}){props={...props,...next};hook.begin();const tree=mod.MemoryVideo(props);const frame=walk(tree).find(n=>n.type==='Frame');h.node=frame?.props.children({});if(h.node)h.node.props.ref.current=video;hook.flush();return tree;},dispose:()=>hook.dispose()};h.render();return h;}

test('saved recipe accepts legacy JSON and bounds invalid playback values without music fields',()=>{
 const value=rules.memoryStoryRecipe(JSON.stringify(recipe),4);assert.equal(value.start,.5);assert.equal(value.end,3.5);assert.equal(value.speed,1.5);assert.equal(value.volume,.4);
 const bad=rules.memoryStoryRecipe({trimStart:-5,trimEnd:Infinity,speed:Infinity,mix:{orig:900}},4);assert.equal(bad.start,0);assert.equal(bad.end,4);assert.equal(bad.speed,1);assert.equal(bad.volume,1);assert.equal(rules.memoryStoryRecipe({mix:{orig:0}}).volume,0);assert.equal(rules.memoryStoryStickers('bad JSON').length,0);assert.equal(rules.memoryStoryStickers(JSON.stringify(stickers))[0].text,'A saved moment');
});
test('native reader plays the observed 0.5–3.5 second excerpt at 1.5× and preserves original volume',()=>{
 const h=nativeVideo();assert.equal(h.pv.currentTime,.5);assert.equal(h.pv.playbackRate,1.5);assert.equal(h.pv.volume,.4);assert.equal(h.pv.playing,true);
 h.pv.currentTime=3.5;h.pv.emit('timeUpdate',{currentTime:3.5});assert.equal(h.pv.currentTime,.5,'published duration_sec=3 must not truncate the source window at 3');
 const button=walk(h.render()).find(n=>n.type==='Button'&&n.props.accessibilityLabel==='Unmute original video sound');button.props.onPress();h.render();assert.equal(h.pv.muted,false);assert.equal(h.pv.volume,.4);h.dispose();assert.equal(h.pv.listeners,0);assert.equal(h.pv.playing,false);
});
test('native page turns, calls and backgrounding pause the existing player without a stale trim callback restarting it',()=>{
 const h=nativeVideo();h.pv.currentTime=2;h.render({active:false});const plays=h.pv.plays;h.pv.emit('timeUpdate',{currentTime:3.5});assert.equal(h.pv.playing,false);assert.equal(h.pv.plays,plays);assert.equal(h.pv.currentTime,2);h.render({active:true});assert.equal(h.pv.currentTime,2);assert.equal(h.pv.playing,true);h.background();assert.equal(h.pv.playing,false);h.foreground();assert.equal(h.pv.playing,true);h.call('active');assert.equal(h.pv.playing,false);h.dispose();
});
test('web reader metadata and manual seeks honor trim, rate and original volume',()=>{
 const h=webVideo();h.node.props.onLoadedMetadata({currentTarget:h.video});assert.equal(h.video.currentTime,.5);assert.equal(h.video.playbackRate,1.5);assert.equal(h.video.volume,.4);h.video.currentTime=3.5;h.node.props.onTimeUpdate({currentTarget:h.video});assert.equal(h.video.currentTime,.5);h.video.currentTime=0;h.node.props.onSeeking({currentTarget:h.video});assert.equal(h.video.currentTime,.5);assert.equal(h.video.plays,0,'seeking a paused video never starts playback');h.dispose();
});
test('web turn pause/resume keeps one source and rejects hidden or call-time play events',()=>{
 const h=webVideo();h.video.play();h.video.currentTime=2;h.render({active:false});assert.equal(h.video.paused,true);const plays=h.video.plays;h.node.props.onTimeUpdate({currentTarget:h.video});assert.equal(h.video.plays,plays);h.render({active:true});assert.equal(h.video.paused,false);assert.equal(h.video.currentTime,2);h.doc.hidden=true;h.node.props.onPlay({currentTarget:h.video});assert.equal(h.video.paused,true);h.doc.hidden=false;h.doc.documentElement.dataset.platinumCallActive='true';h.node.props.onPlay({currentTarget:h.video});assert.equal(h.video.paused,true);h.dispose();assert.equal(h.events.size,0);
});
function frame(platform,initial=page,previewAvailable=false){const hook=hooks();let props={page:initial,children:()=>({type:'Media',props:{}})};const native={View:'View',Dimensions:{get:()=>({width:390})},StyleSheet:{absoluteFillObject:{},absoluteFill:{},create:x=>x}};
 const mod=load(read(platform==='native'?'src/components/memory/MemoryStoryFrame.tsx':'web/components/memory/MemoryStoryFrame.tsx'),name=>name==='react'?hook.react:name==='react/jsx-runtime'?jsx:name==='react-native'?native:name==='expo-linear-gradient'?{LinearGradient:'Gradient'}:name.endsWith('storyComposition')?{storyVideoCompositionAvailable:true,storyVideoPreviewAvailable:previewAvailable}:name.endsWith('memoryStoryPresentation')?rules:name.endsWith('StickerOverlay')?{default:'StickerOverlay',__esModule:true}:name.endsWith('DrawLayer')?{DrawingLayer:'DrawingLayer'}:name.endsWith('StoryFilters')?{FilterLayer:'FilterLayer'}:name.endsWith('StoryPixelImage')?{StoryPhotoLookContext:{Provider:'PhotoLookProvider'}}:name.endsWith('storyColorMatrix')?{storyPhotoSpatialAdjust:adjust=>adjust&&(adjust.grain||adjust.vig)?{grain:adjust.grain,vig:adjust.vig}:null}:name.endsWith('storyPanels')?{AdjustLayer:'AdjustLayer',BackgroundLayer:'BackgroundLayer'}:name.endsWith('storyFilterAppearance')?{STORY_FILTERS:[{id:'warm',layers:[{color:'#FF9A3C',opacity:.14}]}],filterCss:()=>undefined}:name.endsWith('StoryEngine')?{DrawSvg:'DrawSvg',EngineSticker:'EngineSticker',AdjustOverlay:'AdjustOverlay',BgLayer:'BgLayer',STICKER_ANIM_CSS:''}:{StoryStickerPreview:'StoryStickerPreview'});
 const h={render(next={}){props={...props,...next};hook.begin();return(platform==='native'?mod.default:mod.MemoryStoryFrame)(props);}};return h;}
for(const platform of ['native','web'])test(`${platform} photo pages render saved text and drawing together, and clip changes cannot keep old layers`,()=>{
 const h=frame(platform,{...page,media_type:'image',stickers:JSON.stringify(stickers)});let tree=h.render();if(platform==='native'){tree.props.onLayout({nativeEvent:{layout:{width:195,height:300}}});tree=h.render();}
 const nodes=walk(tree),text=nodes.find(n=>n.type===(platform==='native'?'StickerOverlay':'StoryStickerPreview')),draw=nodes.find(n=>n.type===(platform==='native'?'DrawingLayer':'DrawSvg'));
 assert.ok(text);assert.equal(platform==='native'?text.props.stickers[0].text:text.props.sticker.text,'A saved moment');assert.equal(platform==='native'?draw.props.strokes[0].points[1].x:draw.props.stickers.find(s=>s.kind==='drawing').strokes[0].points[1].x,.8);
 tree=h.render({page:{...page,id:'next-page',stickers:[]}});const next=walk(tree).find(n=>n.type===(platform==='native'?'StickerOverlay':'DrawSvg'));assert.equal(next.props.stickers.length,0);
});
test('timed text and drawing follow the video media clock in both readers',()=>{
 const timed=stickers.map(s=>({...s,startSec:1,endSec:2}));for(const platform of ['native','web']){const h=frame(platform,{...page,stickers:timed});let nodes=walk(h.render({clock:.5}));let layer=nodes.find(n=>n.type===(platform==='native'?'StickerOverlay':'DrawSvg'));assert.equal(layer.props.stickers.length,0);nodes=walk(h.render({clock:1.5}));layer=nodes.find(n=>n.type===(platform==='native'?'StickerOverlay':'DrawSvg'));assert.equal(layer.props.stickers.length,2);}
});


test('native fullscreen manual pause survives turns, backgrounding and calls',()=>{
 const h=nativeVideo();h.pv.pause();h.background();h.foreground();assert.equal(h.pv.playing,false);h.call('active');h.call('idle');assert.equal(h.pv.playing,false);h.render({active:false});h.render({active:true});assert.equal(h.pv.playing,false);h.pv.play();h.background();h.foreground();assert.equal(h.pv.playing,true);h.dispose();
});
test('web excerpt boundary is enforced on decoded frames before a coarse timeupdate and cancels on turns',()=>{
 const h=webVideo();h.video.play();assert.equal(h.frames.size,1);h.frame(3.5);assert.equal(h.video.currentTime,.5);h.render({active:false});assert.equal(h.frames.size,0);h.render({active:true});assert.equal(h.frames.size,1);h.dispose();assert.equal(h.frames.size,0);
});
test('native layout cells keep their normalized geometry and text stories retain both gradient colors',()=>{
 const h=frame('native',{...page,text_background:{kind:'gradient',colors:['#123456','#ABCDEF'],direction:'diagonal'},stickers:[{id:'cell',kind:'photo',photoShape:'cell',photoFw:.5,photoFh:.5,nx:.5,ny:.5,scale:1}]});let tree=h.render();tree.props.onLayout({nativeEvent:{layout:{width:195,height:300}}});tree=h.render();const nodes=walk(tree),cell=nodes.find(n=>n.type==='StickerOverlay').props.stickers[0],gradient=nodes.find(n=>n.type==='Gradient');assert.equal(cell.scale,1);assert.equal(gradient.props.colors[0],'#123456');assert.equal(gradient.props.colors[1],'#ABCDEF');
});
test('an authorized album refresh closes an expanded URL when that source is no longer present',()=>{
 const source=read('src/screens/profile/MemoryAlbumScreen.tsx');const line=source.split('\n').find(line=>line.includes('setPlayingUrl(current=>current&&'));assert.ok(line);let current='old.mp4';const scope={hydrated:{pages:[{media_url:'new.mp4'}]},...rules,setPlayingUrl:update=>{current=update(current);}};vm.runInNewContext(compile(line),scope);assert.equal(current,null);current='post.mp4';scope.hydrated.pages=[{stickers:JSON.stringify([{kind:'post',postMediaUrl:'post.mp4'}])}];vm.runInNewContext(compile(line),scope);assert.equal(current,'post.mp4');
});


test('legacy album layer JSON is decoded before the existing capability collector; denied URLs never reach the renderer',()=>{
 const media=load(read('shared/contentMedia.ts'),undefined,{URL}),base='https://example.supabase.co',url=base+'/storage/v1/object/public/story-media/owner/photo.jpg';
 const input={id:'album',pages:[{stickers:JSON.stringify([{id:'photo',kind:'photo',photoUrl:url}])}],cover_page:{stickers:JSON.stringify([{id:'post',kind:'post',postMediaUrl:url}])}};
 const normalized=rules.memoryAlbumStoryLayers(input);assert.equal(typeof input.pages[0].stickers,'string');assert.equal(media.contentMediaUrls(normalized,base).length,2);
 const denied=media.replaceContentMedia(normalized,base,new Map());assert.equal(denied.pages[0].stickers[0].photoUrl,null);assert.equal(denied.cover_page.stickers[0].postMediaUrl,null);
 const signed=base+'/storage/v1/object/sign/story-media/owner/photo.jpg?token=test';const allowed=media.replaceContentMedia(normalized,base,new Map([['story-media/owner/photo.jpg',signed]]));assert.equal(allowed.pages[0].stickers[0].photoUrl,signed);
});


test('native Play book advances exactly once at the saved video excerpt and pauses its player',()=>{
 const h=nativeVideo();let completed=0,progress=0;h.render({onEnd:()=>completed++,onProgress:value=>progress=value});
 assert.equal(h.pv.loop,false);h.pv.currentTime=2;h.pv.emit('timeUpdate',{currentTime:2});assert.equal(progress,.5);
 h.pv.currentTime=3.5;h.pv.emit('timeUpdate',{currentTime:3.5});h.pv.emit('playToEnd');assert.equal(completed,1);assert.equal(h.pv.playing,false);assert.equal(h.pv.currentTime,3.5);h.dispose();
});
test('native Play book also finishes when the decoder emits its end event without a final time update',()=>{
 const h=nativeVideo();let completed=0;h.render({onEnd:()=>completed++});h.pv.emit('playToEnd');h.pv.emit('playToEnd');assert.equal(completed,1);h.dispose();
});
test('web Play book advances once on decoded excerpt end instead of looping the same page',()=>{
 const h=webVideo();let completed=0,progress=0;h.render({onEnd:()=>completed++,onProgress:value=>progress=value});
 assert.equal(h.node.props.loop,false);assert.equal(h.video.paused,false);
 h.video.currentTime=2;h.node.props.onTimeUpdate({currentTarget:h.video});assert.equal(progress,.5);
 h.frame(3.5);h.node.props.onEnded({currentTarget:h.video});assert.equal(completed,1);assert.equal(h.video.paused,true);assert.equal(h.video.currentTime,3.5);h.dispose();
});

test('native memory photos use the saved pixel grade once while videos retain their playback overlays',()=>{
 const edited={...page,media_type:'image',media_transform:{...recipe,adjust:{bri:35,con:20,grain:12}}};
 const nodes=walk(frame('native',edited).render());const context=nodes.find(node=>node.type==='PhotoLookProvider');
 assert.equal(context.props.value.adjust.bri,35);assert.equal(context.props.value.filterId,'warm');assert.equal(nodes.some(node=>node.type==='FilterLayer'),false);
 const spatial=nodes.find(node=>node.type==='AdjustLayer');assert.equal(spatial.props.adjust.grain,12);assert.equal(spatial.props.adjust.bri,undefined);
 assert.equal(walk(frame('native',{...edited,media_type:'video'}).render()).some(node=>node.type==='FilterLayer'),true);
});

test('Android memory video overlays remain present when only its export encoder is available',()=>{
 const edited={...page,media_type:'video',media_transform:{...recipe,adjust:{bri:35,con:20,grain:12}}};
 for(const preview of [false,true]){
  const nodes=walk(frame('native',edited,preview).render()),context=nodes.find(node=>node.type==='PhotoLookProvider');
  assert.equal(nodes.some(node=>node.type==='FilterLayer'),!preview);
  assert.equal(nodes.find(node=>node.type==='AdjustLayer').props.adjust.bri,preview?undefined:35);
  if(preview)assert.equal(context.props.value.filterId,'warm');else assert.equal(context.props.value,null);
 }
});
