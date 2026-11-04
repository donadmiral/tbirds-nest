const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {test}=require('node:test');
const modulePromise=import('../../tools/reuse-live-connected-evidence.mjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function repository(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'connected-reuse-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();git(['init','-q']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','Fixture']);const write=(file,value)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),value);};write('runtime.txt','unchanged');git(['add','.']);git(['commit','-qm','base']);return{git,write,base:git(['rev-parse','HEAD']),commit(){git(['add','.']);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']);}};}

test('real Git trees permit only the immediate fixture correction and preserve every other path',async t=>{const m=await modulePromise,r=repository(t);for(const file of m.ALLOWED)r.write(file,'fixture');const head=r.commit();assert.equal(m.sourceEquivalent(r.git,head,r.base),true);r.write('runtime.txt','changed');const runtime=r.commit();assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'?r.base:r.git(args),runtime,r.base));assert.equal(m.sourceEquivalent(r.git,runtime,r.base),false,'later releases use normal provider acceptance');});
test('uncommitted and staged runtime edits cannot reuse a committed fixture-only tree',async t=>{const m=await modulePromise,r=repository(t);for(const file of m.ALLOWED)r.write(file,'fixture');const head=r.commit();r.write('runtime.txt','uncommitted');assert.throws(()=>m.sourceEquivalent(r.git,head,r.base));r.git(['add','runtime.txt']);assert.throws(()=>m.sourceEquivalent(r.git,head,r.base));});
test('missing allowed changes, merge parents and checkout mismatch reject reuse',async t=>{const m=await modulePromise,r=repository(t);r.write(m.ALLOWED[0],'only one');const head=r.commit();assert.throws(()=>m.sourceEquivalent(r.git,head,r.base));assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'?`${r.base} ${'b'.repeat(40)}`:r.git(args),head,r.base));assert.throws(()=>m.sourceEquivalent(r.git,'f'.repeat(40),r.base));});

function nativeRepository(t, m) {
  const r=repository(t);
  for(const file of [...m.NATIVE_CORRECTION.files,...m.KEYBOARD_CORRECTION.files]) if(!m.ALLOWED.includes(file.path)) r.write(file.path,'original native bytes\n');
  r.write('web/runtime.ts','original connected runtime\n');
  r.write('scripts/quality/install-browser-test-runtime.sh','original browser preparation\n');
  const accepted=r.commit();
  for(const file of m.ALLOWED) r.write(file,'reviewed fixture correction\n');
  const parent=r.commit(),parentTree=r.git(['rev-parse',parent+'^{tree}']);
  const files=m.NATIVE_CORRECTION.files.map(file=>{
    const bytes='reviewed correction '+file.path+'\n';r.write(file.path,bytes);
    return {...file,sha256:sha(Buffer.from(bytes))};
  });
  for(const file of m.VERIFIER_FILES) r.write(file,'reviewed verifier\n');
  const head=r.commit();
  const dir=r.git(['rev-parse','--show-toplevel']);
  const git=args=>args[0]==='show'&&args.at(-1).includes(':')
    ?execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','ignore']}):r.git(args);
  return {...r,git,accepted,parent,head,rule:{parent,parentTree,files},
    amend(){r.git(['add','.']);r.git(['commit','--amend','--no-edit','-q']);return r.git(['rev-parse','HEAD']);},
    fullPath(file){return path.join(r.git(['rev-parse','--show-toplevel']),file);},
  };
}
test('the exact native child preserves connected source while requiring fresh native acceptance',async t=>{
  const m=await modulePromise,r=nativeRepository(t,m);
  const scope=m.sourceApplicability(r.git,r.head,r.accepted,r.rule);
  assert.equal(scope.kind,'native-clips-correction');assert.equal(scope.comparisonParent,r.parent);
  assert.equal(scope.comparisonParentTree,r.rule.parentTree);
  assert.equal(scope.connectedRuntimeEquivalent,true);assert.equal(scope.nativeRuntimeEquivalent,false);
  assert.equal(Object.hasOwn(scope,'runtimeEquivalent'),false,'Do not claim whole-app equivalence');
  assert.deepEqual(scope.verifiedFiles,r.rule.files);
  assert.deepEqual(scope.permittedChanges,[...r.rule.files.map(file=>file.path),...m.VERIFIER_FILES].sort());
  assert.equal(m.sourceEquivalent(r.git,r.head,r.accepted,r.rule),true);
});
test('every frozen native, fixture, flow, acknowledgement and workflow hash is enforced',async t=>{
  const m=await modulePromise;
  for(const file of m.NATIVE_CORRECTION.files){
    const r=nativeRepository(t,m);r.write(file.path,'unreviewed replacement\n');const changed=r.amend();
    assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,r.rule),/Reviewed correction bytes changed/);
  }
});
test('executable or symlink mode changes cannot enter either reviewed native or verifier files',async t=>{
  const m=await modulePromise;
  for(const file of [m.NATIVE_CORRECTION.files[0].path,m.VERIFIER_FILES[0]]){
    const r=nativeRepository(t,m);fs.chmodSync(r.fullPath(file),0o755);const changed=r.amend();
    assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,r.rule),/Reviewed file mode changed/);
  }
  const r=nativeRepository(t,m),file=m.NATIVE_CORRECTION.files[0].path;
  fs.unlinkSync(r.fullPath(file));fs.symlinkSync('runtime.txt',r.fullPath(file));const changed=r.amend();
  assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,r.rule),/change file type/);
});
test('missing, additional, deleted or renamed native-child changes fail closed',async t=>{
  const m=await modulePromise;
  for(const kind of ['missing','additional','deleted','renamed']){
    const r=nativeRepository(t,m),file=m.NATIVE_CORRECTION.files[0].path;
    if(kind==='missing')r.write(file,r.git(['show',r.parent+':'+file]));
    if(kind==='additional')r.write('src/unreviewed.ts','extra native change');
    if(kind==='deleted')fs.unlinkSync(r.fullPath(file));
    if(kind==='renamed')fs.renameSync(r.fullPath(file),r.fullPath(file)+'.moved');
    const changed=r.amend();
    assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,r.rule),/unreviewed or missing change|cannot add, delete, rename/);
  }
});
test('connected runtime drift is rejected even if incorrectly added to a proposed frozen list',async t=>{
  const m=await modulePromise,r=nativeRepository(t,m),file='web/runtime.ts',bytes='changed connected runtime\n';
  r.write(file,bytes);const changed=r.amend();
  assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,r.rule),/unreviewed or missing change/);
  const broadened={...r.rule,files:[...r.rule.files,{path:file,mode:'100644',sha256:sha(Buffer.from(bytes))}]};
  assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,broadened),/Connected runtime or preparation changed/);
});
test('native reuse rejects the wrong parent tree, ancestry, merge order and checkout',async t=>{
  const m=await modulePromise,r=nativeRepository(t,m);
  assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,{...r.rule,parentTree:'f'.repeat(40)}),/parent tree changed/);
  assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'&&args.at(-1)===r.parent?'e'.repeat(40):r.git(args),r.head,r.accepted,r.rule),/parent ancestry changed/);
  for(const parents of [[r.parent,'e'.repeat(40)],['e'.repeat(40),r.parent]]){
    assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'&&args.at(-1)==='HEAD'?parents.join(' '):r.git(args),r.head,r.accepted,r.rule),/single-parent correction/);
  }
  assert.throws(()=>m.sourceEquivalent(r.git,'f'.repeat(40),r.accepted,r.rule),/Checkout differs/);
});
test('uncommitted and staged native-child changes reject reuse before any evidence access',async t=>{
  const m=await modulePromise,r=nativeRepository(t,m),file=m.NATIVE_CORRECTION.files[0].path;
  r.write(file,'dirty native code');
  assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule),/Tracked checkout or index differs/);
  r.git(['add',file]);
  assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule),/Tracked checkout or index differs/);
});
test('a native-child mismatch rejects the reuse operation without fetching or emitting a provider fallback',async t=>{
  const m=await modulePromise,r=nativeRepository(t,m);let fetches=0;
  const git=args=>{
    if(args[0]==='show'&&args.at(-1)==='HEAD')return m.NATIVE_CORRECTION.parent;
    if(args[0]==='show'&&args.at(-1)===m.NATIVE_CORRECTION.parent)return m.PINNED.source;
    if(args[0]==='rev-parse'&&args[1]===m.NATIVE_CORRECTION.parent+'^{tree}')return m.NATIVE_CORRECTION.parentTree;
    return r.git(args.map(arg=>arg===m.PINNED.source?r.accepted:arg===m.NATIVE_CORRECTION.parent?r.parent:arg));
  };
  const evidence=r.fullPath('evidence-not-created');
  await assert.rejects(m.reuseConnected({git,fetcher:async()=>{fetches++;throw Error('No fetch expected');},
    env:{GITHUB_REPOSITORY:m.PINNED.repository,GITHUB_SHA:r.head,GITHUB_TOKEN:'synthetic',LIVE_CONNECTED_EVIDENCE:evidence},
  }),/Reviewed correction bytes changed/);
  assert.equal(fetches,0);assert.equal(fs.existsSync(evidence),false);
});
function metadata(){const pinned={repository:'donadmiral/tbirds-nest',source:'a'.repeat(40),runId:10,jobId:20,artifactId:30,archiveSha256:'b'.repeat(64)};return{pinned,run:{id:10,head_sha:pinned.source,path:'.github/workflows/live-release-acceptance.yml',event:'push',head_repository:{full_name:pinned.repository}},job:{id:20,run_id:10,name:'connected-host-viewer',status:'completed',conclusion:'success'},artifact:{id:30,name:'live-connected-acceptance',expired:false,workflow_run:{id:10,head_sha:pinned.source},digest:'sha256:'+pinned.archiveSha256,size_in_bytes:100}};}
test('successful job and artifact identities are all bound to the approved source',async()=>{const m=await modulePromise,v=metadata();m.verifyMetadata(v.run,v.job,v.artifact,v.pinned);for(const mutate of [v=>v.run.head_sha='c'.repeat(40),v=>v.run.event='pull_request',v=>v.run.head_repository.full_name='other/repo',v=>v.job.id++,v=>v.job.conclusion='failure',v=>v.job.status='in_progress',v=>v.artifact.expired=true,v=>v.artifact.workflow_run.id++,v=>v.artifact.workflow_run.head_sha='c'.repeat(40),v=>v.artifact.digest='sha256:'+'c'.repeat(64),v=>v.artifact.size_in_bytes=65*1024*1024]){const changed=metadata();mutate(changed);assert.throws(()=>m.verifyMetadata(changed.run,changed.job,changed.artifact,changed.pinned));}});
function receipt(){return{source:'a'.repeat(40),failure:null,errors:[],cleanup:{ok:true,cleaned_users:3},checks:[
'Guest request, cancellation, renewed request and host approval reached separate browsers without refreshing or starting a camera',
'Joining the approved guest automatically published the host and guest interview scene without manual camera selection',
'Real encoder completed the recorded clip and approved private output assets',
'Feed post references authorized clip media and delivers real MP4 bytes to the follower',...Array.from({length:33},(_,i)=>'other '+i)],players:[1,2].map(stream=>({observation:'decoded-portrait-hls',stream,width:1080,height:1920,readyState:4,currentTime:3})),controls:[{automatic:true,status:200,ok:true}],clipId:'11111111-1111-4111-8111-111111111111',postId:'22222222-2222-4222-8222-222222222222'};}
test('receipt requires real portrait, guest publication, clip output and successful cleanup',async()=>{const m=await modulePromise;m.verifyReceipt(receipt(),metadata().pinned);for(const mutate of [r=>r.source='c'.repeat(40),r=>r.failure='failed',r=>r.errors.push('failure'),r=>r.cleanup.cleaned_users=2,r=>r.checks.shift(),r=>r.players[0].height=720,r=>r.players.pop(),r=>r.controls[0].ok=false,r=>r.clipId=null]){const r=receipt();mutate(r);assert.throws(()=>m.verifyReceipt(r,metadata().pinned));}});
function archive(names){return execFileSync('python3',['-c','import io,json,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for name,value in json.loads(sys.stdin.read()):z.writestr(name,value)\nsys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify(names),maxBuffer:5*1024*1024,stdio:['pipe','pipe','ignore']});}
test('the downloaded ZIP digest, unique receipt and decompressed receipt size are enforced',async()=>{const m=await modulePromise,bytes=archive([['receipt.json',JSON.stringify(receipt())]]);assert.deepEqual(m.archiveReceipt(bytes,sha(bytes)),receipt());assert.throws(()=>m.archiveReceipt(bytes,'f'.repeat(64)));for(const names of [[['other.json','{}']],[['receipt.json','{}'],['receipt.json','{}']],[['receipt.json',' '.repeat(2*1024*1024+1)]]]){const bytes=archive(names);assert.throws(()=>m.archiveReceipt(bytes,sha(bytes)));}});
test('original receipt bytes and source identity survive reuse without reserialization',async()=>{
  const m=await modulePromise,original='  '+JSON.stringify(receipt(),null,3)+'\n\n';
  const bytes=archive([['receipt.json',original]]),read=m.archiveReceipt(bytes,sha(bytes),true);
  assert.deepEqual(read.receipt,receipt());assert.equal(read.receipt.source,metadata().pinned.source);
  assert.equal(read.receiptBytes.equals(Buffer.from(original)),true);
  assert.equal(read.receiptSha256,sha(Buffer.from(original)));
});
test('artifact storage never receives the GitHub token and downloads stay bounded',async()=>{const m=await modulePromise,calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(null,{status:302,headers:{location:'https://storage.example.invalid/artifact?signature=fixture'}}):new Response('zip');};const bytes=await m.fetchArchive(fetcher,'https://api.github.com/repos/donadmiral/tbirds-nest',{Authorization:'Bearer synthetic'},30);assert.equal(bytes.toString(),'zip');assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic');assert.equal(calls[1].options.headers,undefined);assert.equal(calls[1].options.redirect,'error');await assert.rejects(m.boundedBody(new Response('12345'),4));await assert.rejects(m.fetchArchive(async()=>new Response(null,{status:302,headers:{location:'http://unsafe.invalid/a'}}),'https://api.github.com',{},30));});
test('workflow retains every gate and reads seven commits before authorizing any provider activity',async()=>{const m=await modulePromise,workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/live-release-acceptance.yml'),'utf8');const block=workflow.slice(workflow.indexOf('  connected-host-viewer:'),workflow.indexOf('  release-checks:'));assert.match(block,/actions: read/);assert.match(block,/fetch-depth: 7/);assert.equal((block.match(/if: steps.connected_evidence.outputs.reused != 'true'/g)||[]).length,3);assert.ok(block.indexOf('node tools/reuse-live-connected-evidence.mjs')<block.indexOf('npm ci --prefix web'));assert.doesNotMatch(block,/continue-on-error/);assert.match(workflow,/needs: \[release-checks, browser-baseline, connected-host-viewer, web-production-build\]/);assert.equal(sha(Buffer.from(workflow)),m.AUTOFILL_BUDGET_CORRECTION.files.find(file=>file.path==='.github/workflows/live-release-acceptance.yml').sha256,'The workflow is hash-bound, with all fresh gates and native regressions preserved');});
function feedRepository(t,m){
 const r=nativeRepository(t,m), parent=r.head, parentTree=r.git(['rev-parse',parent+'^{tree}']);
 const files=m.FEED_CORRECTION.files.map(file=>{const bytes='reviewed feed '+file.path+'\n';r.write(file.path,bytes);return {...file,sha256:sha(Buffer.from(bytes))};});
 for(const file of m.VERIFIER_FILES)r.write(file,'reviewed feed verifier\n');
 const head=r.commit();return {...r,head,feedRule:{parent,parentTree,files}};
}
test('exact feed child reuses only connected runtime evidence and requires new native validation',async t=>{
 const m=await modulePromise,r=feedRepository(t,m),scope=m.sourceApplicability(r.git,r.head,r.accepted,r.rule,r.feedRule);
 assert.equal(scope.kind,'native-feed-refresh-correction');assert.equal(scope.connectedRuntimeEquivalent,true);assert.equal(scope.nativeRuntimeEquivalent,false);assert.equal(scope.nativeFeedRequiresSeparateValidation,true);assert.deepEqual(scope.verifiedFiles,r.feedRule.files);
});
test('every allowed feed/setup byte is frozen and extra provider or web edits fail closed',async t=>{
 const m=await modulePromise;
 for(const file of m.FEED_CORRECTION.files){const r=feedRepository(t,m);r.write(file.path,'unreviewed');const head=r.amend();assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule),/Reviewed feed correction bytes changed/);}
 for(const file of ['web/runtime.ts','supabase/functions/live-core/provider.ts','shared/liveStageScene.ts']){const r=feedRepository(t,m),bytes='unreviewed';r.write(file,bytes);const head=r.amend();assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule),/unreviewed or missing change/);const broad={...r.feedRule,files:[...r.feedRule.files,{path:file,mode:'100644',sha256:sha(Buffer.from(bytes))}]};assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,broad),/Connected runtime or browser preparation changed/);}
});
test('feed exception rejects dirty source, changed parent tree, merge parents and later releases',async t=>{
 const m=await modulePromise,r=feedRepository(t,m);assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,{...r.feedRule,parentTree:'f'.repeat(40)}),/parent tree changed/);
 assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'&&args.at(-1)==='HEAD'?r.feedRule.parent+' '+'f'.repeat(40):r.git(args),r.head,r.accepted,r.rule,r.feedRule),/single-parent/);
 r.write('runtime.txt','dirty');assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule),/Tracked checkout/);const later=r.commit();assert.equal(m.sourceEquivalent(r.git,later,r.accepted,r.rule,r.feedRule),false);
});
function keyboardRepository(t,m){
 const r=feedRepository(t,m),parent=r.head,parentTree=r.git(['rev-parse',parent+'^{tree}']);
 const files=m.KEYBOARD_CORRECTION.files.map(file=>{const bytes='reviewed keyboard '+file.path+'\n';r.write(file.path,bytes);return {...file,sha256:sha(Buffer.from(bytes))};});
 for(const file of m.VERIFIER_FILES)r.write(file,'reviewed keyboard verifier\n');
 const head=r.commit();return {...r,head,keyboardRule:{parent,parentTree,files}};
}
test('the exact keyboard child preserves connected evidence and requires fresh keyboard and feed validation',async t=>{
 const m=await modulePromise,r=keyboardRepository(t,m);
 const scope=m.sourceApplicability(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule);
 assert.equal(scope.kind,'native-live-keyboard-correction');assert.equal(scope.comparisonParent,r.keyboardRule.parent);
 assert.equal(scope.comparisonParentTree,r.keyboardRule.parentTree);assert.equal(scope.connectedRuntimeEquivalent,true);
 assert.equal(scope.nativeRuntimeEquivalent,false);assert.equal(scope.nativeFeedRequiresSeparateValidation,true);
 assert.equal(scope.nativeKeyboardRequiresSeparateValidation,true);assert.equal(Object.hasOwn(scope,'runtimeEquivalent'),false);
 assert.deepEqual(scope.verifiedFiles,r.keyboardRule.files);
 assert.deepEqual(scope.permittedChanges,[...r.keyboardRule.files.map(file=>file.path),...m.VERIFIER_FILES].sort());
 for(const file of m.KEYBOARD_CORRECTION.files){assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.equal(file.mode,'100644');}
});
test('every reviewed keyboard component, login flow, test and workflow byte is enforced',async t=>{
 const m=await modulePromise;
 for(const file of m.KEYBOARD_CORRECTION.files){const r=keyboardRepository(t,m);r.write(file.path,'unreviewed keyboard replacement\n');const head=r.amend();assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule),/Reviewed keyboard correction bytes changed/);}
});
test('keyboard reuse rejects extra connected and browser preparation edits even in a broadened hash list',async t=>{
 const m=await modulePromise;
 for(const file of ['web/runtime.ts','scripts/quality/install-browser-test-runtime.sh']){
  const r=keyboardRepository(t,m),bytes='unreviewed connected change\n';r.write(file,bytes);const head=r.amend();
  assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule),/unreviewed or missing change/);
  const broad={...r.keyboardRule,files:[...r.keyboardRule.files,{path:file,mode:'100644',sha256:sha(Buffer.from(bytes))}]};
  assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,broad),/Connected runtime or browser preparation changed/);
 }
});
test('keyboard reuse rejects missing paths, file type changes and executable verifier modes',async t=>{
 const m=await modulePromise;
 for(const kind of ['missing','additional','deleted','renamed','symlink','executable']){
  const r=keyboardRepository(t,m),file=m.KEYBOARD_CORRECTION.files[0].path;
  if(kind==='missing')r.write(file,r.git(['show',r.keyboardRule.parent+':'+file]));
  if(kind==='additional')r.write('src/unreviewed.ts','extra native change');
  if(kind==='deleted')fs.unlinkSync(r.fullPath(file));
  if(kind==='renamed')fs.renameSync(r.fullPath(file),r.fullPath(file)+'.moved');
  if(kind==='symlink'){fs.unlinkSync(r.fullPath(file));fs.symlinkSync('runtime.txt',r.fullPath(file));}
  if(kind==='executable')fs.chmodSync(r.fullPath(m.VERIFIER_FILES[0]),0o755);
  const head=r.amend();assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule),/unreviewed or missing change|change file type|Reviewed file mode changed/);
 }
});
test('keyboard reuse binds the parent tree, ancestry, single-parent commit and clean checkout',async t=>{
 const m=await modulePromise,r=keyboardRepository(t,m),rule=r.keyboardRule;
 assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,{...rule,parentTree:'f'.repeat(40)}),/parent tree changed/);
 assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'&&args.at(-1)===rule.parent?'e'.repeat(40):r.git(args),r.head,r.accepted,r.rule,r.feedRule,rule),/parent ancestry changed/);
 for(const parents of [[rule.parent,'e'.repeat(40)],['e'.repeat(40),rule.parent]])assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'&&args.at(-1)==='HEAD'?parents.join(' '):r.git(args),r.head,r.accepted,r.rule,r.feedRule,rule),/single-parent correction/);
 assert.throws(()=>m.sourceEquivalent(r.git,'f'.repeat(40),r.accepted,r.rule,r.feedRule,rule),/Checkout differs/);
 r.write(m.KEYBOARD_CORRECTION.files[0].path,'dirty native code');
 assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,rule),/Tracked checkout/);
 r.git(['add','.']);assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,rule),/Tracked checkout/);
 const later=r.commit();assert.equal(m.sourceEquivalent(r.git,later,r.accepted,r.rule,r.feedRule,rule),false,'Later releases do not inherit this single-child exception');
});
test('a keyboard-child mismatch fails before network access or a provider fallback',async t=>{
 const m=await modulePromise,r=keyboardRepository(t,m);let fetches=0;
 const git=args=>{
  if(args[0]==='show'&&args.at(-1)==='HEAD')return m.KEYBOARD_CORRECTION.parent;
  if(args[0]==='show'&&args.at(-1)===m.KEYBOARD_CORRECTION.parent)return m.FEED_CORRECTION.parent;
  if(args[0]==='rev-parse'&&args[1]===m.KEYBOARD_CORRECTION.parent+'^{tree}')return m.KEYBOARD_CORRECTION.parentTree;
  return r.git(args.map(arg=>arg===m.PINNED.source?r.accepted:arg===m.KEYBOARD_CORRECTION.parent?r.keyboardRule.parent:arg));
 };
 const evidence=r.fullPath('evidence-not-created');
 await assert.rejects(m.reuseConnected({git,fetcher:async()=>{fetches++;throw Error('No fetch expected');},
  env:{GITHUB_REPOSITORY:m.PINNED.repository,GITHUB_SHA:r.head,GITHUB_TOKEN:'synthetic',LIVE_CONNECTED_EVIDENCE:evidence},
 }),/Reviewed keyboard correction bytes changed/);
 assert.equal(fetches,0);assert.equal(fs.existsSync(evidence),false);
});
function autofillRepository(t,m){
 const r=keyboardRepository(t,m),parent=r.head,parentTree=r.git(['rev-parse',parent+'^{tree}']);
 const files=m.AUTOFILL_CORRECTION.files.map(file=>{const bytes='reviewed AutoFill '+file.path+'\n';r.write(file.path,bytes);return {...file,sha256:sha(Buffer.from(bytes))};});
 for(const file of m.VERIFIER_FILES)r.write(file,'reviewed AutoFill verifier\n');
 const head=r.commit();return {...r,head,autofillRule:{parent,parentTree,acceptedTree:r.git(['rev-parse',r.accepted+'^{tree}']),files}};
}
test('the exact AutoFill child preserves original service evidence and all separate native requirements',async t=>{
 const m=await modulePromise,r=autofillRepository(t,m);
 const scope=m.sourceApplicability(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule);
 assert.equal(scope.kind,'native-ios-autofill-preflight');assert.equal(scope.comparisonParent,r.autofillRule.parent);
 assert.equal(scope.comparisonParentTree,r.autofillRule.parentTree);assert.equal(scope.connectedRuntimeEquivalent,true);
 assert.equal(scope.nativeRuntimeEquivalent,false);assert.equal(scope.nativeFeedRequiresSeparateValidation,true);
 assert.equal(scope.nativeKeyboardRequiresSeparateValidation,true);assert.equal(scope.nativeIosAutofillRequiresSeparateValidation,true);
 assert.equal(Object.hasOwn(scope,'runtimeEquivalent'),false);assert.equal(Object.hasOwn(scope,'source'),false);
 assert.deepEqual(scope.verifiedFiles,r.autofillRule.files);assert.equal(scope.verifiedFiles.length,8);
 assert.deepEqual(scope.permittedChanges,[...r.autofillRule.files.map(file=>file.path),...m.VERIFIER_FILES].sort());
 assert.equal(scope.permittedChanges.length,10);
 assert.equal(m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),true);
});
test('all eight AutoFill setup and workflow hashes match the reviewed files and reject replacement bytes',async t=>{
 const m=await modulePromise;
 for(const file of m.AUTOFILL_CORRECTION.files){
  assert.equal(file.mode,'100644');
  const current=m.AUTOFILL_BUDGET_CORRECTION.files.find(replacement=>replacement.path===file.path)||file;
  assert.equal(sha(fs.readFileSync(path.join(__dirname,'../..',file.path))),current.sha256,'Current bytes use the separately reviewed budget pin where the historical setup file changed');
  const r=autofillRepository(t,m);r.write(file.path,'unreviewed AutoFill replacement\n');const head=r.amend();
  assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),/Reviewed AutoFill correction bytes changed/);
 }
});
test('AutoFill reuse rejects connected and browser setup drift even if a proposed list includes it',async t=>{
 const m=await modulePromise;
 for(const file of ['web/runtime.ts','supabase/functions/live-core/provider.ts','scripts/quality/install-browser-test-runtime.sh']){
  const r=autofillRepository(t,m),bytes='unreviewed connected change\n';r.write(file,bytes);const head=r.amend();
  assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),/unreviewed or missing change/);
  const broad={...r.autofillRule,files:[...r.autofillRule.files,{path:file,mode:'100644',sha256:sha(Buffer.from(bytes))}]};
  assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule,broad),/Connected runtime or browser preparation changed/);
 }
});
test('AutoFill reuse rejects missing, extra, deleted, renamed and nonregular paths',async t=>{
 const m=await modulePromise;
 for(const kind of ['missing','additional','deleted','renamed','symlink','executable']){
  const r=autofillRepository(t,m),file=m.AUTOFILL_CORRECTION.files[0].path;
  if(kind==='missing'||kind==='deleted')fs.unlinkSync(r.fullPath(file));
  if(kind==='additional')r.write('scripts/quality/unreviewed.py','extra setup change');
  if(kind==='renamed')fs.renameSync(r.fullPath(file),r.fullPath(file)+'.moved');
  if(kind==='symlink'){fs.unlinkSync(r.fullPath(file));fs.symlinkSync('runtime.txt',r.fullPath(file));}
  if(kind==='executable')fs.chmodSync(r.fullPath(m.VERIFIER_FILES[0]),0o755);
  const head=r.amend();assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),/unreviewed or missing change|change file type|Reviewed file mode changed/);
 }
});
test('AutoFill reuse binds every ancestor tree and single-parent link back to the original receipt source',async t=>{
 const m=await modulePromise,r=autofillRepository(t,m);
 const rules=[r.autofillRule,r.keyboardRule,r.feedRule,r.rule];
 for(const rule of rules){
  const wrongTree=args=>args[0]==='rev-parse'&&args[1]===rule.parent+'^{tree}'?'f'.repeat(40):r.git(args);
  assert.throws(()=>m.sourceEquivalent(wrongTree,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),/ancestry tree changed/);
  for(const parents of ['e'.repeat(40),r.git(['show','-s','--format=%P',rule.parent])+' '+'e'.repeat(40)]){
   const wrongParent=args=>args[0]==='show'&&args.at(-1)===rule.parent?parents:r.git(args);
   assert.throws(()=>m.sourceEquivalent(wrongParent,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),/parent ancestry changed/);
  }
 }
 assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,{...r.autofillRule,acceptedTree:'f'.repeat(40)}),/Original connected source tree changed/);
 for(const parents of [[r.autofillRule.parent,'e'.repeat(40)],['e'.repeat(40),r.autofillRule.parent]]){
  assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'&&args.at(-1)==='HEAD'?parents.join(' '):r.git(args),r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),/single-parent correction/);
 }
});
test('AutoFill reuse rejects wrong checkout, dirty or staged changes and does not authorize a later child',async t=>{
 const m=await modulePromise,r=autofillRepository(t,m);
 assert.throws(()=>m.sourceEquivalent(r.git,'f'.repeat(40),r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),/Checkout differs/);
 r.write(m.AUTOFILL_CORRECTION.files[0].path,'dirty setup bytes');
 assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),/Tracked checkout/);
 r.git(['add','.']);assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),/Tracked checkout/);
 const later=r.commit();assert.equal(m.sourceEquivalent(r.git,later,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule),false);
});
test('an AutoFill-child mismatch fails before evidence network access or any provider fallback',async t=>{
 const m=await modulePromise,r=autofillRepository(t,m);let fetches=0;
 const pairs=[[m.AUTOFILL_CORRECTION,r.autofillRule,m.KEYBOARD_CORRECTION.parent],[m.KEYBOARD_CORRECTION,r.keyboardRule,m.FEED_CORRECTION.parent],[m.FEED_CORRECTION,r.feedRule,m.NATIVE_CORRECTION.parent],[m.NATIVE_CORRECTION,r.rule,m.PINNED.source]];
 const git=args=>{
  if(args[0]==='show'&&args.at(-1)==='HEAD')return m.AUTOFILL_CORRECTION.parent;
  for(const [actual,,parent] of pairs){
   if(args[0]==='show'&&args.at(-1)===actual.parent)return parent;
   if(args[0]==='rev-parse'&&args[1]===actual.parent+'^{tree}')return actual.parentTree;
  }
  if(args[0]==='rev-parse'&&args[1]===m.PINNED.source+'^{tree}')return m.AUTOFILL_CORRECTION.acceptedTree;
  return r.git(args.map(arg=>arg===m.PINNED.source?r.accepted:pairs.find(([actual])=>arg===actual.parent)?.[1].parent||arg));
 };
 const evidence=r.fullPath('evidence-not-created');
 await assert.rejects(m.reuseConnected({git,fetcher:async()=>{fetches++;throw Error('No fetch expected');},
  env:{GITHUB_REPOSITORY:m.PINNED.repository,GITHUB_SHA:r.head,GITHUB_TOKEN:'synthetic',LIVE_CONNECTED_EVIDENCE:evidence},
 }),/Reviewed AutoFill correction bytes changed/);
 assert.equal(fetches,0);assert.equal(fs.existsSync(evidence),false);
});

