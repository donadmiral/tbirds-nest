const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const source = compile('components/StoryComposer.tsx');
const publication = compile('lib/publication.ts');
const queueSource = compile('lib/storyClipQueue.ts');
const defer = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
const draft = (owner, name = 'draft-' + owner) => ({ id: name, user_id: owner, media_url: 'https://media.test/' + name, media_type: 'image', audience: 'only_with', shared_with: ['friend-' + owner], caption: 'Private ' + owner, duration_sec: null });
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children ?? '');
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

function scenario(options = {}) {
  let owner = 'a', listener, cursor = 0, tree, dirty = true, effects = [], mounted = true, updatesAfterUnmount = 0, nextTimer = 0, nextUuid = 0;
  const slots = [], timers = new Map(), writes = [], reads = [], uploads = [], videos = [], revoked = [], navigation = [];
  const router = { push: href => navigation.push(href) };
  const params = { get: key => options.params?.[key] ?? null };
  const same = (a,b) => a && b && a.length === b.length && a.every((item,i) => Object.is(item,b[i]));
  const hooks = {
    Suspense: 'Suspense',
    useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i], value => { if (!mounted) updatesAfterUnmount++; const next=typeof value==='function'?value(slots[i]):value; if (!Object.is(next,slots[i])) { slots[i]=next; dirty=true; } }]; },
    useCallback(fn,deps) { const i=cursor++; if (!slots[i] || !same(slots[i].deps,deps)) slots[i]={fn,deps}; return slots[i].fn; },
    useRef(initial) { const i=cursor++; return slots[i]??={current:initial}; },
    useEffect(fn,deps) { const i=cursor++; if (!slots[i] || !same(slots[i].deps,deps)) { const previous=slots[i]; slots[i]={deps}; effects.push(()=>{ previous?.cleanup?.(); slots[i].cleanup=fn(); }); } },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const execute = async call => {
    if (call.op !== 'select') { writes.push(call); return options.write ? options.write(call) : { data: { id: call.payload?.id || 'saved', user_id: call.payload?.user_id }, error: null }; }
    reads.push(call);
    if (call.table === 'story_drafts') return options.loadDrafts ? options.loadDrafts(call.filters.user_id) : { data: [], error: null };
    if (call.table === 'profiles') return options.loadPeople ? options.loadPeople(call) : { data: [{ id:'friend-' + owner, full_name: 'Friend ' + owner }], error: null };
    return { data: [], error: null };
  };
  const client = {
    rpc(name,payload) { const call={table:name,op:'rpc',payload,filters:{}}; writes.push(call); return options.write ? options.write(call) : Promise.resolve({data:'saved',error:null}); },
    auth: {
      getSession: () => options.session ? options.session(owner) : Promise.resolve({ data: { session: owner ? { user: { id: owner } } : null }, error: null }),
      getUser: () => options.user ? options.user() : Promise.resolve({ data: { user: owner ? { id: owner } : null }, error: null }),
      onAuthStateChange: callback => { listener=callback; return { data: { subscription: { unsubscribe() { listener=null; } } } }; },
    },
    from(table) { const call={table,op:'select',filters:{}}; const query={
      select(){return query;}, eq(key,value){call.filters[key]=value;return query;}, in(key,value){call.filters[key]=value;return query;}, neq(){return query;}, order(){return query;},limit(){return query;},single(){return query;},maybeSingle(){return query;},
      upsert(payload){call.op='upsert';call.payload=payload;return query;},insert(payload){call.op='insert';call.payload=payload;return query;},update(payload){call.op='update';call.payload=payload;return query;},delete(){call.op='delete';return query;},
      then(ok,bad){return Promise.resolve().then(()=>execute(call)).then(ok,bad);},
    }; return query; },
    storage: { from() { return {
      upload(path,file) { uploads.push({path,file}); return options.upload ? options.upload(path,file) : Promise.resolve({ error:null }); },
      getPublicUrl: path => ({ data:{ publicUrl:'https://media.test/'+path } }),
    }; } },
  };
  const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  const storage = new Map(options.storage || []);
  const common={sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},console,Promise,Set,Map,Error,crypto:{randomUUID:()=> 'upload-'+(++nextUuid)},
    setTimeout:(callback,ms)=>{const id=++nextTimer;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id),
    URL:class extends URL { static createObjectURL(){return 'blob:preview';} static revokeObjectURL(value){revoked.push(value);} },
    process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://media.test'}},
    document:{createElement:()=>{ const video={removeAttribute(){},load(){this.cleaned=true;},duration:10};videos.push(video);return video;}},
  };
  function load(code) { const module={exports:{}};vm.runInNewContext(code,{...common,module,exports:module.exports,require:name=>{
    if(name==='../../shared/musicAvailability')return options.musicAvailable===false?load(compile('../shared/musicAvailability.ts')):{MUSIC_CATALOG_ENABLED:false, ORIGINAL_AUDIO_ENABLED:true};
    if(name==='../../shared/contentMedia')return load(compile('../shared/contentMedia.ts'));
    if(name==='../../shared/storyColorMatrix')return load(compile('../shared/storyColorMatrix.ts'));
    if(name==='./storyFilterAppearance')return load(compile('../shared/storyFilterAppearance.ts'));
    if(name==='@/lib/storyPostShare')return{loadPostStorySticker:async(_client,id,check)=>{const result=await options.loadPost(id,owner);check();return result;}};
    if(name==='react')return hooks;if(name==='react/jsx-runtime')return runtime;
    if(name==='./memory/useMemoryDialog')return load(compile('components/memory/useMemoryDialog.ts'));
    if(name==='next/navigation')return{useRouter:()=>router,useSearchParams:()=>params};
    if(name==='next/link')return{__esModule:true,default:'Link'};
    if(name==='next/image')return{__esModule:true,default:'img'};
    if(name==='@/lib/supabase/client')return{createClient:()=>client};
    if(name==='@/lib/publication')return load(publication);
    if(name==='@/lib/storyClipQueue')return load(queueSource);
    if(name==='@/lib/storyDrawing')return load(compile('lib/storyDrawing.ts'));
    if(name==='@/lib/stories')return{STORY_FILTERS:[],STORY_FILTER_FAMILIES:[],filterCss:()=>''};
    if(name==='@/lib/contentMedia')return{hydrateStoryDraftMedia:async rows=>options.hydrateDrafts ? options.hydrateDrafts(rows) : rows};
    if(name==='@/lib/media')return{checkUploadableBytes:async()=>null};
    if(name==='@/lib/memoryAlbum')return{searchPeople:async()=>[]};
    return new Proxy({},{get:(_,key)=>String(key)});
  }});return module.exports; }
  const {StoryComposer}=load(source);
  function render(){let count=0;while(dirty){if(++count>30)throw Error('render loop');dirty=false;cursor=0;const wrapper=StoryComposer();tree=wrapper.props.children.type();const pending=effects;effects=[];pending.forEach(fn=>fn());}return tree;}
  render();
  return {
    render,get tree(){return render();},get text(){return text(render());},writes,reads,uploads,videos,revoked,navigation,
    async flush(){for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));if(mounted)render();}},
    changeOwner(next){owner=next;listener?.('SIGNED_IN',next?{user:{id:next}}:null);render();},
    pick(type='image/jpeg'){nodes(render()).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{type,name:type.startsWith('video')?'video.mp4':'photo.jpg'}],value:''}});render();},
    openDraft(name='draft-a'){const button=nodes(render()).find(n=>n.type==='button'&&nodes(n).some(child=>child.type==='img'&&child.props.src==='https://media.test/'+name));assert.ok(button);const result=button.props.onClick();render();return result;},
    sound(){let sound=nodes(render()).find(n=>n.type==='StoryAudioEditor');if(!sound){nodes(render()).find(n=>n.type==='StoryEditor')?.props.onOpenMusic();sound=nodes(render()).find(n=>n.type==='StoryAudioEditor');}return sound;},
    editor(){return nodes(render()).find(n=>n.type==='StoryEditor');},
    pickMany(files){nodes(render()).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files,value:''}});render();},
    input(){return nodes(render()).find(n=>n.type==='textarea'&&n.props.placeholder==='A moment worth sharing…');},
    button(label){if(label==='Share to story')label='Share story';let found=nodes(render()).find(n=>n.type==='button'&&text(n)===label);if(!found&&['Share story','Update draft','Save as draft','Retry safely'].includes(label)){nodes(render()).find(n=>n.type==='StoryEditor')?.props.onNext();found=nodes(render()).find(n=>n.type==='button'&&text(n)===label);}return found;},
    fireTimeout(ms){for(const[id,timer]of [...timers])if(timer.ms===ms){timers.delete(id);timer.callback();}render();},
    unmount(){mounted=false;slots.forEach(slot=>slot?.cleanup?.());},
    get updatesAfterUnmount(){return updatesAfterUnmount;},get timerCount(){return timers.size;},get listener(){return listener;},
  };
}

