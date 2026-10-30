const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'); const {test,before,after}=require('node:test'); const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const {PGlite}=createRequire(path.join(root,'supabase/tests/rpc-authorization/package.json'))('@electric-sql/pglite');
const db=new PGlite();
const applicant='10000000-0000-0000-0000-000000000001',employer='20000000-0000-0000-0000-000000000002',stranger='30000000-0000-0000-0000-000000000003',job='40000000-0000-0000-0000-000000000004';
const objectPath=`${applicant}/${job}/50000000-0000-0000-0000-000000000005.pdf`,reference='application-cvs/'+objectPath;
let cv;
before(async()=>{
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'shared/applicationCv.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:mod,exports:mod.exports});cv=mod.exports;
 await db.exec(`
 create role authenticated; create role anon; create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.studio_role() returns text language sql stable as $$select coalesce(nullif(current_setting('test.studio_role',true),''),'owner')$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 create table public.jobs(id uuid primary key,posted_by uuid);
 create table public.job_applications(id uuid default gen_random_uuid(),job_id uuid,applicant_id uuid,cv_url text);
 alter table storage.objects enable row level security; alter table public.job_applications enable row level security;
 create policy app_select on public.job_applications for select to authenticated using(applicant_id=auth.uid() or exists(select 1 from public.jobs j where j.id=job_id and j.posted_by=auth.uid()));
 create policy app_insert on public.job_applications for insert to authenticated with check(applicant_id=auth.uid());
 create policy legacy_broad_storage on storage.objects for all to authenticated using(true) with check(true);
 create policy legacy_anon_storage on storage.objects for select to anon using(true);
 grant usage on schema public,auth,storage to authenticated,anon;
 grant select,insert,update,delete on all tables in schema public,storage to authenticated,anon;
 insert into public.jobs values('${job}','${employer}');`);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261022173041_platinum_private_application_cvs.sql'),'utf8'));
 await db.query("insert into storage.objects(bucket_id,name) values('application-cvs',$1)",[objectPath]);
 await db.query('insert into public.job_applications(job_id,applicant_id,cv_url) values($1,$2,$3)',[job,applicant,reference]);
});
after(()=>db.close());
async function as(uid,fn,role='owner',dbRole='authenticated'){
 await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('test.studio_role',$2,true)",[uid,role]);await db.exec('set local role '+dbRole);return await fn();}finally{await db.exec('rollback');}
}
test('CV parser rejects URLs, traversal, unsupported types and oversize files',()=>{
 assert.equal(cv.applicationCvPath(reference),objectPath);
 for(const bad of ['https://x.test/cv.pdf','application-cvs/../cv.pdf',reference+'.html'])assert.equal(cv.applicationCvPath(bad),null);
 assert.equal(cv.applicationCvFile('Resume.PDF',1024).contentType,'application/pdf');
 for(const [name,size]of[['cv.html',100],['cv.constructor',100],['cv.__proto__',100],['cv.pdf',0],['cv.pdf',9*1024*1024]])assert.throws(()=>cv.applicationCvFile(name,size));
});
test('only applicant and authorized hiring owner can read CVs',async()=>{
 const count=()=>db.query("select name from storage.objects where bucket_id='application-cvs'").then(r=>r.rows.length);
 assert.equal(await as(applicant,count),1);assert.equal(await as(employer,count,'recruiter'),1);assert.equal(await as(stranger,count),0);assert.equal(await as(employer,count,'support'),0);assert.equal(await as('',count,'owner','anon'),0);
});
test('owner-prefix upload guards still hold with legacy broad storage policies',async()=>{
 await assert.rejects(as(stranger,()=>db.query("insert into storage.objects(bucket_id,name) values('application-cvs',$1)",[objectPath])));
 await as(applicant,()=>db.query("insert into storage.objects(bucket_id,name) values('application-cvs',$1)",[objectPath.replace('.pdf','.txt')]));
 await assert.rejects(as(applicant,()=>db.query("insert into storage.objects(bucket_id,name) values('application-cvs',$1)",[objectPath.replace('.pdf','.html')])));
});
test('attached CV objects cannot be overwritten or deleted',async()=>{
 assert.equal(await as(applicant,()=>db.query("update storage.objects set name='bad' where name=$1 returning name",[objectPath]).then(r=>r.rows.length)),0);
 for(const uid of [applicant,employer])assert.equal(await as(uid,()=>db.query('delete from storage.objects where name=$1 returning name',[objectPath]).then(r=>r.rows.length)),0);
});
test('applications cannot attach another applicant CV or missing object',async()=>{
 await assert.rejects(as(stranger,()=>db.query('insert into public.job_applications(job_id,applicant_id,cv_url) values($1,$2,$3)',[job,stranger,reference])));
 await assert.rejects(as(applicant,()=>db.query('insert into public.job_applications(job_id,applicant_id,cv_url) values($1,$2,$3)',[job,applicant,reference.replace('.pdf','.docx')])));
});

