const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/stores/themeStore.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function setup(saved='system'){
 let state,listener;const exports={},read=deferred(),writes=[];
 const create=fn=>{const set=patch=>state={...state,...patch};state=fn(set,()=>state);return{getState:()=>state,setState:set};};
 vm.runInNewContext(compiled,{exports,require:name=>name==='zustand'?{create}:name==='react-native'?{Appearance:{getColorScheme:()=> 'light',addChangeListener:fn=>{listener=fn;}}}:{__esModule:true,default:{getItem:()=>read.promise,setItem:async(...args)=>writes.push(args)}}});
 return{store:exports.useThemeStore,read,writes,resolve:()=>read.resolve(saved),system:colorScheme=>listener({colorScheme})};
}
test('late saved theme hydration cannot overwrite a newer user choice',async()=>{
 const h=setup('light'),pending=h.store.getState().init();await h.store.getState().setMode('dark');h.resolve();await pending;
 assert.equal(h.store.getState().mode,'dark');assert.equal(h.store.getState().resolved,'dark');assert.equal(h.writes[0][1],'dark');
});
test('system mode resolves against the latest system appearance while storage is pending',async()=>{
 const h=setup('system'),pending=h.store.getState().init();h.system('dark');h.resolve();await pending;
 assert.equal(h.store.getState().resolved,'dark');h.system('light');assert.equal(h.store.getState().resolved,'light');
});
test('explicit appearance is preserved when the operating system changes',async()=>{
 const h=setup('dark'),pending=h.store.getState().init();h.resolve();await pending;h.system('light');assert.equal(h.store.getState().resolved,'dark');
 await h.store.getState().setMode('system');assert.equal(h.store.getState().resolved,'light');h.system('dark');assert.equal(h.store.getState().resolved,'dark');
});


test('lights out is a distinct persisted dark palette and survives system changes',async()=>{
 const h=setup('lightsOut'),pending=h.store.getState().init();h.resolve();await pending;
 assert.equal(h.store.getState().mode,'lightsOut');assert.equal(h.store.getState().resolved,'dark');
 h.system('light');assert.equal(h.store.getState().mode,'lightsOut');assert.equal(h.store.getState().resolved,'dark');
 await h.store.getState().setMode('dark');assert.equal(h.store.getState().resolved,'dark');assert.equal(h.writes.at(-1)[1],'dark');
});