test('late initial session cannot restore the previous account after an auth event',async()=>{
  const pending=defer();const h=scenario({session:()=>pending.promise});
  h.changeOwner('b');pending.resolve({data:{session:{user:{id:'a'}}},error:null});await h.flush();
  assert.equal(h.reads.filter(r=>r.table==='story_drafts').at(-1).filters.user_id,'b');h.unmount();
});
test('late draft list from account A never becomes visible in account B',async()=>{
  const pending=defer();const h=scenario({loadDrafts:owner=>owner==='a'?pending.promise:{data:[],error:null}});await h.flush();
  h.changeOwner('b');pending.resolve({data:[draft('a')],error:null});await h.flush();
  assert.ok(!nodes(h.tree).some(n=>n.props?.src==='https://media.test/draft-a'));assert.equal(h.input(),undefined);h.unmount();
});
test('recipient hydration cannot repopulate a cleared draft after account change',async()=>{
  const pending=defer();const h=scenario({loadDrafts:owner=>({data:owner==='a'?[draft('a')]:[],error:null}),loadPeople:()=>pending.promise});await h.flush();
  const opening=h.openDraft();h.changeOwner('b');pending.resolve({data:[{id:'friend-a',full_name:'Private A contact'}],error:null});await opening;await h.flush();
  assert.equal(h.input(),undefined);assert.ok(!h.text.includes('Private A contact'));assert.ok(!nodes(h.tree).some(n=>n.props?.src==='https://media.test/draft-a'));h.unmount();
});
test('upload completion from A cannot populate B and cannot release B upload lock',async()=>{
  const a=defer(),b=defer();const h=scenario({upload:path=>path.startsWith('a/')?a.promise:b.promise});await h.flush();
  h.pick();await h.flush();h.changeOwner('b');await h.flush();h.pick();await h.flush();
  a.resolve({error:null});await h.flush();assert.ok(h.text.includes('Uploading'));assert.ok(!nodes(h.tree).some(n=>n.props?.src?.startsWith('https://media.test/a/')));
  b.resolve({error:null});await h.flush();assert.ok(nodes(h.tree).some(n=>n.props?.src==='blob:preview'));h.unmount();
});
test('unmount cancels pending work and prevents late state updates',async()=>{
  const pending=defer();const h=scenario({upload:()=>pending.promise});await h.flush();h.pick();await h.flush();
  h.unmount();pending.resolve({error:null});await h.flush();assert.equal(h.updatesAfterUnmount,0);assert.equal(h.timerCount,0);assert.equal(h.listener,null);
});
test('account change cleans a pending video metadata object immediately',async()=>{
  const h=scenario();await h.flush();h.pick('video/mp4');await h.flush();assert.equal(h.videos.length,1);
  h.changeOwner('b');await h.flush();assert.equal(h.videos[0].cleaned,true);assert.deepEqual(h.revoked,['blob:preview']);assert.ok(!nodes(h.tree).some(n=>n.type==='video'));h.unmount();
});
test('failed or stalled initial session leaves publishing disabled and shows recovery',async()=>{
  const h=scenario({session:()=>new Promise(()=>{})});h.fireTimeout(15000);await h.flush();
  assert.match(h.text,/account could not be loaded/);assert.equal(h.button('Share to story'),undefined);h.unmount();
});
test('a stalled upload releases its button with a recoverable error',async()=>{
  const h=scenario({upload:()=>new Promise(()=>{})});await h.flush();h.pick();await h.flush();h.fireTimeout(120000);await h.flush();
  assert.ok(h.text.includes('request took too long'));assert.ok(!h.text.includes('Uploading'));h.unmount();
});


