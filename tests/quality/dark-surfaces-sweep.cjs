const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
function compile(code,scope={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,...scope});return module.exports;}
const light=compile(read('src/constants/tokens/light.ts')).light,dark=compile(read('src/constants/tokens/dark.ts')).dark,lightsOut=compile(read('src/constants/tokens/lightsOut.ts'),{require:()=>({dark})}).lightsOut;
function sheet(file,t){const source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let code;function visit(node){if(ts.isVariableDeclaration(node)&&['s','ss','st'].includes(node.name.getText(ast))&&node.initializer?.getText(ast).startsWith('themedSheet('))code=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(code);return compile('export const value='+code,{themedSheet:fn=>fn(t),StyleSheet:{hairlineWidth:.5},HAIR:.5,Platform:{OS:'ios'},PAGE_CREAM:'#FBF6EC',GOLD:'#F5A623',...compile(read('src/constants/tokens/spacing.ts')),...compile(read('src/constants/tokens/typography.ts')),...compile(read('src/constants/tokens/radius.ts'))}).value;}
function rgb(color){if(color.startsWith('#')){let hex=color.slice(1);if(hex.length===3)hex=[...hex].map(x=>x+x).join('');return[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)).concat(1);}const v=color.match(/[\d.]+/g).map(Number);return v.length===3?v.concat(1):v;}
function blend(fg,bg){const f=rgb(fg),b=rgb(bg);return f.slice(0,3).map((v,i)=>Math.round(v*f[3]+b[i]*(1-f[3])));}
const hex=rgb=>'#'+rgb.map(x=>x.toString(16).padStart(2,'0')).join('');
const luma=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
function ratio(fg,bg,canvas){const b=blend(bg,canvas),a=blend(fg,hex(b));return(Math.max(luma(a),luma(b))+.05)/(Math.min(luma(a),luma(b))+.05);}
const cases=[
 ['src/screens/profile/MemoryAlbumScreen.tsx',[['topTitle','safe'],['input','sheet'],['lbl','sheet'],['hint','sheet'],['handCaption','polaroid'],['handDate','polaroid'],['fabTxt','fab'],['inChipTxt','inChip']]],
 ['src/screens/feed/SavedPostsScreen.tsx',[['content','card'],['authorSub','card'],['headerTitle','header'],['avatarFbTxt','avatarFb']]],
 ['src/screens/network/NetworkScreen.tsx',[['title','header'],['subtitle','header'],['tabTxt','tab'],['tabTxtActive','tabActive'],['followBtnTxtActive','followBtnActive'],['joinBtnTxtActive','joinBtnActive']]],
 ['src/screens/notifications/NotificationsScreen.tsx',[['chipTxt','chip'],['chipTxtOn','chipOn'],['avatarTxt','avatarFb'],['retryTxt','retry'],['time','safe']]],
 ['src/screens/feed/SearchScreen.tsx',[['postBody','postRow'],['avatarTxt','avatarFb'],['tabTxtActive','tabActive'],['searchInput','searchBox']]],
 ['src/components/market/SellerTrust.tsx',[['pillTxt','pill'],['pillTxtWarn','pillWarn']]],
 ['src/components/market/SellerReviews.tsx',[['writeTxt','writeBtn'],['input','composer'],['postTxt','post']]],
 ['src/components/market/ReportListingSheet.tsx',[['title','sheet'],['sub','sheet'],['rowTitle','sheet'],['input','input'],['ctaTxt','cta']]],
];
for(const [file,pairs] of cases)test(file.split('/').at(-1)+' keeps actual text and control colors readable in Light, Dim and Lights out',()=>{
 assert.match(read(file),/useTheme\(\)/,'screen or component subscribes to live theme changes');
 for(const [mode,t]of Object.entries({light,dark,lightsOut})){const s=sheet(file,t);for(const [text,surface]of pairs){const contrast=ratio(s[text].color,s[surface].backgroundColor||t.surface.canvas,t.surface.canvas);assert.ok(contrast>=4.5,`${mode}: ${text} on ${surface} is ${contrast.toFixed(2)}:1`);}}
});