// Exercise the real web application form, including asynchronous upload failures.
function formHarness({upload=async()=>({error:null}),insert=async()=>({data:{id:'application',status:'applied'},error:null}),jobResult=async()=>({data:{id:job,deadline:null},error:null})}={}) {
 const slots=[],effects=[];let cursor=0,tree,uid=applicant,authCallback;
 const calls={uploads:[],inserts:[]};
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
  useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((v,k)=>!Object.is(v,slots[i].deps[k]))){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>slots[i].cleanup=fn());}},
 };
 const client={
  auth:{getSession:async()=>({data:{session:uid?{user:{id:uid}}:null},error:null}),onAuthStateChange(fn){authCallback=fn;return{data:{subscription:{unsubscribe(){authCallback=null;}}}};}},
  storage:{from(bucket){return{upload(filePath,file,options){calls.uploads.push({bucket,filePath,file,options});return upload();}};}},
  from(table){let payload;const q={select:()=>q,eq:()=>q,maybeSingle:async()=>table==='jobs'?jobResult():({data:null,error:null}),insert(value){payload=value;calls.inserts.push(value);return q;},single:()=>insert(payload)};return q;},
 };
 const jsx=(type,props)=>({type,props:type==='Dialog'?{...props,children:props.open?props.children:null}:props});const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(path.join(root,'web/components/ApplyPanel.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,URL,crypto:{randomUUID:()=> '50000000-0000-0000-0000-000000000005'},require(id){if(id==='react')return hooks;if(id==='next/link')return{default:'a'};if(id==='lucide-react')return new Proxy({},{get:(_t,key)=>String(key)});if(id==='@/components/ProductDialog')return{ProductDialog:'Dialog'};if(id.endsWith('.module.css'))return{default:new Proxy({},{get:(_t,key)=>String(key)})};if(id==='react/jsx-runtime')return{jsx,jsxs:jsx};if(id==='@/lib/supabase/client')return{createClient:()=>client};if(id==='@/lib/jobs')return{isJobDeadlinePassed:()=>false,STATUS_META:{applied:{label:'Applied'}}};if(id.endsWith('shared/applicationCv'))return cv;throw Error(id);}});
 const content=node=>typeof node==='string'?node:Array.isArray(node)?node.map(content).join(''):node&&typeof node==='object'?content(node.props?.children):'';
 const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
 const render=()=>{cursor=0;tree=module.exports.ApplyPanel({jobId:job,applyUrl:null,deadline:null});while(effects.length)effects.shift()();return tree;};
 const button=label=>nodes(render()).find(n=>n.type==='button'&&content(n).trim()===label);
 const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));render();};
 return{calls,render,flush,button,review(){nodes(render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});render();},get text(){return content(tree);},file(){nodes(render()).find(n=>n.props?.type==='file').props.onChange({target:{files:[{name:'CV.pdf',size:1234}]}});render();},auth(next){uid=next;authCallback?.('SIGNED_OUT',next?{user:{id:next}}:null);render();}};
}
test('web applications upload one private CV and persist its durable reference',async()=>{
 const h=formHarness();h.render();await h.flush();h.button('Apply').props.onClick();h.file();h.review();
 const send=h.button('Submit application');await Promise.all([send.props.onClick(),send.props.onClick()]);h.render();
 assert.equal(h.calls.uploads.length,1);assert.equal(h.calls.inserts.length,1);
 const upload=h.calls.uploads[0];assert.equal(upload.bucket,'application-cvs');assert.equal(upload.filePath,objectPath);assert.equal(upload.options.upsert,false);assert.equal(upload.options.contentType,'application/pdf');
 assert.equal(h.calls.inserts[0].cv_url,reference);assert.equal(h.calls.inserts[0].cv_name,'CV.pdf');assert.match(h.text,/Application sent/);
});
test('failed upload never submits or claims success and can be retried',async()=>{
 let failed=true;const h=formHarness({upload:async()=>({error:failed?{message:'offline'}:null})});h.render();await h.flush();h.button('Apply').props.onClick();h.file();h.review();await h.button('Submit application').props.onClick();h.render();
 assert.equal(h.calls.inserts.length,0);assert.match(h.text,/could not be uploaded securely/);
 failed=false;await h.button('Submit application').props.onClick();h.render();assert.equal(h.calls.inserts.length,1);assert.match(h.text,/Application sent/);
});
test('failed application write reuses its private uploaded file on retry',async()=>{
 let failed=true;const h=formHarness({insert:async()=>failed?{data:null,error:{message:'Write failed'}}:{data:{id:'application'},error:null}});h.render();await h.flush();h.button('Apply').props.onClick();h.file();h.review();await h.button('Submit application').props.onClick();h.render();assert.match(h.text,/Write failed/);
 failed=false;await h.button('Submit application').props.onClick();h.render();assert.equal(h.calls.uploads.length,1);assert.equal(h.calls.inserts.length,2);assert.match(h.text,/Application sent/);
});
test('sign-out during a CV upload prevents the pending application write',async()=>{
 let finish;const h=formHarness({upload:()=>new Promise(resolve=>{finish=()=>resolve({error:null});})});h.render();await h.flush();h.button('Apply').props.onClick();h.file();h.review();const task=h.button('Submit application').props.onClick();await h.flush();h.auth(null);finish();await task;await h.flush();assert.equal(h.calls.inserts.length,0);assert.doesNotMatch(h.text,/Application sent/);
});
test('a removed job is checked before uploading a CV or sending an application',async()=>{
 const h=formHarness({jobResult:async()=>({data:null,error:null})});h.render();await h.flush();h.button('Apply').props.onClick();h.file();h.review();await h.button('Submit application').props.onClick();h.render();
 assert.equal(h.calls.uploads.length,0);assert.equal(h.calls.inserts.length,0);assert.match(h.text,/closed for new applications/);
});
test('a failed availability check remains retryable and never sends an application',async()=>{
 const h=formHarness({jobResult:async()=>({data:null,error:{message:'Could not check job'}})});h.render();await h.flush();h.button('Apply').props.onClick();h.file();h.review();await h.button('Submit application').props.onClick();h.render();
 assert.equal(h.calls.uploads.length,0);assert.equal(h.calls.inserts.length,0);assert.match(h.text,/Could not check job/);
});

test('review and edit keep the application local until explicit confirmation',async()=>{
 const h=formHarness();h.render();await h.flush();h.button('Apply').props.onClick();h.file();h.review();assert.equal(h.calls.uploads.length,0);assert.equal(h.calls.inserts.length,0);assert.match(h.text,/CV.pdf/);h.button('Edit application').props.onClick();h.render();assert.equal(h.calls.uploads.length,0);assert.equal(h.calls.inserts.length,0);assert.match(h.text,/CV.pdf/);
});