test('an explicit initial session error is caught and keeps the composer disabled',async()=>{
  const h=scenario({session:async()=>({data:{session:null},error:{message:'session unavailable'}})});await h.flush();
  assert.match(h.text,/account could not be loaded/);assert.equal(h.button('Share to story'),undefined);assert.equal(h.reads.length,0);h.unmount();
});
test('account change during publication authentication prevents the story insert',async()=>{
  const pending=defer();const h=scenario({user:()=>pending.promise});await h.flush();h.pick();await h.flush();
  const publishing=h.button('Share to story').props.onClick();await h.flush();h.changeOwner('b');
  pending.resolve({data:{user:{id:'a'}},error:null});await publishing;await h.flush();
  assert.equal(h.writes.length,0);assert.equal(h.button('Share to story'),undefined);assert.equal(h.navigation.length,0);h.unmount();
});
test('a committed story from A never sends child writes or changes navigation after switching to B',async()=>{
  const pending=defer();const h=scenario({loadDrafts:owner=>({data:owner==='a'?[draft('a')]:[],error:null}),write:()=>pending.promise});await h.flush();await h.openDraft();await h.flush();
  const publishing=h.button('Share to story').props.onClick();await h.flush();assert.equal(h.writes.length,1);assert.equal(h.writes[0].table,'publish_story_v2');
  h.changeOwner('b');pending.resolve({data:{id:'story-a'},error:null});await publishing;await h.flush();
  assert.equal(h.writes.length,1);assert.equal(h.navigation.length,0);assert.equal(h.input(),undefined);h.unmount();
});
test('a stale submit handler captured for A cannot publish from B',async()=>{
  const h=scenario();await h.flush();h.pick();await h.flush();const submit=h.button('Share to story').props.onClick;
  h.changeOwner('b');await submit();await h.flush();assert.equal(h.writes.length,0);h.unmount();
});


