const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('../node_modules/react');
const {renderToString} = require('../node_modules/react-dom/server');
const jsx = require('../node_modules/react/jsx-runtime');
const root = path.resolve(__dirname,'..');
function code(file) {return ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;}
function scenario({now=Date.parse('2026-10-28T12:00:00Z'),mode='server'}={}) {
 let clock=now,hook; const intervals=new Map(),listeners=new Map();
 class Clock extends Date {static now(){return clock;}}
 const context={Date:Clock,exports:{}};
 vm.runInNewContext(code('lib/feed.ts'),context); const helpers=context.exports;
 const react=mode==='actual-server'?React:{useSyncExternalStore(subscribe,snapshot,serverSnapshot){hook={subscribe,snapshot,serverSnapshot};return mode==='client'?snapshot():serverSnapshot();}};
 const module={exports:{}};
 vm.runInNewContext(code('components/RelativeTime.tsx'),{module,exports:module.exports,Date:Clock,Set,
  require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return jsx;if(name==='@/lib/feed')return helpers;throw Error(name);},
  setInterval(fn,delay){const key={fn,delay};intervals.set(key,key);return key;},clearInterval(key){intervals.delete(key);},
  document:{addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}},
 });
 return{helpers,intervals,listeners,get hook(){return hook;},setNow(value){clock=value;},render(iso){return renderToString(React.createElement(module.exports.RelativeTime,{dateTime:iso}));}};
}
test('actual React server HTML matches the first hydration render across timezone and clock boundaries',()=>{
 const previous=process.env.TZ;
 try {
  for(const iso of ['2026-10-18T00:01:00Z','2026-10-28T11:59:01Z','2026-10-27T12:00:01Z']) {
   process.env.TZ='UTC';const server=scenario({mode:'actual-server',now:Date.parse('2026-10-28T12:00:00Z')}).render(iso);
   process.env.TZ='America/Phoenix';const hydrated=scenario({now:Date.parse('2026-10-28T12:00:04Z')}).render(iso);
   assert.equal(hydrated,server);assert.doesNotMatch(server,/suppressHydrationWarning/);
  }
 } finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('post dates stay on the same UTC calendar day across opposing browser zones',()=>{
 const previous=process.env.TZ;
 try {
  for(const zone of ['UTC','America/Phoenix','Pacific/Kiritimati']){
   process.env.TZ=zone;const h=scenario();assert.equal(h.helpers.absolutePostDate('2026-10-18T00:01:00Z'),'Oct 18');
   assert.equal(h.helpers.timeAgo('2026-10-18T00:01:00Z',Date.parse('2026-10-28T12:00:00Z')),'Oct 18');
  }
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('hydrated labels retain seconds, minutes, hours and days without invalid date output',()=>{
 const h=scenario({mode:'client'}),now=Date.parse('2026-10-28T12:00:00Z');
 for(const [age,label]of[[12000,'12s'],[120000,'2m'],[7200000,'2h'],[172800000,'2d']])assert.match(h.render(new Date(now-age).toISOString()),new RegExp('>'+label+'<'));
 assert.match(h.render('broken timestamp'),/Date unavailable/);assert.doesNotMatch(h.render('broken timestamp'),/NaN|Invalid Date|datetime=/);
});
test('many timestamps share one timer and release listeners after the last unmount',()=>{
 const h=scenario({mode:'client'});h.render('2026-10-28T11:59:00Z');const store=h.hook;let updates=0;
 const a=store.subscribe(()=>updates++),b=store.subscribe(()=>updates++);assert.equal(h.intervals.size,1);assert.equal(h.listeners.size,1);
 h.setNow(Date.parse('2026-10-28T12:01:00Z'));[...h.intervals.values()][0].fn();assert.ok(updates>=3);assert.equal(store.snapshot(),Date.parse('2026-10-28T12:01:00Z'));
 a();assert.equal(h.intervals.size,1);b();assert.equal(h.intervals.size,0);assert.equal(h.listeners.size,0);
});
