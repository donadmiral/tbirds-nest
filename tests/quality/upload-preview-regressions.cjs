const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const base = 'https://example.supabase.co';
const raw = `${base}/storage/v1/object/public/post-media/owner/photo.jpg`;
const signed = `${base}/storage/v1/object/sign/post-media/owner/photo.jpg?token=private`;
function moduleOf(file, imports, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => imports[name], URL, setTimeout, clearTimeout, ...globals });
  return exports;
}
const shared = moduleOf('shared/contentMedia.ts', {});
function harness(platform) {
  let cursor=0, dirty=true, result, effects=[], source={body:`![Caption](${raw})`}, authListener;
  const slots=[], work=[], intervals=new Map();
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
  const react={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;dirty=true;}];},
    useMemo(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},
  };
  const client={auth:{onAuthStateChange(fn){authListener=fn;return{data:{subscription:{unsubscribe(){authListener=null;}}}};}}};
  const hydration={hydrateUploadMedia(rows){return new Promise((resolve,reject)=>work.push({rows,resolve,reject}));}};
  const imports={react,'../../shared/contentMedia':shared,'./contentMedia':hydration,'../services/contentMedia':hydration,'./supabase/client':{createClient:()=>client},'../services/supabase':{supabase:client,SUPABASE_URL:base},'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}}};
  const file=platform==='web'?'web/lib/useUploadPreview.ts':'src/hooks/useUploadPreview.ts';
  const hook=moduleOf(file,imports,{process:{env:{NEXT_PUBLIC_SUPABASE_URL:base}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},queueMicrotask,setInterval(fn){intervals.set(1,fn);return 1;},clearInterval(id){intervals.delete(id);}}).useUploadPreview;
  const render=()=>{let loops=0;while(dirty){if(++loops>20)throw Error('loop');dirty=false;cursor=0;result=hook(source);const pending=effects;effects=[];pending.forEach(fn=>fn());}return result;};
  render();
  return{render,work,get source(){return source;},changeSource(value){source=value;dirty=true;return render();},changeAccount(){authListener?.('SIGNED_OUT',null);return render();},async flush(){for(let i=0;i<5;i++){await new Promise(r=>setImmediate(r));render();}},unmount(){slots.forEach(slot=>slot?.cleanup?.());},intervals};
}
for(const platform of ['web','native']){
  test(`${platform} preview hides unsigned media and never changes the editable source`,async()=>{
    const h=harness(platform);assert.equal(h.render().preview.body,'[Caption]');
    h.work[0].resolve([{body:`![Caption](${signed})`}]);await h.flush();
    assert.equal(h.render().preview.body,`![Caption](${signed})`);assert.equal(h.source.body,`![Caption](${raw})`);h.unmount();assert.equal(h.intervals.size,0);
  });
  test(`${platform} account changes immediately remove preview capabilities`,async()=>{
    const h=harness(platform);h.work[0].resolve([{body:`![Caption](${signed})`}]);await h.flush();
    assert.equal(h.changeAccount().preview.body,'[Caption]');await h.flush();
    h.work.at(-1).reject(new Error('not owner'));await h.flush();assert.equal(h.render().preview.body,'[Caption]');assert.ok(h.render().error);h.unmount();
  });
  test(`${platform} a late prior draft preview cannot overwrite another draft`,async()=>{
    const h=harness(platform), previous=h.work[0];h.changeSource({body:'Other draft'});
    previous.resolve([{body:`![Caption](${signed})`}]);await h.flush();assert.equal(h.render().preview.body,'Other draft');h.unmount();
  });
}