test('lost story response retries the same atomic request and never creates a fresh publication key',async()=>{
  let calls=0;
  const h=scenario({write:async()=>++calls===1?{error:{message:'connection closed'}}:{data:'story-confirmed',error:null}});
  await h.flush(); h.pick(); await h.flush();
  await h.button('Share to story').props.onClick(); await h.flush();
  assert.match(h.text,/Retry safely/); assert.equal(h.navigation.length,0);
  await h.button('Retry safely').props.onClick(); await h.flush();
  assert.equal(h.writes.length,2); assert.equal(h.writes[0].payload.p_request_id,h.writes[1].payload.p_request_id);
  assert.deepEqual(h.writes[0].payload.p_story,h.writes[1].payload.p_story);
  assert.deepEqual(h.navigation,[]);
  const picker = nodes(h.tree).find(node => node.type === 'SaveToMemory');
  assert.equal(picker.props.storyId, 'story-confirmed'); assert.equal(picker.props.ownerId, 'a'); assert.equal(picker.props.inline, true);
  assert.ok(nodes(h.tree).some(node => node.type === 'Link' && node.props.href === '/home' && text(node) === 'Done'));
  assert.equal(h.button('Share to story'), undefined); h.unmount();
});
test('saved story draft keeps its filter and stickers in the owner-scoped write',async()=>{
  const row={...draft('a'),filter_id:'warm',stickers_json:[{id:'a',kind:'question',text:'Ask',nx:.5,ny:.4}],media_transform:{scale:1,translateNX:0,translateNY:0,trimStart:2,trimEnd:8}};
  const h=scenario({loadDrafts:()=>({data:[row],error:null})}); await h.flush(); await h.openDraft(); await h.flush();
  await h.button('Update draft').props.onClick(); await h.flush();
  const saved=h.writes.find(w=>w.table==='story_drafts'); assert.equal(saved.payload.filter_id,'warm');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.payload.stickers_json)),row.stickers_json); assert.deepEqual(JSON.parse(JSON.stringify(saved.payload.media_transform)),{...row.media_transform,audioStartSec:0});
  assert.equal(saved.op,'upsert'); assert.equal(saved.payload.user_id,'a'); h.unmount();
});

