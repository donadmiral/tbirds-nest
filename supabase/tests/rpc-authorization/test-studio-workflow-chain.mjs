import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test as nodeTest} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';
import {readCandidate} from './migration-source.mjs';

const db=new PGlite({extensions}),qaMode=process.env.PLATINUM_QA_STUDIO_WORKFLOWS==='1';
const candidate='supabase/migrations/20261030024125_studio_editorial_and_partnership_workflows.sql';
const routeCandidate='supabase/migrations/20261030031124_reserve_web_route_usernames.sql';
const provisionRouteCandidate='supabase/migrations/20261030033214_reserve_business_provision_usernames.sql';
const users=Object.fromEntries(['business','other_business','creator','stranger','bootstrap'].map(k=>[k,randomUUID()]));
const actors={};
for(const [name,role]of Object.entries({owner:'owner',reviewer:'admin',editor:'editor',support:'support'}))actors[name]={user:users.business,session:randomUUID(),member:randomUUID(),role};
actors.other={user:users.other_business,session:randomUUID(),member:randomUUID(),role:'owner'};
for(const name of ['creator','stranger','bootstrap'])actors[name]={user:users[name],session:randomUUID(),member:null,role:'owner'};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await q(sql,args))[0]||{})[0];
const passed=[];let migration,routeMigration,provisionRouteMigration,provisionBeforeDefinition,provisionRouteEvidence,preservedBefore,preservedAfter,preflight,postflight,routeEvidence,collisionGuardProved=false,registeredTests=0;
const test=(name,fn)=>{registeredTests++;return nodeTest(name,async()=>{await fn();passed.push(name);});};
async function as(name,sql,args=[],role='authenticated',overrides={}){
 const actor=actors[name]||{};
 await db.exec('savepoint request');
 try{
  await db.exec(`set local role ${role}`);
  const claims={sub:actor.user||null,role,session_id:actor.session||null,is_anonymous:false,...overrides};
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[claims.sub||'',role,JSON.stringify(claims)]);
  const result=await value(sql,args);await db.exec('reset role');
  await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
  await db.exec('release savepoint request');return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const list=(name='owner',limit=50,at=null,id=null)=>as(name,'select public.studio_newsroom_list($1,$2,$3)',[limit,at,id]);
const partners=(name='owner',limit=50,at=null,id=null)=>as(name,'select public.studio_partnerships_list($1,$2,$3)',[limit,at,id]);
const draft=(name='editor',content='A reviewed original caption')=>as(name,'select public.studio_save_post(p_content=>$1)',[content]);
const newsInput=(post)=>({title:'Game coverage',brief:'Review the highlight and caption before publication.',scheduled_post_id:post,
 rights_owner:'Synthetic team',territory:'Worldwide',rights_verified:true,publish_at:new Date(Date.now()+3600000).toISOString()});
const newsSave=(name,input,id=null,version=null,key=randomUUID())=>as(name,'select public.studio_newsroom_save($1,$2,$3,$4,$5)',[actors[name].user,key,id,version,input]);
const newsAction=(name,row,action,note='',key=randomUUID())=>as(name,'select public.studio_newsroom_transition($1,$2,$3,$4,$5,$6)',[actors[name].user,key,row.id,row.version,action,note]);
const partnerInput=()=>({title:'Creator collaboration',brief:'Prepare an original short caption.',deliverables:'One caption, with an optional public post.',creator_username:'workflow_creator',
 disclosure:'Paid partnership with Synthetic team',fee_minor:25000,currency:'USD',due_at:new Date(Date.now()+86400000).toISOString()});
const partnerSave=(name='owner',input=partnerInput(),id=null,version=null,key=randomUUID())=>as(name,'select public.studio_partnership_save($1,$2,$3,$4,$5)',[actors[name].user,key,id,version,input]);
const partnerAction=(name,row,action,note='',key=randomUUID())=>as(name,'select public.studio_partnership_transition($1,$2,$3,$4,$5,$6)',[actors[name].user,key,row.id,row.version,action,note]);
const deliver=(row,content='An original creator caption.',post=null,name='creator',key=randomUUID())=>as(name,'select public.studio_partnership_deliver($1,$2,$3,$4,$5,$6)',[actors[name].user,key,row.id,row.version,content,post]);
const consent=(row,permission,granted,expires=new Date(Date.now()+86400000).toISOString(),name='creator',key=randomUUID())=>as(name,'select public.studio_partnership_permission($1,$2,$3,$4,$5,$6,$7)',[actors[name].user,key,row.id,row.version,permission,granted,expires]);
async function approvedPartnership(){let row=await partnerSave();row=await partnerAction('owner',row,'propose');row=await partnerAction('creator',row,'accept');row=await deliver(row);return partnerAction('reviewer',row,'approve');}
async function snapshot(){return{users:await q('select to_jsonb(u) row from auth.users u order by id'),profiles:await q('select to_jsonb(p) row from public.profiles p order by id'),sessions:await q('select to_jsonb(s) row from auth.sessions s order by id'),objects:await q('select to_jsonb(o) row from storage.objects o order by id'),buckets:await q('select to_jsonb(b) row from storage.buckets b order by id'),staff:await q('select to_jsonb(s) row from public.admin_users s order by user_id'),members:await q('select to_jsonb(m) row from public.business_access_members m order by id'),bindings:await q('select to_jsonb(s) row from public.studio_session_members s order by session_id'),devices:await q('select to_jsonb(d) row from public.business_devices d order by id'),signins:await q('select to_jsonb(s) row from public.business_signin_log s order by id')};}

before(async()=>{
 await loadDeployedMediaBaseline(db);await db.exec(await readCandidate());
 await db.exec(await source('supabase/migrations/20261029224550_admin_operations_completion.sql'));
 if(qaMode){
  await(await import('./qa-admin-baseline.mjs')).installQaAdminBaseline(db);
  await(await import('./qa-media-baseline.mjs')).installQaMediaBaseline(db);
  await db.exec(await source('supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql'));
  await db.exec(await source('supabase/ops/qa/20261029233915_qa_media_completion_forward.sql'));
  for(const name of ['20261029224812_account_storage_erasure','20261029231321_account_erasure_admin_review_queue'])await db.exec(await source(`supabase/migrations/${name}.sql`));
  await(await import('./qa-database-hardening-baseline.mjs')).installQaHardeningAclBaseline(db);
  await db.exec(await source('supabase/ops/qa/20261029235400_qa_database_access_hardening_forward.sql'));
  await db.exec('revoke all on function public.upsert_link_preview(text,text,text,text,text) from public,postgres,anon,authenticated,service_role;grant execute on function public.upsert_link_preview(text,text,text,text,text) to postgres,public,anon,authenticated,service_role');
 }else{
  for(const name of ['20261029224812_account_storage_erasure','20261029224813_private_media_cutover_compatibility','20261029231321_account_erasure_admin_review_queue','20261029231440_bounded_media_delivery'])await db.exec(await source(`supabase/migrations/${name}.sql`));
  for(const name of ['notify_push_notification','notify_voip_ring','notify_voip_ring_1to1','notify_voip_ring_session'])await db.exec(`create function public.${name}() returns trigger language plpgsql security definer set search_path=public as $$begin return new;end$$;revoke all on function public.${name}() from public,postgres,anon,authenticated,service_role;grant execute on function public.${name}() to public,postgres,anon,authenticated,service_role`);
  await db.exec(await source('supabase/migrations/20261029234214_database_access_hardening.sql'));
 }
 await db.exec('alter role service_role bypassrls');
 for(const name of ['20261030000331_link_preview_verified_cache','20261030005241_account_erasure_operator_review','20261030010250_account_erasure_admin_restore_guard','20261030012831_staff_social_shells'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 await db.exec("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims','{}',false)");
 for(const [name,id]of Object.entries(users)){
  await q('insert into auth.users(id,email) values($1,$2)',[id,`workflow-${name}@example.test`]);
  await q('update public.profiles set username=$1,full_name=$1,account_type=$2 where id=$3',[`workflow_${name}`,name.includes('business')||name==='bootstrap'?'business':'personal',id]);
 }
 for(const [name,a]of Object.entries(actors)){
  await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[a.session,a.user]);
  if(a.member){
   await q("insert into public.business_access_members(id,business_id,display_name,role,code_hash) values($1,$2,$3,$4,encode(extensions.digest($5,'sha256'),'hex'))",[a.member,a.user,name,a.role,`TEST-${name.toUpperCase()}`]);
   await q('insert into public.studio_session_members(session_id,business_id,member_id) values($1,$2,$3)',[a.session,a.user,a.member]);
  }
 }
 preflight=await value(await source('supabase/ops/check-studio-workflows-preflight.sql'));
 for(const [key,result]of Object.entries(preflight))if(key!=='data_counts')assert.equal(result,true,key);
 preservedBefore=await snapshot();migration=await source(candidate);await db.exec(migration);
 postflight=await value(await source('supabase/ops/check-studio-workflows-postflight.sql'));
 routeMigration=await source(routeCandidate);
 // Deliberately seed a route collision only inside a rolled-back local fixture
 // to prove deployment aborts instead of renaming that existing person.
 await db.exec('begin');await q("update public.profiles set username='watch' where id=$1",[users.creator]);
 await assert.rejects(db.exec(routeMigration),/ROUTE_RESERVATION_EXISTING_HANDLE_COLLISION/);await db.exec('rollback');
 assert.equal(await value("select to_regnamespace('app_routes')"),null);
 assert.equal(await value('select username from public.profiles where id=$1',[users.creator]),'workflow_creator');collisionGuardProved=true;
 await db.exec(routeMigration);routeEvidence=await value(await source('supabase/ops/check-reserved-web-usernames.sql'));
 provisionBeforeDefinition=await value("select pg_get_functiondef('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)'::regprocedure)");
 provisionRouteMigration=await source(provisionRouteCandidate);await db.exec(provisionRouteMigration);
 provisionRouteEvidence=await value(await source('supabase/ops/check-reserved-business-provision.sql'));
 preservedAfter=await snapshot();
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
after(async()=>{
 if(process.env.STUDIO_WORKFLOW_GATE_OUTPUT&&passed.length===registeredTests)await writeFile(process.env.STUDIO_WORKFLOW_GATE_OUTPUT,JSON.stringify({candidate,sha256:createHash('sha256').update(migration).digest('hex'),routeCandidate,routeSha256:createHash('sha256').update(routeMigration).digest('hex'),provisionRouteCandidate,provisionRouteSha256:createHash('sha256').update(provisionRouteMigration).digest('hex'),provisionRouteEvidence,qaMode,allPassed:true,testsPassed:passed.length,tests:passed,preflight,postflight,routeEvidence,collisionGuardProved,existingRowsPreserved:true,verifiedAt:new Date().toISOString(),fixture:qaMode?'QA forward chain with single-owner policy, private media, erasure and staff isolation':'production and parity forward chain with current media, erasure and staff isolation'},null,2)+'\n');
 await db.close();
});

test('forward install preserves existing Auth/profile/Storage/staff and business-access rows and buckets',()=>assert.deepEqual(preservedAfter,preservedBefore));
test('reviewable preflight/postflight metadata enforces private helpers and authenticated RPC grants',()=>{
 assert.deepEqual(preflight.data_counts,postflight.data_counts);assert.equal(postflight.business_tables_private,true);
 assert.equal(postflight.publishing_guard.enabled,'O');assert.match(postflight.publishing_guard.definition,/BEFORE DELETE OR UPDATE|BEFORE UPDATE OR DELETE/);
 for(const count of Object.values(postflight.new_rows))assert.equal(count,0);
 for(const fn of postflight.functions){assert.equal(fn.owner,'postgres');assert.equal(fn.anon_execute,false);assert.equal(fn.app_execute,!fn.private);assert.equal(fn.service_execute,false);assert.deepEqual(fn.search_path,['search_path=""']);}
 for(const table of postflight.tables){assert.equal(table.rls,true);assert.equal(table.policies,0);assert.equal(table.anon_access,false);assert.equal(table.app_access,false);assert.equal(table.service_access,false);}
});
test('all workflow records and access hashes deny direct app and service reads',async()=>{
 for(const role of ['anon','authenticated','service_role'])for(const table of ['newsroom','partnerships','deliverables','events','commands','access_events'])
  await assert.rejects(as('owner',`select * from studio_workflow.${table}`,[],role),/permission denied/);
 for(const role of ['anon','authenticated'])for(const table of ['business_access_members','business_devices','business_signin_log','studio_session_members'])
  await assert.rejects(as('owner',`select * from public.${table}`,[],role),/permission denied/);
 const f=await q("select p.oid::regprocedure::text signature from pg_proc p where p.pronamespace='studio_workflow'::regnamespace and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or p.proconfig is distinct from array['search_path=\"\"']::text[])");
 assert.equal(f.length,0,JSON.stringify(f));
});
test('anonymous, stale, expired and substituted sessions cannot read or write workflows',async()=>{
 await assert.rejects(as(null,'select public.studio_newsroom_list()',[],'anon'),/permission denied/);
 await assert.rejects(list(null),/WORKFLOW_ACTIVE_SESSION_REQUIRED/);
 await assert.rejects(as('owner','select public.studio_newsroom_list()',[],'authenticated',{session_id:actors.creator.session}),/WORKFLOW_ACTIVE_SESSION_REQUIRED/);
 await q('delete from auth.sessions where id=$1',[actors.owner.session]);
 assert.equal(await as('owner','select public.studio_role()'),null);
 await assert.rejects(list(),/WORKFLOW_ACTIVE_SESSION_REQUIRED/);
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[actors.editor.session]);
 await assert.rejects(list('editor'),/WORKFLOW_ACTIVE_SESSION_REQUIRED/);
});
test('session-bound roles reject support access and do not accept a claimed role',async()=>{
 await assert.rejects(as('support','update public.studio_session_members set member_id=$1 where session_id=$2 returning member_id',[actors.owner.member,actors.support.session]),/permission denied/);
 await assert.rejects(list('support'),/WORKFLOW_PERMISSION_DENIED/);
 await assert.rejects(as('support','select public.studio_newsroom_list()',[],'authenticated',{studio_role:'owner',user_metadata:{role:'owner'}}),/WORKFLOW_PERMISSION_DENIED/);
 await q('delete from public.studio_session_members where session_id=$1',[actors.editor.session]);
 await assert.rejects(list('editor'),/WORKFLOW_MEMBER_ACCESS_REQUIRED/);
});
test('expected owner checks reject account switching before a command is recorded',async()=>{
 await assert.rejects(as('owner','select public.studio_newsroom_save($1,$2,null,null,$3)',[users.other_business,randomUUID(),newsInput(null)]),/WORKFLOW_ACTIVE_SESSION_REQUIRED/);
 await assert.rejects(as('owner','select public.studio_newsroom_save(null,$1,null,null,$2)',[randomUUID(),newsInput(null)]),/WORKFLOW_ACTIVE_SESSION_REQUIRED/);
 assert.equal(await value('select count(*)::int from studio_workflow.commands'),0);
});
test('assignment create/update is tenant scoped, versioned and idempotent',async()=>{
 const post=await draft(),input=newsInput(post),key=randomUUID();
 const row=await newsSave('editor',input,null,null,key);assert.equal(row.version,1);assert.equal(row.state,'draft');
 assert.equal((await newsSave('editor',input,null,null,key)).id,row.id);
 assert.equal((await list('other')).items.length,0);
 await assert.rejects(newsSave('other',input,row.id,row.version),/WORKFLOW_NOT_FOUND/);
 await assert.rejects(newsSave('editor',{...input,title:'Changed'},null,null,key),/WORKFLOW_REQUEST_KEY_REUSED/);
 const updated=await newsSave('editor',{...input,title:'Updated'},row.id,row.version);assert.equal(updated.version,2);
 await assert.rejects(newsSave('editor',input,row.id,row.version),/WORKFLOW_VERSION_CHANGED/);
 assert.equal(await value('select count(*)::int from studio_workflow.newsroom'),1);
});
test('foreign assignees, foreign drafts and unknown fields cannot become an assignment',async()=>{
 const post=await draft(),input=newsInput(post);
 await assert.rejects(newsSave('editor',{...input,assignee_id:actors.other.member}),/WORKFLOW_ASSIGNEE_UNAVAILABLE/);
 const foreign=await draft('other');await assert.rejects(newsSave('editor',{...input,scheduled_post_id:foreign}),/WORKFLOW_DRAFT_UNAVAILABLE/);
 await assert.rejects(newsSave('editor',{...input,owner_id:users.other_business}),/WORKFLOW_INVALID_INPUT/);
});
test('submission requires actual draft, confirmed rights and visible sponsored disclosure',async()=>{
 let row=await newsSave('editor',newsInput(null));await assert.rejects(newsAction('editor',row,'submit'),/WORKFLOW_DRAFT_REQUIRED/);
 const post=await draft();row=await newsSave('editor',{...newsInput(post),rights_verified:false});
 await assert.rejects(newsAction('editor',row,'submit'),/WORKFLOW_RIGHTS_REQUIRED/);
 row=await newsSave('editor',{...newsInput(post),paid_partnership:true,sponsor:'Synthetic sponsor'},row.id,row.version);
 await assert.rejects(newsAction('editor',row,'submit'),/WORKFLOW_DISCLOSURE_REQUIRED/);
});
test('editor submission requires an independent owner/admin review and locks the approved creative',async()=>{
 let row=await newsSave('owner',newsInput(await draft('owner')));row=await newsAction('owner',row,'submit');
 await assert.rejects(newsAction('owner',row,'approve'),/WORKFLOW_INDEPENDENT_REVIEW_REQUIRED/);
 await assert.rejects(newsAction('editor',row,'approve'),/WORKFLOW_PERMISSION_DENIED/);
 await assert.rejects(as('editor','select public.studio_save_post(p_id=>$1,p_content=>$2)',[row.scheduled_post_id,'Unreviewed replacement']),/WORKFLOW_WITHDRAW_BEFORE_EDIT/);
 const approved=await newsAction('reviewer',row,'approve');assert.equal(approved.state,'approved');assert.equal(approved.approved_by,actors.reviewer.member);
});
test('review feedback and submitter withdrawal restore editable state without losing history',async()=>{
 let row=await newsSave('editor',newsInput(await draft()));row=await newsAction('editor',row,'submit');
 await assert.rejects(newsAction('reviewer',row,'request_changes'),/WORKFLOW_REVIEW_NOTE_REQUIRED/);
 row=await newsAction('reviewer',row,'request_changes','Please revise the caption.');assert.equal(row.can_edit,true);assert.equal(row.review_note,'Please revise the caption.');
 row=await newsAction('editor',row,'submit');row=await newsAction('editor',row,'withdraw');assert.equal(row.state,'draft');assert.ok(row.events.some(e=>e.action==='withdraw'));
});
test('approved scheduling updates the actual publishing queue and blocks early direct publication',async()=>{
 let row=await newsSave('editor',newsInput(await draft()));row=await newsAction('editor',row,'submit');row=await newsAction('reviewer',row,'approve');
 row=await newsAction('editor',row,'schedule');assert.equal(row.state,'scheduled');assert.equal(row.post_status,'scheduled');
 assert.equal(new Date(await value('select publish_at from public.studio_scheduled_posts where id=$1',[row.scheduled_post_id])).getTime(),Date.parse(row.publish_at));
 await assert.rejects(as('editor','select public.studio_publish_now($1)',[row.scheduled_post_id]),/WORKFLOW_EMBARGO_ACTIVE/);
});
test('expired rights and pre-embargo schedules cannot enter the publishing queue',async()=>{
 for(const input of [i=>({...i,rights_expires_at:new Date(Date.now()+1800000).toISOString()}),i=>({...i,embargo_at:new Date(Date.now()+7200000).toISOString()})]){
  let row=await newsSave('editor',input(newsInput(await draft())));row=await newsAction('editor',row,'submit');row=await newsAction('reviewer',row,'approve');
  await assert.rejects(newsAction('editor',row,'schedule'),/WORKFLOW_RIGHTS_EXPIRED|WORKFLOW_INVALID_SCHEDULE/);
  assert.equal(await value('select status from public.studio_scheduled_posts where id=$1',[row.scheduled_post_id]),'draft');
 }
});
test('direct Planner scheduling and deletion cannot bypass a pending approval',async()=>{
 const row=await newsSave('editor',newsInput(await draft()));
 await assert.rejects(as('editor','select public.studio_save_post(p_id=>$1,p_content=>$2,p_publish_at=>$3)',[row.scheduled_post_id,'Caption',new Date(Date.now()+3600000).toISOString()]),/WORKFLOW_APPROVAL_REQUIRED/);
 await assert.rejects(as('editor','select public.studio_delete_post($1)',[row.scheduled_post_id]),/WORKFLOW_CANCEL_BEFORE_DELETE/);
 const cancelled=await newsAction('owner',row,'cancel');assert.equal(cancelled.state,'cancelled');
 await as('editor','select public.studio_save_post(p_id=>$1,p_content=>$2)',[row.scheduled_post_id,'Reopened canceled caption']);
 await assert.rejects(as('editor','select public.studio_publish_now($1)',[row.scheduled_post_id]),/WORKFLOW_APPROVAL_REQUIRED/);
 await as('editor','select public.studio_delete_post($1)',[row.scheduled_post_id]);
});
test('a rejected source cannot escape approval by being unlinked from its assignment',async()=>{
 let row=await newsSave('editor',newsInput(await draft()));row=await newsAction('editor',row,'submit');
 row=await newsAction('reviewer',row,'request_changes','Rework the source.');assert.equal(row.can_change_post,false);
 await assert.rejects(newsSave('editor',newsInput(await draft()),row.id,row.version),/WORKFLOW_REVIEWED_POST_LINK_LOCKED/);
 await as('editor','select public.studio_save_post(p_id=>$1,p_content=>$2)',[row.scheduled_post_id,'Corrected source']);
 row=await newsSave('editor',newsInput(row.scheduled_post_id),row.id,row.version);assert.equal(row.can_change_post,false);
 await assert.rejects(newsSave('editor',newsInput(null),row.id,row.version),/WORKFLOW_REVIEWED_POST_LINK_LOCKED/);
});
test('cursor pages are bounded and stable and never repeat the prior cursor row',async()=>{
 for(let i=0;i<3;i++)await newsSave('editor',{...newsInput(null),title:`Assignment ${i}`});
 const first=await list('owner',2);assert.equal(first.items.length,2);assert.equal(first.has_more,true);
 const second=await list('owner',2,first.next_cursor.at,first.next_cursor.id);assert.equal(second.items.length,1);
 assert.equal(first.items.some(r=>r.id===second.items[0].id),false);assert.equal(second.has_more,false);
 await assert.rejects(list('owner',2,first.next_cursor.at,null),/WORKFLOW_INVALID_CURSOR/);
});
test('partnership drafts remain private until an authorized owner/admin proposes them',async()=>{
 let row=await partnerSave('editor');assert.equal((await partners('creator')).items.length,0);
 await assert.rejects(partnerAction('editor',row,'propose'),/WORKFLOW_PERMISSION_DENIED/);
 row=await partnerAction('owner',row,'propose');assert.equal((await partners('creator')).items[0].id,row.id);
 assert.equal((await partners('stranger')).items.length,0);assert.equal(row.paid_promotion_granted,false);
});
test('only the named creator can accept and submit a deliverable',async()=>{
 let row=await partnerSave();row=await partnerAction('owner',row,'propose');
 await assert.rejects(partnerAction('owner',row,'accept'),/WORKFLOW_CREATOR_PERMISSION_REQUIRED/);
 await assert.rejects(partnerAction('stranger',row,'accept'),/WORKFLOW_NOT_FOUND/);
 row=await partnerAction('creator',row,'accept');
 await assert.rejects(deliver(row,'Wrong creator',null,'stranger'),/WORKFLOW_CREATOR_PERMISSION_REQUIRED/);
 row=await deliver(row);assert.equal(row.state,'submitted');assert.equal(row.deliverable_version,1);assert.equal(row.versions[0].content,'An original creator caption.');
});
test('a business cannot grant creator publishing or paid-promotion permission to itself',async()=>{
 const row=await approvedPartnership();
 await assert.rejects(consent(row,'publishing',true,undefined,'owner'),/WORKFLOW_CREATOR_PERMISSION_REQUIRED/);
 await assert.rejects(consent(row,'paid_promotion',true,undefined,'reviewer'),/WORKFLOW_CREATOR_PERMISSION_REQUIRED/);
});
test('publishing and paid-promotion consents are separate, bounded, version-specific and revocable',async()=>{
 let row=await approvedPartnership();
 await assert.rejects(consent(row,'paid_promotion',true,null),/WORKFLOW_PERMISSION_EXPIRY_REQUIRED/);
 row=await consent(row,'publishing',true);assert.equal(row.publishing_granted,true);assert.equal(row.paid_promotion_granted,false);
 row=await consent(row,'paid_promotion',true);assert.equal(row.paid_promotion_granted,true);
 row=await consent(row,'paid_promotion',false,null);assert.equal(row.paid_promotion_granted,false);assert.equal(row.publishing_granted,true);
 await q("update studio_workflow.partnerships set publishing_expires_at=now()-interval '1 second' where id=$1",[row.id]);
 assert.equal((await partners('creator')).items[0].publishing_granted,false);
});
test('creator feedback creates a new deliverable version and clears prior review state',async()=>{
 let row=await partnerSave();row=await partnerAction('owner',row,'propose');row=await partnerAction('creator',row,'accept');row=await deliver(row);
 await assert.rejects(partnerAction('editor',row,'approve'),/WORKFLOW_PERMISSION_DENIED/);
 row=await partnerAction('reviewer',row,'request_changes','Please adjust the opening.');assert.equal(row.can_deliver,false,'Business view does not impersonate creator');
 row=await deliver(row,'Revised opening.');assert.equal(row.deliverable_version,2);assert.equal(row.versions.length,2);assert.equal(row.approved_by,null);assert.equal(row.paid_promotion_granted,false);
});
test('approval does not activate an ad, publish a post, or create financial transactions',async()=>{
 const before={posts:await value('select count(*) from public.posts'),promos:await value('select count(*) from public.promoted_posts'),payments:await value('select count(*) from public.chat_payments')};
 const row=await approvedPartnership();assert.equal(row.publishing_granted,false);assert.equal(row.paid_promotion_granted,false);
 assert.deepEqual({posts:await value('select count(*) from public.posts'),promos:await value('select count(*) from public.promoted_posts'),payments:await value('select count(*) from public.chat_payments')},before);
});
test('team roles cannot be changed through direct Data API updates or code creation bypasses',async()=>{
 await assert.rejects(as('support',"update public.business_access_members set role='owner' where id=$1 returning id",[actors.support.member]),/permission denied/);
 await assert.rejects(as('support',"select public.create_business_access_member('Injected owner')"),/WORKFLOW_PERMISSION_DENIED/);
 await assert.rejects(as('support',"select public.studio_create_member('Injected owner','owner')"),/WORKFLOW_PERMISSION_DENIED/);
});
test('same-name member creation changes only the new identity and never returns stored code hashes',async()=>{
 const first=await as('owner',"select public.studio_create_member('Repeated name','editor')");
 const second=await as('owner',"select public.studio_create_member('Repeated name','admin')");
 assert.notEqual(first,second);assert.match(first,/^[0-9A-F]{6}(?:-[0-9A-F]{6}){3}$/);
 const rows=await q("select role from public.business_access_members where display_name='Repeated name' order by created_at");assert.deepEqual(rows.map(x=>x.role),['editor','admin']);
 const settings=await as('owner','select public.studio_get_business()');assert.equal(JSON.stringify(settings).includes('code_hash'),false);assert.equal(settings.activity.length,2);
});
test('a business must bootstrap its first owner explicitly and binds the creating session',async()=>{
 await assert.rejects(as('bootstrap',"select public.studio_create_member('First admin','admin')"),/WORKFLOW_FIRST_MEMBER_MUST_BE_OWNER/);
 await as('bootstrap',"select public.studio_create_member('First owner','owner')");
 const context=await as('bootstrap','select public.studio_me()');assert.equal(context.role,'owner');assert.ok(context.member_id);
});
test('last-owner protection prevents demotion, deactivation and empty-team privilege fallback',async()=>{
 await assert.rejects(as('owner',"select public.studio_set_member_role($1,'editor')",[actors.owner.member]),/WORKFLOW_LAST_OWNER/);
 await assert.rejects(as('owner','select public.studio_set_member_active($1,false)',[actors.owner.member]),/WORKFLOW_LAST_OWNER/);
 await q('update public.business_access_members set active=false where business_id=$1',[users.business]);
 assert.equal(await as('owner','select public.studio_role()'),null);
 await assert.rejects(list(),/WORKFLOW_MEMBER_ACCESS_REQUIRED/);
});
test('revocation removes session membership and prevents successful command receipt replay',async()=>{
 const post=await draft(),input=newsInput(post),key=randomUUID();await newsSave('editor',input,null,null,key);
 await as('owner','select public.studio_set_member_active($1,false)',[actors.editor.member]);
 assert.equal(await value('select count(*)::int from public.studio_session_members where member_id=$1',[actors.editor.member]),0);
 await assert.rejects(newsSave('editor',input,null,null,key),/WORKFLOW_MEMBER_ACCESS_REQUIRED/);
});
test('device management requires a live administrative member and preserves a removed registration',async()=>{
 const id=await value("insert into public.business_devices(business_id,device_id,status) values($1,'test-device','approved') returning id",[users.business]);
 await assert.rejects(as('support',"select public.studio_set_device($1,'approve')",[id]),/WORKFLOW_PERMISSION_DENIED/);
 await as('reviewer',"select public.studio_set_device($1,'remove')",[id]);
 assert.equal(await value('select status from public.business_devices where id=$1',[id]),'pending');
 assert.equal((await as('editor','select public.studio_get_business()')).devices.length,0);
});

test('newsroom detail returns the exact linked creative independently of latest Planner pagination',async()=>{
 const row=await newsSave('editor',newsInput(await draft('editor','The actual caption under review')));
 const detail=await as('reviewer','select public.studio_newsroom_get($1)',[row.id]);
 assert.equal(detail.post.id,row.scheduled_post_id);assert.equal(detail.post.content,'The actual caption under review');
 assert.equal((await list()).items[0].post,undefined);
 await assert.rejects(as('other','select public.studio_newsroom_get($1)',[row.id]),/WORKFLOW_NOT_FOUND/);
 await assert.rejects(as('support','select public.studio_newsroom_get($1)',[row.id]),/WORKFLOW_PERMISSION_DENIED/);
 await assert.rejects(list('creator'),/WORKFLOW_BUSINESS_REQUIRED/);
});
test('partnership lists are bounded while participant detail retains revision and review history',async()=>{
 let row=await partnerSave();row=await partnerAction('owner',row,'propose');row=await partnerAction('creator',row,'accept');row=await deliver(row);
 row=await partnerAction('reviewer',row,'request_changes','Revise the caption.');row=await deliver(row,'Second revision');
 const compact=(await partners('creator')).items[0];assert.equal(compact.versions.length,1);assert.equal(compact.events.length,1);
 const detail=await as('creator','select public.studio_partnership_get($1)',[row.id]);assert.equal(detail.versions.length,2);assert.ok(detail.events.length>1);
 await assert.rejects(as('stranger','select public.studio_partnership_get($1)',[row.id]),/WORKFLOW_NOT_FOUND/);
});
test('a blocked creator can withdraw or revoke consent but new consent and deliverables stop',async()=>{
 let row=await approvedPartnership();row=await consent(row,'publishing',true);
 await q('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[users.creator,users.business]);
 await assert.rejects(consent(row,'paid_promotion',true),/WORKFLOW_PARTICIPANT_UNAVAILABLE/);
 row=await consent(row,'publishing',false,null);assert.equal(row.publishing_granted,false);
 assert.equal(row.can_withdraw,true);row=await partnerAction('creator',row,'withdraw');assert.equal(row.state,'cancelled');
 assert.equal(row.paid_promotion_granted,false);assert.ok(row.events.some(e=>e.action==='withdraw'));
});
test('new team clients fence the expected business atomically before code creation',async()=>{
 await assert.rejects(as('owner','select public.studio_create_member($1,$2,$3)',[users.other_business,'Wrong account','editor']),/WORKFLOW_ACTIVE_SESSION_REQUIRED/);
 const code=await as('owner','select public.studio_create_member($1,$2,$3)',[users.business,'Expected account','editor']);
 assert.match(code,/^[0-9A-F]{6}(?:-[0-9A-F]{6}){3}$/);
 assert.equal(await value("select count(*)::int from public.business_access_members where display_name='Wrong account'"),0);
});

test('the actual due publisher creates the approved post once and rejects duplicate worker delivery',async()=>{
 let row=await newsSave('editor',newsInput(await draft('editor','Approved publication')));
 row=await newsAction('editor',row,'submit');row=await newsAction('reviewer',row,'approve');row=await newsAction('editor',row,'schedule');
 // Advance only the disposable fixture schedule to exercise the real publisher
 // without sleeping or altering the provider clock.
 await q("update studio_workflow.newsroom set publish_at=now()-interval '1 minute' where id=$1",[row.id]);
 await q('update public.studio_scheduled_posts set publish_at=(select publish_at from studio_workflow.newsroom where id=$1) where id=$2',[row.id,row.scheduled_post_id]);
 await assert.rejects(as('editor','select public.studio_publish_row($1)',[row.scheduled_post_id]),/permission denied/);
 const postId=await as(null,'select public.studio_publish_row($1)',[row.scheduled_post_id],'service_role');assert.ok(postId);
 assert.equal(await value('select content from public.posts where id=$1',[postId]),'Approved publication');
 await assert.rejects(as(null,'select public.studio_publish_row($1)',[row.scheduled_post_id],'service_role'),/WORKFLOW_ALREADY_PUBLISHED/);
 assert.equal(await value('select count(*)::int from public.posts where user_id=$1',[users.business]),1);
 assert.equal((await as('reviewer','select public.studio_newsroom_get($1)',[row.id])).published_post_id,postId);
});

test('creator consent applies to the submitted source and becomes ineffective after that post changes or disappears',async()=>{
 const post=await value("insert into public.posts(user_id,content,audience) values($1,'Original source','everyone') returning id",[users.creator]);
 let row=await partnerSave();row=await partnerAction('owner',row,'propose');row=await partnerAction('creator',row,'accept');row=await deliver(row,'Version one',post);
 row=await partnerAction('reviewer',row,'approve');row=await consent(row,'paid_promotion',true);assert.equal(row.source_unchanged,true);
 await q("update public.posts set content='Unreviewed change' where id=$1",[post]);
 row=await as('creator','select public.studio_partnership_get($1)',[row.id]);assert.equal(row.paid_promotion_granted,false);assert.equal(row.source_unchanged,false);assert.equal(row.can_deliver,true);
 await assert.rejects(consent(row,'publishing',true),/WORKFLOW_DELIVERABLE_CHANGED/);
 row=await deliver(row,'Version two',post);assert.equal(row.deliverable_version,2);assert.equal(row.paid_promotion_granted,false);
 await q('delete from public.posts where id=$1',[post]);
 await assert.rejects(partnerAction('reviewer',row,'approve'),/WORKFLOW_DELIVERABLE_CHANGED/);
 assert.equal((await as('creator','select public.studio_partnership_get($1)',[row.id])).can_deliver,true);
});

test('creator review covers media edits, alternate text and legacy media while engagement counters stay outside the creative',async()=>{
 const post=await value("insert into public.posts(user_id,content,audience) values($1,'Original source','everyone') returning id",[users.creator]);
 const media=await value("insert into public.post_media(post_id,url,media_type,edit) values($1,'https://example.test/original.mp4','video','{}') returning id",[post]);
 let row=await partnerSave();row=await partnerAction('owner',row,'propose');row=await partnerAction('creator',row,'accept');row=await deliver(row,'Caption',post);
 row=await partnerAction('reviewer',row,'approve');row=await consent(row,'paid_promotion',true);
 await q('update public.posts set likes_count=12,views_count=100 where id=$1',[post]);
 assert.equal((await as('creator','select public.studio_partnership_get($1)',[row.id])).paid_promotion_granted,true);
 await q('update public.post_media set edit=$1 where id=$2',[{coverUrl:'https://example.test/new-cover.jpg',brightness:0.4,audio:{muted:true}},media]);
 assert.equal((await as('creator','select public.studio_partnership_get($1)',[row.id])).source_unchanged,false);
 row=await deliver(row,'New media edit',post);row=await partnerAction('reviewer',row,'approve');
 await q("update public.post_media set alt_text='Revised accessible description' where id=$1",[media]);
 await assert.rejects(consent(row,'paid_promotion',true),/WORKFLOW_DELIVERABLE_CHANGED/);
 row=await deliver(row,'Updated description',post);row=await partnerAction('reviewer',row,'approve');
 await q("update public.posts set media_url='https://example.test/replaced-image.jpg' where id=$1",[post]);
 assert.equal((await as('creator','select public.studio_partnership_get($1)',[row.id])).source_unchanged,false);
});

test('member binding updates the selected identity without a share-to-update lock upgrade',async()=>{
 await q('delete from public.studio_session_members where session_id=$1',[actors.editor.session]);
 const result=await as('editor',"select public.studio_bind_member('TEST-EDITOR')");assert.equal(result.member_id,actors.editor.member);
 assert.equal(await as('editor','select public.studio_role()'),'editor');
 const body=await value("select pg_get_functiondef('public.studio_bind_member(text)'::regprocedure)");
 assert.match(body,/upper\(code_hash\)=v_hash for update/i);
 await assert.rejects(as('editor',"select public.studio_bind_member('WRONG-CODE')"),/Code not recognised/);
 assert.equal(await as('editor','select public.studio_role()'),'editor');
});

test('every actual static web root is unavailable as a new username and guarded on direct profile writes',async()=>{
 const routes=(await readdir(new URL('../../../web/app/',import.meta.url),{withFileTypes:true})).filter(d=>d.isDirectory()&&!d.name.startsWith('[')&&!d.name.startsWith('(')&&!d.name.startsWith('_')).map(d=>d.name);
 assert.ok(routes.includes('watch'));assert.equal(collisionGuardProved,true);
 for(const route of routes){
  assert.equal(await as(null,'select public.is_username_available($1)',[route],'anon'),false,route);
  await assert.rejects(as('creator','update public.profiles set username=$1 where id=$2 returning username',[route,users.creator]),/reserved for an app page/,route);
 }
 assert.equal(await as('creator',"select public.is_username_available('another_original_name')"),true);
 assert.equal(await as('creator',"select public.is_username_available('workflow_creator')"),false);
});
test('route reservations cover mixed case and whitespace, keep null Auth onboarding intact and do not rename unchanged handles',async()=>{
 for(const name of ['WATCH',' Watch ',' watch '])await assert.rejects(as('creator','update public.profiles set username=$1 where id=$2 returning username',[name,users.creator]),/reserved for an app page/);
 await assert.rejects(as('creator',"insert into public.profiles(id,username) values($1,'watch') returning id",[users.creator]),/reserved for an app page/);
 const fresh=randomUUID();await q("insert into auth.users(id,email) values($1,'watch@example.test')",[fresh]);assert.equal(await value('select username from public.profiles where id=$1',[fresh]),null);
 // Model a grandfathered legacy handle only inside this rolled-back fixture.
 await db.exec('alter table public.profiles disable trigger guard_reserved_web_username');
 await q("update public.profiles set username='watch' where id=$1",[users.creator]);
 await db.exec('alter table public.profiles enable trigger guard_reserved_web_username');
 assert.equal(await as('creator',"update public.profiles set username=username,bio='Updated biography' where id=$1 returning username",[users.creator]),'watch');
 assert.equal(await as('creator',"update public.profiles set username='a_new_creator' where id=$1 returning username",[users.creator]),'a_new_creator');
});
test('route reservation helpers are not callable and anonymous availability is pinned to a safe search path',async()=>{
 for(const role of ['anon','authenticated','service_role'])await assert.rejects(as('creator',"select app_routes.is_reserved_username('watch')",[],role),/permission denied/);
 for(const available of Object.values(routeEvidence.availability))assert.equal(available,false);
 for(const count of Object.values(routeEvidence.collisions))assert.equal(count,0);
 assert.equal(routeEvidence.trigger.enabled,'O');
 const publicFn=routeEvidence.functions.find(f=>f.signature==='is_username_available(text)');assert.equal(publicFn.anon_execute,true);assert.equal(publicFn.app_execute,true);assert.deepEqual(publicFn.search_path,['search_path=""']);
});

test('business provisioning rejects reserved route usernames before reserving or creating any identity',async()=>{
 await q("insert into public.admin_users(user_id,role) values($1,'super_admin')",[users.stranger]);
 const application=await value("insert into public.business_applications(applicant_id,company_name,description,contact_email,desired_username,category) values($1,'Synthetic Business','Only a fixture','business@example.test','watch','education') returning id",[users.creator]);
 const reserve=()=>as(null,'select public.triniti_admin_provision($1,$2,$3,$4,$5,$6)',[users.stranger,actors.stranger.session,randomUUID(),'business',{id:application},'reserve'],'service_role');
 const beforeAuth=await value('select count(*)::int from auth.users'),beforeReservations=await value('select count(*)::int from admin_ops.provisions');
 for(const username of ['watch','HOME',' watch ']){
  await q('update public.business_applications set desired_username=$1 where id=$2',[username,application]);
  await assert.rejects(reserve(),/USERNAME_ALREADY_IN_USE/);
 }
 assert.equal(await value('select count(*)::int from admin_ops.provisions'),beforeReservations);
 assert.equal(await value('select count(*)::int from auth.users'),beforeAuth);
 await q("update public.business_applications set desired_username='original_qa_business' where id=$1",[application]);
 const job=await reserve();assert.equal(job.complete,false);assert.ok(job.auth_user_id);
 assert.equal(await value('select count(*)::int from auth.users'),beforeAuth,'SQL reserve must not manufacture an Auth account');
 assert.equal(provisionRouteEvidence.routeGuard,true);assert.equal(provisionRouteEvidence.owner,'postgres');
 assert.equal(provisionRouteEvidence.acl,'{postgres=X/postgres,service_role=X/postgres}');assert.deepEqual(provisionRouteEvidence.searchPath,['search_path=""']);
});

test('a pending legacy reservation for a web route aborts the provision guard migration for review',async()=>{
 await db.exec(provisionBeforeDefinition);
 await q("insert into admin_ops.provisions(command_key,actor_id,kind,payload,auth_user_id,email,snapshot) values($1,$2,'business','{}',$3,'reserved@example.test','{\"desired_username\":\"watch\"}')",[randomUUID(),users.stranger,randomUUID()]);
 await assert.rejects(db.exec(provisionRouteMigration),/BUSINESS_ROUTE_RESERVATION_PENDING_REVIEW/);
});
