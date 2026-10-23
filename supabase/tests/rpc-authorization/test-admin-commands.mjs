import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {extensions,loadLiveSchema} from './live-schema-fixture.mjs';
const fullSchema=process.env.ADMIN_SCHEMA_FIXTURE!=='minimal';
const allMigrations=fullSchema&&process.env.ADMIN_ALL_MIGRATIONS!=='0';
const db=new PGlite({extensions});
const tests=[];
const run=async(name,fn)=>{try{await fn();tests.push(name);}catch(e){console.error('Failed case:',name,e.message,e.where||'');throw e;}};
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const one=async(sql,args=[]) => (await q(sql,args))[0];
const actor=randomUUID(),session=randomUUID(),member=randomUUID(),other=randomUUID();
const call=async(op,payload,key=randomUUID(),a=actor,s=session)=>(await one('select public.triniti_platinum_admin_command($1,$2,$3,$4,$5) result',[a,s,key,op,payload])).result;
const provision=async(kind,payload,phase,key=randomUUID())=>(await one('select public.triniti_admin_provision($1,$2,$3,$4,$5,$6) result',[actor,session,key,kind,payload,phase])).result;
const reject=async(fn,message)=>assert.rejects(fn,e=>e.message.includes(message));
const insert=async(table,fields)=>{const names=Object.keys(fields);return (await one(`insert into public.${table}(${names.join(',')}) values(${names.map((_,i)=>'$'+(i+1)).join(',')}) returning id`,Object.values(fields))).id;};
try{
 if(fullSchema){
 await loadLiveSchema(db);
 if(!allMigrations)await db.exec("create schema creator_finance;create table creator_finance.ledger(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),amount_minor bigint);");
 await db.exec("select set_config('request.jwt.claim.role','service_role',false);");
 }else{
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
 create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,deleted_at timestamptz,banned_until timestamptz,updated_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid not null,aal text,not_after timestamptz);
 create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
 create function public.uuid_generate_v4() returns uuid language sql as 'select gen_random_uuid()';`);
 await db.exec(await readFile(new URL('./admin-command-schema.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./admin-command-foreign-keys.sql',import.meta.url),'utf8'));
 await db.exec(`create schema creator_finance; create table creator_finance.ledger(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),amount_minor bigint);
 create function public.triniti_admin_session_check(p_user_id uuid,p_session_id uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id join public.admin_users a on a.user_id=s.user_id
 where s.id=p_session_id and s.user_id=p_user_id and (s.not_after is null or s.not_after>now()) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) and a.active);
 $fn$;`);
 }
 if(allMigrations){
  const files=(await readdir(new URL('../../migrations/',import.meta.url))).filter(n=>/^202610(22|23)\d+.*\.sql$/.test(n)).sort();
  for(const file of files)await db.exec(await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8'));
 }else{
 await db.exec(await readFile(new URL('../../migrations/20261022211835_admin_command_provision_contracts.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../migrations/20261023190316_admin_moderation_removal_guards.sql',import.meta.url),'utf8'));
 }
 for(const [id,email] of [[actor,'admin@example.test'],[member,'member@example.test'],[other,'other@example.test']]){
  await q('insert into auth.users(id,email) values($1,$2)',[id,email]);
  await q('insert into public.profiles(id,email,username) values($1,$2,$3) on conflict(id) do update set username=excluded.username',[id,email,email.split('@')[0]]);
 }
 await q("insert into public.admin_users(user_id,role) values($1,'super_admin')",[actor]);
 await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal2')",[session,actor]);
 await run('anonymous and authenticated cannot invoke privileged RPCs or read receipts',async()=>{
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);
   try{await reject(()=>call('publishAnnouncement',{title:'x',body:'x'}),'permission denied');
    await reject(()=>provision('staff',{},'reserve'),'permission denied');
    await reject(()=>q('select * from admin_ops.commands'),'permission denied');
   }finally{await db.exec('reset role');}
  }
 });
 await run('native session must belong to actor and satisfy AAL2, expiry, active staff',async()=>{
  await reject(()=>call('publishAnnouncement',{title:'x',body:'x'},randomUUID(),other,session),'ACTIVE_ADMIN_SESSION_REQUIRED');
  for(const change of ["aal='aal1'","not_after=now()-interval '1 second'"]){
   await q('update auth.sessions set '+change+' where id=$1',[session]);
   await reject(()=>call('publishAnnouncement',{title:'x',body:'x'}),'ACTIVE_ADMIN_SESSION_REQUIRED');
   await q("update auth.sessions set aal='aal2',not_after=null where id=$1",[session]);
  }
  await q('update public.admin_users set active=false where user_id=$1',[actor]);
  await reject(()=>call('publishAnnouncement',{title:'x',body:'x'}),'ACTIVE_ADMIN_SESSION_REQUIRED');
  await q('update public.admin_users set active=true where user_id=$1',[actor]);
 });
 await run('role matrix denies mutation outside role even with server execution',async()=>{
  await q("update public.admin_users set role='support_agent' where user_id=$1",[actor]);
  await reject(()=>call('suspendUser',{id:member,reason:'x'}),'ADMIN_PERMISSION_DENIED');
  await reject(()=>provision('staff',{email:'x@example.test',role:'support_agent',password_digest:'a'.repeat(64)},'reserve'),'ADMIN_PERMISSION_DENIED');
  await q("update public.admin_users set role='super_admin' where user_id=$1",[actor]);
 });
 await run('database permission matrix matches all published staff roles and client permissions',async()=>{
  const {default:ts}=await import('../../../admin-web/node_modules/typescript/lib/typescript.js');
  const source=await readFile(new URL('../../../admin-web/lib/permissions.ts',import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const permissions=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  const names=['verification','user_moderate','post_moderate','market_moderate','report_post','report_listing','report_user','support','ads','system','business_manage','organization_manage','staff_manage','account_delete','comment_delete'];
  for(const role of permissions.STAFF_ROLES){
   await q('update public.admin_users set role=$1 where user_id=$2',[role,actor]);
   for(const permission of names){
    const check=()=>q('select admin_ops.require_session($1,$2,$3)',[actor,session,permission]);
    if(permissions.canPerform(role,permission))await check();else await reject(check,'ADMIN_PERMISSION_DENIED');
   }
  }
  await q("update public.admin_users set role='super_admin' where user_id=$1",[actor]);
 });
 await run('service role executes only through protected entry points and replay rechecks session',async()=>{
  const key=randomUUID(),payload={title:'Service test',body:'Session verification'};
  await db.exec('set role service_role');
  try{await call('publishAnnouncement',payload,key);await reject(()=>q('select * from admin_ops.commands'),'permission denied');}finally{await db.exec('reset role');}
  await q("update auth.sessions set aal='aal1' where id=$1",[session]);
  await reject(()=>call('publishAnnouncement',payload,key),'ACTIVE_ADMIN_SESSION_REQUIRED');
  await q("update auth.sessions set aal='aal2' where id=$1",[session]);
 });
 await run('single receipt and audit under duplicate concurrent submissions; changed replay denied',async()=>{
  const key=randomUUID(),payload={title:'Announcement',body:'Body'};
  const results=await Promise.all(Array.from({length:6},()=>call('publishAnnouncement',payload,key)));
  assert(results.every(r=>r.command_key===key&&r.target_id===results[0].target_id));
  assert.equal((await one("select count(*)::int n from public.announcements where title='Announcement'")).n,1);
  assert.equal((await one("select count(*)::int n from public.admin_audit_log where action='publishAnnouncement' and after->>'title'='Announcement'")).n,1);
  await reject(()=>call('publishAnnouncement',{...payload,title:'Changed'},key),'COMMAND_KEY_REUSED');
  await call('retireAnnouncement',{id:results[0].target_id});
 });
 await run('audit failure rolls back mutation and retry receipt',async()=>{
  await db.exec("create function public.fail_audit() returns trigger language plpgsql as $$begin raise exception 'AUDIT_UNAVAILABLE'; end$$; create trigger fail_audit before insert on public.admin_audit_log for each row execute function public.fail_audit();");
  const key=randomUUID();await reject(()=>call('publishAnnouncement',{title:'Rollback',body:'x'},key),'AUDIT_UNAVAILABLE');
  assert.equal((await one("select count(*)::int n from public.announcements where title='Rollback'")).n,0);
  assert.equal((await one('select count(*)::int n from admin_ops.commands where command_key=$1',[key])).n,0);
  await db.exec('drop trigger fail_audit on public.admin_audit_log; drop function public.fail_audit();');
 });
 await run('verification review grants and revokes badge, rejects repeated review',async()=>{
  const id=await insert('verification_applications',{applicant_id:member,tier:'public_figure',category:'education'});
  await call('approveApplication',{id});assert.equal((await one('select verified_tier from public.profiles where id=$1',[member])).verified_tier,'public_figure');
  await reject(()=>call('rejectApplication',{id,reason:'x'}),'APPLICATION_NOT_PENDING');
  await call('revokeVerification',{id:member});assert.equal((await one('select is_verified from public.profiles where id=$1',[member])).is_verified,false);
  const second=await insert('verification_applications',{applicant_id:other,tier:'business'});await call('rejectApplication',{id:second,reason:'Unverified documents'});
 });
 await run('moderation suspension revokes sessions; restoration and timed restrictions work',async()=>{
  const ms=randomUUID();await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[ms,member]);
  await call('suspendUser',{id:member,reason:'Policy violation'});
  assert.equal((await one('select count(*)::int n from auth.sessions where user_id=$1',[member])).n,0);
  assert.equal((await one('select banned_until::text b from auth.users where id=$1',[member])).b,'infinity');
  await call('restoreUser',{id:member});assert.equal((await one('select banned_until from auth.users where id=$1',[member])).banned_until,null);
  await call('issueStrike',{uid:member,level:'restrict',days:'7',reason:'Spam'});
  assert((await one('select restricted_until>now() active from public.profiles where id=$1',[member])).active);
  await call('liftRestriction',{uid:member});
  await call('issueStrike',{uid:member,level:'warn',days:'7',reason:'Warning'});
  await reject(()=>call('issueStrike',{uid:member,level:'restrict',days:'91',reason:'Too long'}),'INVALID_RESTRICTION_DAYS');
  await reject(()=>call('suspendUser',{id:actor,reason:'self'}),'ACTIVE_STAFF_DELETION_FORBIDDEN');
 });
 await run('reports bind the reported target and close with schema-valid statuses',async()=>{
  const pid=await insert('posts',{user_id:member}),wrong=await insert('posts',{user_id:other});
  const rid=await insert('post_reports',{reporter_id:other,post_id:pid,reason:'spam'});
  await reject(()=>call('removeReportedPost',{rid,pid:wrong}),'REPORT_TARGET_MISMATCH');
  assert(await one('select id from public.posts where id=$1',[wrong]));
  await call('removeReportedPost',{rid,pid});assert.equal(await one('select id from public.posts where id=$1',[pid]),undefined);
  const dismiss=await insert('post_reports',{reporter_id:member,post_id:wrong,reason:'spam'});await call('dismissReport',{rid:dismiss,table:'post_reports'});
  const ur=await insert('user_reports',{reporter_id:member,reported_id:other,reason:'spam'});await call('resolveUserReport',{rid:ur,outcome:'actioned'});
  assert.equal((await one('select status from public.user_reports where id=$1',[ur])).status,'closed');
  await reject(()=>call('dismissReport',{rid,table:'profiles'}),'INVALID_REPORT_TABLE');
 });
 await run('listing removals preserve records for order history',async()=>{
  const lid=await insert('marketplace_listings',{seller_id:member,title:'Listing',price:12});
  const rid=await insert('listing_reports',{listing_id:lid,reporter_id:other,reason:'spam'});
  await call('removeReportedListing',{rid,lid});assert.equal((await one('select status from public.marketplace_listings where id=$1',[lid])).status,'removed');
  const second=await insert('marketplace_listings',{seller_id:member,title:'Second',price:15});await call('adminRemoveListing',{lid:second});
  const r2=await insert('listing_reports',{listing_id:second,reporter_id:other,reason:'spam'});await call('dismissReport',{rid:r2,table:'listing_reports'});
 });
 await run('post, comment and story removal all execute',async()=>{
  const pid=await insert('posts',{user_id:member});const cid=await insert('post_comments',{user_id:member,post_id:pid,body:'Comment'});
  await call('adminRemoveComment',{cid});await call('adminRemovePost',{pid});
  const sid=await insert('stories',{user_id:member,media_url:'https://example.test/story',media_type:'image'});await call('adminRemoveStory',{sid});
 });
 await run('owners cannot restore removed listings or reuse removed post ids; unchanged retries still succeed',async()=>{
  const lid=await insert('marketplace_listings',{seller_id:member,title:'Removed listing',price:12});
  const pid=await insert('posts',{user_id:member});
  const key=randomUUID();await call('adminRemoveListing',{lid},key);await call('adminRemovePost',{pid});
  await q("select set_config('request.jwt.claim.role','authenticated',false)");
  try{
   await reject(()=>q("update public.marketplace_listings set status='available',hidden_at=null where id=$1",[lid]),'CONTENT_REMOVED_BY_MODERATOR');
   await reject(()=>q('delete from public.marketplace_listings where id=$1',[lid]),'CONTENT_REMOVED_BY_MODERATOR');
   await reject(()=>insert('posts',{id:pid,user_id:member}),'CONTENT_REMOVED_BY_MODERATOR');
  }finally{await q("select set_config('request.jwt.claim.role','service_role',false)");}
  assert.equal((await call('adminRemoveListing',{lid},key)).success,true);
  assert.equal((await one("select count(*)::int n from admin_ops.removals where kind='listing' and content_id=$1",[lid])).n,1);
 });
 await run('support replies are once-only and pending/solved/open transitions clear resolution',async()=>{
  const tid=await insert('support_tickets',{user_id:member,subject:'Help'}),key=randomUUID();
  await call('sendTicketReply',{tid,body:'A response'},key);await call('sendTicketReply',{tid,body:'A response'},key);
  assert.equal((await one('select count(*)::int n from public.support_messages where ticket_id=$1',[tid])).n,1);
  await call('resolveTicket',{rid:tid});assert.equal((await one('select status from public.support_tickets where id=$1',[tid])).status,'solved');
  await call('setTicketStatus',{tid,status:'open'});assert.equal((await one('select resolved_at from public.support_tickets where id=$1',[tid])).resolved_at,null);
 });
 await run('campaign approval cannot manufacture funding or skip review state',async()=>{
  const id=await insert('studio_campaigns',{owner_id:member,name:'Ad',budget:100,status:'submitted'});
  await reject(()=>call('approveCampaign',{id,paid_amount:'100',payment_ref:'fake'}),'INVALID_COMMAND_FIELD');
  await call('approveCampaign',{id});const row=await one('select status,paid_amount from public.studio_campaigns where id=$1',[id]);assert.equal(row.status,'approved');assert.equal(Number(row.paid_amount),0);
  await call('adminEndCampaign',{id});
  const id2=await insert('studio_campaigns',{owner_id:member,name:'Rejected',status:'submitted'});await call('rejectCampaign',{id:id2,reason:'Disallowed content'});
 });
 await run('last super administrator cannot be demoted or deactivated',async()=>{
  await reject(()=>call('setStaffRole',{uid:actor,role:'support_agent'}),'LAST_SUPER_ADMIN');
  await reject(()=>call('deactivateStaff',{uid:actor}),'LAST_SUPER_ADMIN');
  await q("insert into public.admin_users(user_id,role) values($1,'support_agent')",[other]);
  await call('setStaffRole',{uid:other,role:'analyst'});await call('deactivateStaff',{uid:other});
 });
 await run('system settings and blocked phrase commands validate values',async()=>{
  await q("insert into public.feature_flags(key) values('stories')");await call('toggleFlag',{key:'stories',to:'off'});
  assert.equal((await one("select enabled from public.feature_flags where key='stories'")).enabled,false);
  await reject(()=>call('toggleFlag',{key:'stories',to:'maybe'}),'INVALID_FLAG_VALUE');
  await call('addBlockedWord',{word:'  SPAM  '});await call('removeBlockedWord',{word:'spam'});
 });
 await run('organization ownership transfers atomically and archive revokes delegations',async()=>{
  const id=await insert('organizations',{kind:'business',name:'Company'});
  await q("insert into public.org_memberships(org_id,user_id,role) values($1,$2,'owner')",[id,member]);
  await call('adminTransferOwnership',{id,username:'@other'});
  assert.equal((await one('select role from public.org_memberships where org_id=$1 and user_id=$2',[id,other])).role,'owner');
  assert.equal((await one('select role from public.org_memberships where org_id=$1 and user_id=$2',[id,member])).role,'admin');
  await call('archiveOrganization',{id});assert((await one('select archived_at from public.organizations where id=$1',[id])).archived_at);
  await call('restoreOrganization',{id});
 });
 await run('business rejections require pending applications and a reason',async()=>{
  const id=await insert('business_applications',{applicant_id:member,company_name:'Rejected company',description:'x',contact_email:'business@example.test',desired_username:'declined'});
  await reject(()=>call('rejectBusinessApplication',{id,reason:''}),'REASON_REQUIRED');
  await call('rejectBusinessApplication',{id,reason:'Missing registration'});
 });
 await run('two-phase staff provisioning rejects unreserved identities and safely retries completion',async()=>{
  const key=randomUUID(),payload={email:'staff@example.test',role:'support_agent',password_digest:'a'.repeat(64)};
  const job=await provision('staff',payload,'reserve',key);
  assert.equal((await provision('staff',payload,'reserve',key)).auth_user_id,job.auth_user_id);
  await reject(()=>provision('staff',payload,'finish',key),'PROVISION_IDENTITY_MISMATCH');
  await q('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)',[job.auth_user_id,job.email,{triniti_provision_id:randomUUID()}]);
  await reject(()=>provision('staff',payload,'finish',key),'PROVISION_IDENTITY_MISMATCH');
  await q('update auth.users set raw_app_meta_data=$2 where id=$1',[job.auth_user_id,{triniti_provision_id:job.provision_id}]);
  assert((await provision('staff',payload,'finish',key)).complete);assert((await provision('staff',payload,'finish',key)).complete);
  assert.equal((await one('select role from public.admin_users where user_id=$1',[job.auth_user_id])).role,'support_agent');
  await reject(()=>provision('staff',{...payload,role:'super_admin'},'finish',key),'COMMAND_KEY_REUSED');
  assert.equal((await one("select count(*)::int n from public.admin_audit_log where action='inviteStaff' and target_id=$1",[job.auth_user_id])).n,1);
 });
 await run('business provisioning does not take over applicant email and installs delegated ownership',async()=>{
  const id=await insert('business_applications',{applicant_id:member,company_name:'Company',description:'Education',contact_email:'member@example.test',desired_username:'company'});
  const key=randomUUID(),job=await provision('business',{id},'reserve',key);
  assert.notEqual(job.email,'member@example.test');assert(job.email.endsWith('@accounts.platinumcircles.invalid'));
  await reject(()=>call('rejectBusinessApplication',{id,reason:'Concurrent reviewer'}),'APPLICATION_PROVISIONING');
  await q('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)',[job.auth_user_id,job.email,{triniti_provision_id:job.provision_id}]);
  assert((await provision('business',{id},'finish',key)).complete);
  assert.equal((await one('select role from public.business_members where business_id=$1 and member_id=$2',[job.auth_user_id,member])).role,'owner');
  assert.equal((await one('select status from public.business_applications where id=$1',[id])).status,'approved');
 });
 await run('account deletion preserves finance and login identity while revoking access and queuing review',async()=>{
  const victim=randomUUID();await q('insert into auth.users(id,email) values($1,$2)',[victim,'erasure@example.test']);await q('insert into public.profiles(id,email) values($1,$2) on conflict(id) do nothing',[victim,'erasure@example.test']);
  if(allMigrations)await q("insert into creator_finance.ledger(user_id,currency,amount_minor,from_bucket,to_bucket,source_ref,idempotency_key) values($1,'USD',1234,'funding','pending','test-retention','test-retention')",[victim]);else await q('insert into creator_finance.ledger(user_id,amount_minor) values($1,1234)',[victim]);
  const r=await call('adminDeleteAccount',{id:victim,reason:'Requested removal',confirm:'DELETE'});assert.equal(r.deletion_status,'retention_review');
  assert(await one('select id from auth.users where id=$1',[victim]));assert.equal(Number((await one('select amount_minor from creator_finance.ledger where user_id=$1',[victim])).amount_minor),1234);
  const queue=(await one('select public.triniti_admin_deletion_requests($1,$2,1) data',[actor,session])).data;assert.equal(queue.total,1);assert.equal(queue.rows[0].user_id,victim);
  await q("update public.admin_users set role='support_agent' where user_id=$1",[actor]);
  await reject(()=>q('select public.triniti_admin_deletion_requests($1,$2,1)',[actor,session]),'ADMIN_PERMISSION_DENIED');
  await q("update public.admin_users set role='super_admin' where user_id=$1",[actor]);
  await reject(()=>call('restoreUser',{id:victim}),'DELETION_REVIEW_REQUIRED');
  await reject(()=>call('adminDeleteAccount',{id:other,reason:'owner',confirm:'DELETE'}),'TRANSFER_ORGANIZATION_OWNERSHIP_FIRST');
 });
 console.log(JSON.stringify({suite:allMigrations?'admin-commands-integrated':fullSchema?'admin-commands-full-schema':'admin-commands',passed:tests.length,tests,hostedWrites:false,limitations:['PGlite serializes queries; duplicate concurrent submissions exercise idempotency but are not a multi-backend lock/deadlock stress test.','The complete public schema and pending migrations run locally. Managed auth/storage/Vault are fixtures; hosted GoTrue provisioning remains an integration check.']},null,2));
}catch(e){console.error(JSON.stringify({error:e.message,where:e.where,query:e.query,params:e.params}));process.exitCode=1;}finally{await db.close();}
