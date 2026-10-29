const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function compile(source,globals={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,...globals});return module.exports;}
const light=compile(read('src/constants/tokens/light.ts')).light,dark=compile(read('src/constants/tokens/dark.ts')).dark;
const flatten=value=>Array.isArray(value)?Object.assign({},...value.filter(Boolean).map(flatten)):value||{};
const walk=n=>Array.isArray(n)?n.flatMap(walk):n&&typeof n==='object'?[n,...walk(n.props?.children)]:[];
function rgba(value){if(value.startsWith('#')){let hex=value.slice(1);if(hex.length===3)hex=[...hex].map(x=>x+x).join('');return[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)).concat(1);}const values=value.match(/[\d.]+/g).map(Number);return values.length===3?values.concat(1):values;}
const blend=(fg,bg)=>{const a=rgba(fg),b=rgba(bg);return a.slice(0,3).map((n,i)=>n*a[3]+b[i]*(1-a[3]));};
const luma=rgb=>rgb.map(v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
function contrast(fg,bg,canvas='#fff'){const bgRgb=blend(bg,canvas),bgHex='#'+bgRgb.map(x=>Math.round(x).toString(16).padStart(2,'0')).join(''),a=luma(blend(fg,bgHex)),b=luma(bgRgb);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
function theme(){let resolved='light',subscriptions=0;const store=select=>{subscriptions++;return select({resolved});};store.getState=()=>({resolved});const api=compile(read('src/theme/useTheme.ts'),{require:name=>name==='react'?{useMemo:fn=>fn()}:name==='react-native'?{StyleSheet:{create:x=>x}}:name.endsWith('/light')?{light}:name.endsWith('/dark')?{dark}:{useThemeStore:store}});return{...api,set:mode=>{resolved=mode;},get subscriptions(){return subscriptions;}};}
function ast(file){return ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
function styles(file,themeApi){const tree=ast(file);let expr;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='s'&&n.initializer?.getText(tree).startsWith('themedSheet('))expr=n.initializer.getText(tree);ts.forEachChild(n,visit);}visit(tree);assert.ok(expr,file);return compile('export const styles='+expr,{...themeApi,StyleSheet:{hairlineWidth:.5},Platform:{OS:'ios'},HAIR:.5,NAVY:light.ink.primary,SCREEN_W:390,TILE_W:177,...compile(read('src/constants/tokens/spacing.ts')),...compile(read('src/constants/tokens/radius.ts')),...compile(read('src/constants/tokens/typography.ts'))}).styles;}
const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
function element(tree,predicate){let found;function visit(n){if(!found&&(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n))&&predicate(n))found=n;ts.forEachChild(n,visit);}visit(tree);assert.ok(found,'requested live JSX exists');return found;}

test('feed render and style tokens switch light to dark to light with readable paired action colors',()=>{
 const file='src/screens/feed/FeedScreen.tsx',tree=ast(file),api=theme(),sheet=styles(file,api);
 const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='FeedScreen');
 const declarations=fn.body.statements.filter(n=>ts.isVariableStatement(n)&&n.getText(tree).includes('= useTheme()'));
 assert.equal(declarations.length,1,'feed must subscribe to palette changes');
 const navy=fn.body.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)==='NAVY'));
 assert.ok(navy,'render must compute its active ink rather than capture a module snapshot');
 const button=element(tree,n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(tree)==='TouchableOpacity'&&n.getText(tree).includes('backgroundColor: NAVY')&&n.getText(tree).includes('>Follow</Text>'));
 const render=compile('export function render(){'+declarations.map(x=>x.getText(tree)).join('\n')+'\n'+navy.getText(tree)+'\nreturn ('+button.getText(tree)+');}',{...api,p:{id:'fixture'},toggleFollow(){},TouchableOpacity:'Button',Text:'Text',require:()=>runtime}).render;
 const seen=[];
 for(const mode of ['light','dark','light']){api.set(mode);const t=api.getTheme(),node=render(),text=walk(node).find(n=>n.type==='Text');seen.push(node.props.style.backgroundColor);assert.equal(node.props.style.backgroundColor,t.ink.primary);assert.equal(text.props.style.color,t.ink.inverse);assert.ok(contrast(text.props.style.color,node.props.style.backgroundColor)>=4.5);assert.ok(contrast(sheet.content.color,sheet.postCard.backgroundColor)>=4.5);assert.ok(contrast(sheet.cMediaActionText.color,sheet.cMediaAction.backgroundColor)>=4.5);}
 assert.notEqual(seen[0],seen[1]);assert.equal(seen[0],seen[2]);assert.equal(api.subscriptions,3);
});

