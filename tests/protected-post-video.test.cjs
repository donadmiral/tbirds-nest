const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),ts=require('typescript');
function js(file,deps={}){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:n=>deps[n],URL,AbortController,setTimeout,clearTimeout});return m.exports;}
const media=js('shared/mediaDelivery.ts'),{protectedPostVideo:derive}=media,base='https://fixture.supabase.co',token='a'.repeat(64),uri=media.mediaDeliveryUrl(base,'post-media','owner/original clip.mp4',token),marked={generatedPosterV1:true};
test('only the canonical marked origin/path/token derives two display-only siblings',()=>{
 const got=derive(uri,marked,base);assert.equal(got.poster,uri+'&representation=poster');assert.equal(got.compatible,uri+'&representation=compatible');assert.equal(media.privateImageCachePolicy(got.poster),'none');assert.equal(media.privateImageCachePolicy(got.compatible),'none');assert.equal(derive(got.compatible,marked,base),null);
 for(const edit of [undefined,null,{},false,{generatedPosterV1:'true'},{generatedPosterV1:1},Object.create(marked)])assert.equal(derive(uri,edit,base),null);
 for(const value of [null,uri.replace('https:','http:'),uri.replace('fixture.supabase.co','other.invalid'),uri.replace('://','://user@'),uri.replace('/post-media/','/story-media/'),uri.replace('/functions/v1/media-content/','/storage/v1/object/public/'),uri.split('?')[0],uri+'#',uri+'#x',uri+'&stream=hls',uri+'&token='+token,uri.replace('token=','token%3D'),uri.replace('/owner/','/x/../owner/'),uri.replace('/owner/','/x/%2e%2e/owner/'),uri.replace('owner/','owner%2F'),uri+' ',uri.replace(token,token.toUpperCase())])assert.equal(derive(value,marked,base),null,String(value).slice(0,45));
});
test('compatible representation has its own frame cache identity and never probes original HLS',()=>{
 const {frameKey}=js('web/lib/videoFrameCache.ts',{'../../shared/contentMedia':{contentObject:()=>null},'../../shared/mediaDelivery':media}),{adaptiveProbeUrl}=js('shared/adaptiveMedia.ts');const d=derive(uri,marked,base);
 assert.notEqual(frameKey(d.compatible,base),frameKey(uri,base));assert.equal(frameKey(d.compatible,base),frameKey(derive(uri.replace(token,'b'.repeat(64)),marked,base).compatible,base));assert.equal(adaptiveProbeUrl(d.compatible),null);assert.ok(adaptiveProbeUrl(uri));
});
test('native surface refuses to carry a marked grant across an account switch and accepts a newly issued grant',()=>{
 let ref,scope='a:session1';const react={useRef(v){return ref??={current:v}},useSyncExternalStore:(_s,read)=>read()};
 const binding=js('shared/useBoundVideoGrant.ts',{'react':react});const {usePostVideoRepresentation:screen}=js('src/lib/usePostVideoRepresentation.ts',{'react':react,'./navigationCache':{navigationScope:()=>scope,subscribeNavigationScope:()=>()=>{}},'../services/supabase':{SUPABASE_URL:base},'../../shared/mediaDelivery':media,'../../shared/useBoundVideoGrant':binding});
 const initial=screen(uri,marked);assert.equal(initial.poster,derive(uri,marked,base).poster);assert.equal(initial.source,derive(uri,marked,base).compatible);
 scope='b:session2';const denied=screen(uri,marked);assert.equal(denied.available,false);assert.equal(denied.source,'');assert.equal(denied.poster,null);assert.equal(denied.original,null);
 const fresh=uri.replace(token,'c'.repeat(64));assert.equal(screen(fresh,marked).original,fresh);const ordinary=screen(fresh,{});assert.equal(ordinary.source,fresh);assert.equal(ordinary.poster,null);
});