test('private draft preview capabilities never replace canonical publish or saved references', async()=>{
  const h=scenario({loadDrafts:()=>({data:[draft('a')],error:null}),hydrateDrafts:async rows=>rows.map(row=>({...row,media_url:'https://media.test/signed?token=secret'}))});
  await h.flush();
  const button=nodes(h.tree).find(n=>n.type==='button'&&nodes(n).some(x=>x.props?.src==='https://media.test/signed?token=secret'));
  assert.ok(button);await button.props.onClick();await h.flush();
  await h.button('Update draft').props.onClick();await h.flush();
  const write=h.writes.find(w=>w.table==='story_drafts'&&w.op==='upsert');
  assert.equal(write.payload.media_url,'https://media.test/draft-a');
  assert.ok(!JSON.stringify(write.payload).includes('token='));h.unmount();
});


test('story audio selection and mix reach the atomic publication without preview tokens',async()=>{
 const h=scenario();await h.flush();h.pick();await h.flush();
 h.sound().props.onChange({kind:'sound',soundId:'approved',title:'Recording',durationSec:12});h.render();
 h.sound().props.onMixChange({orig:0,music:60});h.render();
 await h.button('Share to story').props.onClick();await h.flush();
 const sent=h.writes.find(w=>w.table==='publish_story_v2').payload.p_story;
 assert.equal(sent.audio_draft.soundId,'approved');assert.equal(sent.media_transform.mix.orig,0);assert.equal(sent.media_transform.mix.music,60);
 assert.ok(!JSON.stringify(sent).includes('token='));h.unmount();
});
test('pending audio upload locks publication and saved drafts retain canonical audio',async()=>{
 const h=scenario();await h.flush();h.pick();await h.flush();
 h.sound().props.onBusyChange(true);h.render();await h.button('Share to story').props.onClick();await h.flush();assert.equal(h.writes.length,0);
 h.sound().props.onBusyChange(false);h.render();const audio={kind:'voiceover',url:'https://media.test/original.m4a',title:'Original',durationSec:10,rightsAttested:true,addToSounds:true};
 h.sound().props.onChange(audio);h.render();await h.button('Save as draft').props.onClick();await h.flush();
 assert.deepEqual(h.writes.find(w=>w.table==='story_drafts').payload.audio_draft,audio);h.unmount();
});