test('settings search accepts text and clears it in a flexible 48-point control across themes',()=>{
 const tree=ast('src/screens/profile/SettingsScreen.tsx'),api=theme();
 const input=element(tree,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(tree)==='TextInput'&&n.getText(tree).includes('placeholder="Search settings"'));
 let wrapper=input.parent;while(wrapper&&!ts.isJsxElement(wrapper))wrapper=wrapper.parent;
 // Track query with an accessor so the actual input/clear callbacks read current state.
 let query='';const module={exports:{}},context={module,exports:module.exports,...api,View:'View',Feather:'Icon',TextInput:'Input',TouchableOpacity:'Button',require:()=>runtime,setSettingsQuery:value=>{query=value;}};
 Object.defineProperty(context,'settingsQuery',{get:()=>query});
 vm.runInNewContext(ts.transpileModule('export function render(){return ('+wrapper.getText(tree)+');}',{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText,context);
 for(const mode of ['light','dark','light']){api.set(mode);let root=module.exports.render(),field=walk(root).find(n=>n.type==='Input');const st=flatten(field.props.style);assert.ok(st.minHeight>=48);assert.equal(st.height,undefined);assert.equal(st.flex,1);assert.equal(st.minWidth,0);assert.equal(field.props.accessibilityLabel,'Search settings');assert.ok(contrast(st.color,root.props.style.backgroundColor,api.getTheme().surface.canvas)>=4.5);assert.ok(contrast(field.props.placeholderTextColor,root.props.style.backgroundColor,api.getTheme().surface.canvas)>=4.5);field.props.onChangeText('privacy');root=module.exports.render();assert.equal(walk(root).find(n=>n.type==='Input').props.value,'privacy');const clear=walk(root).find(n=>n.props?.accessibilityLabel==='Clear settings search');assert.ok(clear);assert.ok(clear.props.style.minWidth>=44);clear.props.onPress();assert.equal(walk(module.exports.render()).find(n=>n.type==='Input').props.value,'');}
});

for(const file of ['src/screens/feed/SearchScreen.tsx','src/screens/messages/ConversationsScreen.tsx','src/screens/messages/CreateGroupScreen.tsx','src/screens/profile/FollowListScreen.tsx'])test(file.split('/').at(-1)+' keeps search input readable and tall enough in both palettes',()=>{
 const api=theme(),sheet=styles(file,api);for(const mode of ['light','dark']){api.set(mode);const field=sheet.searchInput,wrapper=sheet.searchWrap||sheet.searchBox;assert.ok(field.minHeight>=48);assert.equal(field.height,undefined);assert.equal(field.minWidth,0);assert.equal(field.flex,1);assert.ok((wrapper?.minHeight||0)>=48);assert.ok(contrast(field.color,wrapper.backgroundColor,api.getTheme().surface.canvas)>=4.5);}
});

test('feed article excerpts remain readable on the active article surface',()=>{
 const api=theme(),sheet=styles('src/screens/feed/FeedScreen.tsx',api);for(const mode of ['light','dark']){api.set(mode);const ratio=contrast(sheet.articleExcerpt.color,sheet.articleCard.backgroundColor);assert.ok(ratio>=4.5,`${mode} article excerpt contrast is ${ratio.toFixed(2)}:1`);}
});
