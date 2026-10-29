const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];

test('fullscreen mixed-media viewer hands the original order and voice recipe to the same carousel player',()=>{
 let cursor=0,listener;const state=[],effects=[],cleanups=[];
 const react={useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>state[i]=value];},useEffect(fn){const i=cursor++;if(!(i in state)){state[i]=true;effects.push(fn);}}};
 const jsx=(type,props)=>({type,props}),media=[{url:'photo.jpg',media_type:'image'},{url:'voice.mp4',media_type:'video',edit:{voiceEffect:'deep',trimStart:2,trimEnd:8}},{url:'last.jpg',media_type:'image'}];
 const navigation={exports:{}};vm.runInNewContext(compile('shared/carouselNavigation.ts'),navigation);
 const module={exports:{}};vm.runInNewContext(compile('src/components/PostMediaViewer.tsx'),{module,exports:module.exports,require:name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name==='react-native')return{View:'View',Text:'Text',Modal:'Modal',TouchableOpacity:'Button',useWindowDimensions:()=>({width:390,height:844}),AppState:{currentState:'active',addEventListener(_name,fn){listener=fn;return{remove(){listener=null;}};}}};
  if(name==='react-native-gesture-handler')return{GestureHandlerRootView:'Root'};if(name==='@expo/vector-icons')return{Feather:'Icon'};if(name==='./SafeArea')return{useSafeAreaInsets:()=>({top:50,bottom:20})};
  if(name==='./PostCarousel')return{__esModule:true,default:'PostCarousel'};if(name.endsWith('/carouselNavigation'))return navigation.exports;throw Error(name);
 }});
 const render=()=>{cursor=0;const tree=module.exports.default({media,initialIndex:1,postId:'post',onClose(){}});while(effects.length)cleanups.push(effects.shift()());return nodes(tree).find(node=>node.type==='PostCarousel').props;};
 const player=render();assert.equal(player.media,media);assert.equal(player.initialIndex,1);assert.equal(player.fullFrame,true);assert.equal(player.media[1].edit.voiceEffect,'deep');assert.equal(player.media[1].edit.trimStart,2);assert.equal(player.isActive,true);
 listener('background');assert.equal(render().isActive,false);cleanups.forEach(fn=>fn?.());assert.equal(listener,null);
});

test('expanded native video respects saved pitch, mute and trim while viewer speed stays synchronized',()=>{
 const source=fs.readFileSync(path.join(root,'src/components/VideoFeedModal.tsx'),'utf8');
 const ast=ts.createSourceFile('VideoFeedModal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const cell=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='VideoCell');assert.ok(cell);
 // Execute the actual player setup/effects, stopping before gesture UI setup.
 const statements=[];for(const statement of cell.body.statements){if(statement.getText(ast).startsWith('const heartX'))break;statements.push(statement.getText(ast));}
 const shared={};for(const name of ['postVoiceEffects','postMediaEditing']){const target={exports:{}};vm.runInNewContext(compile(`shared/${name}.ts`),target);Object.assign(shared,target.exports);}
 let cursor=0,created=false;const values=[],deps=[],pending=[],cleanups=[],listeners=new Map();
 const player={currentTime:0,duration:12,playbackRate:1,preservesPitch:true,muted:false,playing:false,play(){this.playing=true;},pause(){this.playing=false;},addListener(name,fn){listeners.set(name,fn);return{remove(){listeners.delete(name);}};}};
 const context={...shared,useVideoPlayer(_uri,init){if(!created){created=true;init(player);}return player;},useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},useRef(initial){const i=cursor++;return values[i]??={current:initial};},useEffect(fn,next){const i=cursor++;if(!deps[i]||next.some((x,j)=>x!==deps[i][j])){deps[i]=next;pending.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}},setTimeout(){return 1;},clearTimeout(){}};
 vm.createContext(context);vm.runInContext(ts.transpileModule(`this.render=(${cell.parameters[0].getText(ast)})=>{${statements.join('\n')}}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 const props={item:{id:'post',url:'voice.mp4',edit:{voiceEffect:'chipmunk',trimStart:3,trimEnd:7}},active:true,startAt:1,speed:1,actions:{}};
 const render=()=>{cursor=0;context.render(props);while(pending.length)pending.shift()();};
 render();assert.equal(player.currentTime,3);assert.equal(player.playbackRate,1.5);assert.equal(player.preservesPitch,false);assert.equal(player.playing,true);
 player.currentTime=8;listeners.get('timeUpdate')({currentTime:8});assert.equal(player.currentTime,3);
 props.speed=.5;render();assert.equal(player.playbackRate,.75);assert.equal(player.preservesPitch,false);
 props.item={...props.item,edit:{voiceEffect:'original',speed:2,trimStart:3,trimEnd:7,muted:true}};props.speed=1;render();assert.equal(player.playbackRate,2);assert.equal(player.preservesPitch,true);assert.equal(player.muted,true);
 props.active=false;render();assert.equal(player.playing,false);cleanups.forEach(fn=>fn?.());assert.equal(listeners.size,0);
});