test('ordered photo/video clips preserve independent edits and one reply setting through atomic publication',async()=>{
 const h=scenario();await h.flush();h.pickMany([{type:'image/jpeg',name:'first.jpg'},{type:'video/mp4',name:'middle.mp4'},{type:'image/jpeg',name:'last.jpg'}]);await h.flush();
 assert.equal(h.videos.length,1);h.videos[0].onloadedmetadata();await h.flush();
 const clips=h.editor().props.clips;assert.equal(clips.length,3);
 h.editor().props.onChange([{id:'first-text',kind:'text',text:'First clip',nx:.5,ny:.5}]);h.render();h.editor().props.onSelectClip(clips[1].id);h.render();h.editor().props.onChange([{id:'second-text',kind:'text',text:'Video clip',nx:.5,ny:.5}]);h.render();
 h.button('Share to story');nodes(h.tree).find(n=>n.props?.['aria-label']==='Allow story replies').props.onChange({target:{checked:false}});h.render();
 await h.button('Share to story').props.onClick();await h.flush();
 const payloads=h.writes.filter(w=>w.table==='publish_story_v2').map(w=>w.payload.p_story);
 assert.deepEqual(payloads.map(p=>p.media_type),['image','video','image']);assert.equal(payloads[0].stickers_json[0].text,'First clip');assert.equal(payloads[1].stickers_json[0].text,'Video clip');assert.equal(payloads[2].stickers_json.length,0);assert.ok(payloads.every(p=>p.allow_replies===false));h.unmount();
});
test('a failed second clip retries its original request without republishing the first clip',async()=>{
 let count=0;const h=scenario({write:async()=>++count===2?{error:{message:'lost response'}}:{data:'story-'+count,error:null}});await h.flush();h.pickMany([{type:'image/jpeg',name:'one.jpg'},{type:'image/jpeg',name:'two.jpg'}]);await h.flush();
 await h.button('Share to story').props.onClick();await h.flush();assert.equal(h.writes.length,2);
 await h.button('Retry safely').props.onClick();await h.flush();assert.equal(h.writes.length,3);assert.equal(h.writes[1].payload.p_request_id,h.writes[2].payload.p_request_id);assert.notEqual(h.writes[0].payload.p_request_id,h.writes[2].payload.p_request_id);
 const keep=nodes(h.tree).filter(n=>n.type==='SaveToMemory');assert.equal(keep.length,2);assert.equal(keep[0].props.storyId,'story-1');h.unmount();
});
test('partial draft saving retains clips and retry upserts the same draft IDs',async()=>{
 let count=0;const h=scenario({write:async call=>++count===2?{error:{message:'draft connection lost'}}:{data:{id:call.payload.id,user_id:call.payload.user_id},error:null}});await h.flush();h.pickMany([{type:'image/jpeg',name:'one.jpg'},{type:'image/jpeg',name:'two.jpg'}]);await h.flush();
 await h.button('Save as draft').props.onClick();await h.flush();assert.equal(h.editor().props.clips.length,2);assert.match(h.text,/clips remain open/);
 await h.button('Update draft').props.onClick();await h.flush();assert.equal(h.writes.length,4);assert.equal(h.writes[0].payload.id,h.writes[2].payload.id);assert.equal(h.writes[1].payload.id,h.writes[3].payload.id);h.unmount();
});

test('drawing applies only to its original clip and preserves other sticker metadata',async()=>{
 const h=scenario();await h.flush();h.pickMany([{type:'image/jpeg',name:'one.jpg'},{type:'image/jpeg',name:'two.jpg'}]);await h.flush();let editor=h.editor();assert.equal(editor.props.clips.length,2);const firstId=editor.props.clips.find(c=>c.selected).id;
 const textSticker={id:'text',kind:'text',text:'Keep this',color:'#FFFFFF',nx:.5,ny:.5,scale:1,rotation:0};editor.props.onChange([textSticker]);h.render();h.editor().props.onOpenDraw();h.render();const draw=nodes(h.tree).find(n=>n.type==='StoryDrawStudio');assert.ok(draw);const stroke={tool:'pen',color:'#FF3B30',width:8,points:[{x:.25,y:.4},{x:.75,y:.6}]};draw.props.onApply([stroke]);h.render();assert.equal(h.editor().props.value.find(s=>s.kind==='drawing').strokes[0].points[0].x,.25);assert.equal(h.editor().props.value.find(s=>s.id==='text').text,'Keep this');
 h.editor().props.onOpenDraw();h.render();const stale=nodes(h.tree).find(n=>n.type==='StoryDrawStudio');const other=h.editor().props.clips.find(c=>c.id!==firstId);h.editor().props.onSelectClip(other.id);h.render();assert.equal(nodes(h.tree).some(n=>n.type==='StoryDrawStudio'),false);stale.props.onApply([stroke]);h.render();assert.equal(h.editor().props.value.some(s=>s.kind==='drawing'),false);h.editor().props.onSelectClip(firstId);h.render();assert.equal(h.editor().props.value.find(s=>s.kind==='drawing').strokes.length,1);h.unmount();
});
test('drawing cancel and stale account callbacks cannot change the active story',async()=>{
 const h=scenario();await h.flush();h.pick();await h.flush();h.editor().props.onOpenDraw();h.render();let draw=nodes(h.tree).find(n=>n.type==='StoryDrawStudio');draw.props.onCancel();h.render();assert.equal(h.editor().props.value.length,0);h.editor().props.onOpenDraw();h.render();draw=nodes(h.tree).find(n=>n.type==='StoryDrawStudio');h.changeOwner('b');await h.flush();h.pick();await h.flush();draw.props.onApply([{tool:'pen',color:'#FFFFFF',width:8,points:[{x:.2,y:.3}]}]);h.render();assert.equal(h.editor().props.value.length,0);assert.equal(nodes(h.tree).some(n=>n.type==='StoryDrawStudio'),false);h.unmount();
});

