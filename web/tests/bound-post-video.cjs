const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
test('web grant can adopt the initial verified session but cannot follow replacement accounts or a changed startup session',()=>{
  const module={exports:{}};let ref,session={initialized:false,scope:null,changed:false};
  const nav={subscribe(){return()=>{}},getSnapshot(){return session;},getServerSnapshot(){return session;}};
  const deps={react:{useRef(v){return ref??={current:v};},useSyncExternalStore(_subscribe,snapshot){return snapshot();}},'./navigationCache':{getNavigationStore:()=>nav}};
  const file=path.join(__dirname,'../lib/useBoundPostVideo.ts');const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{exports:module.exports,require:name=>{assert.ok(Object.hasOwn(deps,name));return deps[name];}});
  const bound=module.exports.useBoundPostVideo;assert.equal(bound('first'),false);
  session={initialized:true,scope:'first-session',changed:false};assert.equal(bound('first'),true);
  session={initialized:true,scope:'second-session',changed:true};assert.equal(bound('first'),false);assert.equal(bound('new-grant'),true);
  session={initialized:true,scope:null,changed:true};assert.equal(bound('new-grant'),false);
  ref=null;session={initialized:false,scope:null,changed:false};assert.equal(bound('old'),false);session={initialized:true,scope:'later',changed:true};assert.equal(bound('old'),false);
});