function budgetRepository(t,m){
 const r=autofillRepository(t,m),parent=r.head,parentTree=r.git(['rev-parse',parent+'^{tree}']);
 const files=m.AUTOFILL_BUDGET_CORRECTION.files.map(file=>{const bytes='reviewed single-origin budget '+file.path+'\n';r.write(file.path,bytes);return {...file,sha256:sha(Buffer.from(bytes))};});
 for(const file of m.VERIFIER_FILES)r.write(file,'reviewed AutoFill budget verifier\n');
 const head=r.commit();return {...r,head,budgetRule:{parent,parentTree,acceptedTree:r.autofillRule.acceptedTree,files}};
}
test('the exact budget child preserves original service evidence and requires fresh native setup acceptance',async t=>{
 const m=await modulePromise,r=budgetRepository(t,m);
 const scope=m.sourceApplicability(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule);
 assert.equal(scope.kind,'native-ios-autofill-budget-correction');assert.equal(scope.comparisonParent,r.budgetRule.parent);
 assert.equal(scope.comparisonParentTree,r.budgetRule.parentTree);assert.equal(scope.connectedRuntimeEquivalent,true);
 assert.equal(scope.nativeRuntimeEquivalent,false);assert.equal(scope.nativeFeedRequiresSeparateValidation,true);
 assert.equal(scope.nativeKeyboardRequiresSeparateValidation,true);assert.equal(scope.nativeIosAutofillRequiresSeparateValidation,true);
 assert.equal(Object.hasOwn(scope,'runtimeEquivalent'),false);assert.equal(Object.hasOwn(scope,'source'),false);
 assert.deepEqual(scope.verifiedFiles,r.budgetRule.files);assert.equal(scope.verifiedFiles.length,3);
 assert.deepEqual(scope.permittedChanges,[...r.budgetRule.files.map(file=>file.path),...m.VERIFIER_FILES].sort());
 assert.equal(scope.permittedChanges.length,5);
 assert.equal(m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),true);
});
test('all three budget and workflow files match frozen bytes and reject substitutions',async t=>{
 const m=await modulePromise;
 for(const file of m.AUTOFILL_BUDGET_CORRECTION.files){
  assert.equal(file.mode,'100644');assert.equal(sha(fs.readFileSync(path.join(__dirname,'../..',file.path))),file.sha256);
  const r=budgetRepository(t,m);r.write(file.path,'unreviewed budget replacement\n');const head=r.amend();
  assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),/Reviewed AutoFill budget correction bytes changed/);
 }
});
test('budget reuse rejects connected and browser preparation drift even in a broadened proposed list',async t=>{
 const m=await modulePromise;
 for(const file of ['web/runtime.ts','supabase/functions/live-core/provider.ts','scripts/quality/install-browser-test-runtime.sh']){
  const r=budgetRepository(t,m),bytes='unreviewed connected change\n';r.write(file,bytes);const head=r.amend();
  assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),/unreviewed or missing change/);
  const broad={...r.budgetRule,files:[...r.budgetRule.files,{path:file,mode:'100644',sha256:sha(Buffer.from(bytes))}]};
  const rejection=file.startsWith('supabase/')?/exception cannot add, delete, rename or change file type/:/Connected runtime or browser preparation changed/;
  assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,broad),rejection);
 }
});
test('budget reuse rejects missing, extra, deleted, renamed and nonregular changes',async t=>{
 const m=await modulePromise;
 for(const kind of ['missing','additional','deleted','renamed','symlink','executable']){
  const r=budgetRepository(t,m),file=m.AUTOFILL_BUDGET_CORRECTION.files[0].path;
  if(kind==='missing')r.write(file,r.git(['show',r.budgetRule.parent+':'+file]));
  if(kind==='deleted')fs.unlinkSync(r.fullPath(file));
  if(kind==='additional')r.write('scripts/quality/unreviewed.py','extra setup change');
  if(kind==='renamed')fs.renameSync(r.fullPath(file),r.fullPath(file)+'.moved');
  if(kind==='symlink'){fs.unlinkSync(r.fullPath(file));fs.symlinkSync('runtime.txt',r.fullPath(file));}
  if(kind==='executable')fs.chmodSync(r.fullPath(m.VERIFIER_FILES[0]),0o755);
  const head=r.amend();assert.throws(()=>m.sourceEquivalent(r.git,head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),/unreviewed or missing change|change file type|Reviewed file mode changed/);
 }
});
test('budget reuse binds all six prior sources and the single-parent chain back to original evidence',async t=>{
 const m=await modulePromise,r=budgetRepository(t,m);
 const rules=[r.budgetRule,r.autofillRule,r.keyboardRule,r.feedRule,r.rule];
 for(const rule of rules){
  const wrongTree=args=>args[0]==='rev-parse'&&args[1]===rule.parent+'^{tree}'?'f'.repeat(40):r.git(args);
  assert.throws(()=>m.sourceEquivalent(wrongTree,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),/ancestry tree changed/);
  for(const parents of ['e'.repeat(40),r.git(['show','-s','--format=%P',rule.parent])+' '+'e'.repeat(40)]){
   const wrongParent=args=>args[0]==='show'&&args.at(-1)===rule.parent?parents:r.git(args);
   assert.throws(()=>m.sourceEquivalent(wrongParent,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),/parent ancestry changed/);
  }
 }
 assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,{...r.budgetRule,acceptedTree:'f'.repeat(40)}),/Original connected source tree changed/);
 for(const parents of [[r.budgetRule.parent,'e'.repeat(40)],['e'.repeat(40),r.budgetRule.parent]]){
  assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'&&args.at(-1)==='HEAD'?parents.join(' '):r.git(args),r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),/single-parent correction/);
 }
});
test('budget reuse rejects dirty or staged bytes, wrong checkout and a later descendant',async t=>{
 const m=await modulePromise,r=budgetRepository(t,m);
 assert.throws(()=>m.sourceEquivalent(r.git,'f'.repeat(40),r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),/Checkout differs/);
 r.write(m.AUTOFILL_BUDGET_CORRECTION.files[0].path,'dirty budget bytes');
 assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),/Tracked checkout/);
 r.git(['add','.']);assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),/Tracked checkout/);
 const later=r.commit();assert.equal(m.sourceEquivalent(r.git,later,r.accepted,r.rule,r.feedRule,r.keyboardRule,r.autofillRule,r.budgetRule),false);
});
test('a budget-child mismatch rejects before any evidence request or provider fallback',async t=>{
 const m=await modulePromise,r=budgetRepository(t,m);let fetches=0;
 const pairs=[[m.AUTOFILL_BUDGET_CORRECTION,r.budgetRule,m.AUTOFILL_CORRECTION.parent],[m.AUTOFILL_CORRECTION,r.autofillRule,m.KEYBOARD_CORRECTION.parent],[m.KEYBOARD_CORRECTION,r.keyboardRule,m.FEED_CORRECTION.parent],[m.FEED_CORRECTION,r.feedRule,m.NATIVE_CORRECTION.parent],[m.NATIVE_CORRECTION,r.rule,m.PINNED.source]];
 const git=args=>{
  if(args[0]==='show'&&args.at(-1)==='HEAD')return m.AUTOFILL_BUDGET_CORRECTION.parent;
  for(const [actual,,parent] of pairs){
   if(args[0]==='show'&&args.at(-1)===actual.parent)return parent;
   if(args[0]==='rev-parse'&&args[1]===actual.parent+'^{tree}')return actual.parentTree;
  }
  if(args[0]==='rev-parse'&&args[1]===m.PINNED.source+'^{tree}')return m.AUTOFILL_BUDGET_CORRECTION.acceptedTree;
  return r.git(args.map(arg=>arg===m.PINNED.source?r.accepted:pairs.find(([actual])=>arg===actual.parent)?.[1].parent||arg));
 };
 const evidence=r.fullPath('evidence-not-created');
 await assert.rejects(m.reuseConnected({git,fetcher:async()=>{fetches++;throw Error('No fetch expected');},
  env:{GITHUB_REPOSITORY:m.PINNED.repository,GITHUB_SHA:r.head,GITHUB_TOKEN:'synthetic',LIVE_CONNECTED_EVIDENCE:evidence},
 }),/Reviewed AutoFill budget correction bytes changed/);
 assert.equal(fetches,0);assert.equal(fs.existsSync(evidence),false);
});