function loadAvailability(){const module={exports:{}};vm.runInNewContext(compile('../shared/musicAvailability.ts'),{module,exports:module.exports});return module.exports;}

test('commercial catalogue stays disabled while original audio and source-video mix persist through draft and publication',async()=>{
 const oldAudio={kind:'sound',soundId:'old-sound',title:'Old recording',durationSec:12};
 for(const action of ['Update draft','Share story']){
  const d={...draft('a'),audio_draft:oldAudio,media_transform:{scale:1,translateNX:0,translateNY:0,fit:'contain',mix:{orig:47,music:80},trimStart:2,trimEnd:8}};
  const h=scenario({musicAvailable:false,loadDrafts:()=>({data:[d],error:null})});await h.flush();await h.openDraft();await h.flush();
  assert.equal(typeof h.editor().props.onOpenMusic,'function');
  const availabilityModule=loadAvailability();assert.equal(availabilityModule.MUSIC_CATALOG_ENABLED,false);assert.equal(availabilityModule.ORIGINAL_AUDIO_ENABLED,true);
  await h.button(action).props.onClick();await h.flush();
  const written=h.writes.find(w=>w.table===(action==='Update draft'?'story_drafts':'publish_story_v2'));
  const payload=action==='Update draft'?written.payload:written.payload.p_story;
  assert.equal(payload.media_transform.mix.orig,47);assert.equal(payload.media_transform.trimStart,2);
  assert.equal(payload.audio_draft.soundId,oldAudio.soundId);assert.equal(payload.media_transform.mix.music,80);assert.equal(payload.media_transform.audioStartSec,0);assert.ok(!JSON.stringify(payload).includes('token='));
  h.unmount();
 }
});

const sharedPostFixture = token => ({
 id:'post-11111111-1111-4111-8111-111111111111',kind:'post',postId:'11111111-1111-4111-8111-111111111111',
 text:'',style:'classic',color:'#FFFFFF',nx:.5,ny:.5,scale:1,rotation:0,
 postAuthorName:'Public author',postUsername:'public',postText:'A public moment',postMediaType:'image',
 postMediaUrl:'https://media.test/storage/v1/object/sign/post-media/public/photo.jpg?token='+token,
});
test('feed post route opens the editable card and publishes canonical references without extra text',async()=>{
 const sticker=sharedPostFixture('preview-only');
 const h=scenario({params:{post:sticker.postId},loadPost:async()=>sticker,musicAvailable:false});await h.flush();
 assert.equal(h.editor().props.value[0].postMediaUrl,sticker.postMediaUrl);
 assert.ok(nodes(h.tree).some(n=>n.type==='img'&&n.props.src===sticker.postMediaUrl&&n.props.className.includes('blur')));
 await h.button('Share story').props.onClick();await h.flush();
 const payload=h.writes.find(w=>w.table==='publish_story_v2')?.payload.p_story;
 assert.ok(payload);assert.equal(payload.media_type,'text');assert.equal(payload.stickers_json[0].postId,sticker.postId);
 assert.equal(payload.stickers_json[0].postMediaUrl,'https://media.test/storage/v1/object/public/post-media/public/photo.jpg');
 assert.ok(!JSON.stringify(payload).includes('preview-only'));h.unmount();
});
test('post preview from an old account cannot populate or unlock the next account',async()=>{
 const a=defer(),b=defer();const h=scenario({params:{post:sharedPostFixture('').postId},loadPost:(_id,owner)=>owner==='a'?a.promise:b.promise});
 await h.flush();h.changeOwner('b');await h.flush();a.resolve(sharedPostFixture('a'));await h.flush();
 assert.equal(h.editor(),undefined);assert.match(h.text,/Preparing this post/);
 b.resolve(sharedPostFixture('b'));await h.flush();assert.equal(h.editor().props.value[0].postMediaUrl,sharedPostFixture('b').postMediaUrl);h.unmount();
});
test('a failed post preview exposes retry and successful retry opens the same source once',async()=>{
 let tries=0;const sticker=sharedPostFixture('safe');const h=scenario({params:{post:sticker.postId},loadPost:async()=>{if(++tries===1)throw Error('Preview connection failed');return sticker;}});
 await h.flush();assert.equal(h.editor(),undefined);assert.match(h.text,/Preview connection failed/);
 h.button('Retry loading post').props.onClick();await h.flush();assert.equal(tries,2);assert.equal(h.editor().props.value.length,1);h.unmount();
});
test('saved shared-post drafts display signed media and save only canonical media',async()=>{
 const preview=sharedPostFixture('draft-preview');const canonical={...preview,postMediaUrl:'https://media.test/storage/v1/object/public/post-media/public/photo.jpg'};
 const row={...draft('a'),stickers_json:[canonical]};
 const h=scenario({loadDrafts:async()=>({data:[row],error:null}),hydrateDrafts:async rows=>rows.map(r=>({...r,stickers_json:[preview]}))});await h.flush();await h.openDraft();await h.flush();
 assert.equal(h.editor().props.value[0].postMediaUrl,preview.postMediaUrl);
 await h.button('Update draft').props.onClick();await h.flush();
 assert.equal(h.writes.find(w=>w.table==='story_drafts').payload.stickers_json[0].postMediaUrl,canonical.postMediaUrl);h.unmount();
});


test('pending story restoration keeps editing disabled until account and media verification finish', async()=>{
 const session=defer(),preview=defer();let sessions=0;
 const queue={version:1,editable:true,clips:[{clipId:'recovered',requestId:'original-request',payload:{media_type:'image',media_url:'https://media.test/canonical',caption:'Recovered caption',audience:'everyone'}}]};
 const h=scenario({storage:[['platinum:story-batch:a',JSON.stringify(queue)]],session:()=>++sessions===1?Promise.resolve({data:{session:{user:{id:'a'}}},error:null}):session.promise,hydrateDrafts:rows=>rows.length?preview.promise:Promise.resolve([])});
 await h.flush();assert.equal(nodes(h.tree).find(n=>n.type==='fieldset').props.disabled,true);assert.match(h.text,/Checking for your pending story/);
 session.resolve({data:{session:{user:{id:'a'}}},error:null});await h.flush();assert.equal(nodes(h.tree).find(n=>n.type==='fieldset').props.disabled,true);
 preview.resolve([{media_url:'https://media.test/signed?token=temporary'}]);await h.flush();assert.equal(nodes(h.tree).find(n=>n.type==='fieldset').props.disabled,false);
 assert.ok(nodes(h.tree).some(n=>n.type==='img'&&n.props.src==='https://media.test/signed?token=temporary'));h.unmount();
});

test('an old pending preview cannot replace the next account story after its restoration completes',async()=>{
 const preview=defer();
 const queue={version:1,editable:true,clips:[{clipId:'recovered',requestId:'original-request',payload:{media_type:'image',media_url:'https://media.test/private-a'}}]};
 const h=scenario({storage:[['platinum:story-batch:a',JSON.stringify(queue)]],hydrateDrafts:rows=>rows.length?preview.promise:Promise.resolve([])});
 await h.flush();h.changeOwner('b');await h.flush();h.pick();await h.flush();
 preview.resolve([{media_url:'https://media.test/signed-a?token=private'}]);await h.flush();
 assert.ok(!nodes(h.tree).some(n=>n.props?.src?.includes('signed-a')));assert.ok(nodes(h.tree).some(n=>n.type==='img'&&n.props.src==='blob:preview'));h.unmount();
});
