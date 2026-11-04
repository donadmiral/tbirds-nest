const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {LocalPsqlSession}=require('./local-psql-session.cjs');
const real=Boolean(process.env.PC_TEST_PSQL);
const migration=fs.readFileSync(path.join(__dirname,'../migrations/20261104052000_live_cancel_stage_cleanup.sql'),'utf8');
const terminalMigration=fs.readFileSync(path.join(__dirname,'../migrations/20261104054700_live_terminal_eject_acknowledgement.sql'),'utf8');
const signatures=['live_streams.command(text,uuid,jsonb,uuid)','live_streams.service_context(uuid,uuid,uuid,text,uuid)','live_streams.maintenance(integer)'];
const fingerprints=['d544b435226623ee29cb47c6717f040d','b8e88130f9706a3cfe8356de3e65ac9e','7681b26d56db36c1a16af7a8b35fdaaf'];
const actors=Object.fromEntries(['host','guest','outsider'].map(name=>[name,randomUUID()]));
const sessions=Object.fromEntries(Object.keys(actors).map(name=>[name,randomUUID()]));
const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
const json=value=>quote(JSON.stringify(value))+'::jsonb';
let db,admin,a,b,aPid,bPid,beforeMetadata,afterMetadata,beforeAccounts,afterAccounts,originals;
const exec=(sql,client=admin)=>real?client.query(sql):db.exec(sql);
async function rows(sql,client=admin){
 return real?JSON.parse(await client.query(`select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (${sql}) q;`)):(await db.query(sql)).rows;
}
const value=async(sql,client=admin)=>Object.values((await rows(sql,client))[0]??{})[0];
const login=(role,name,authSession=sessions[name])=>`set local role ${role};do $claims$ begin
 perform set_config('request.jwt.claim.sub',${quote(actors[name]||'')},true);
 perform set_config('request.jwt.claim.role',${quote(role)},true);
 perform set_config('request.jwt.claims',${quote(JSON.stringify({sub:actors[name]||null,role,session_id:authSession||null,is_anonymous:false}))},true);
end $claims$;`;
async function as(role,name,work,client=admin,authSession=sessions[name]){
 await exec('savepoint request',client);
 try{
  await exec(login(role,name,authSession),client);
  const result=await work(client);
  await exec('reset role;set local role postgres;release savepoint request',client);
  return result;
 }catch(error){await exec('rollback to savepoint request;release savepoint request',client);throw error;}
}
const commandExpr=(action,id,payload={},request=randomUUID())=>`public.live_command(${quote(action)},${id?quote(id)+'::uuid':'null'},${json(payload)},${quote(request)}::uuid)`;
const stageExpr=(name,id,authSession=sessions[name])=>`public.live_service_context(${quote(id)},${quote(actors[name])},${quote(authSession)},'stage',null)`;
const command=(name,action,id,payload={},request=randomUUID())=>as('authenticated',name,client=>value('select '+commandExpr(action,id,payload,request),client));
async function preview(withGuest=false){
 const id=(await command('host','create',null,{title:'Cancellation contract',topic:'irl',audience:'invite'})).session_id;
 await as('authenticated','host',client=>value(`select public.live_provider_access(${quote(id)},'stage')`,client));
 if(withGuest){await command('host','invite',id,{user_id:actors.guest,role:'guest'});await command('guest','accept_invite',id);}
 return id;
}
const stage=(name,id,authSession=sessions[name])=>as('service_role',null,client=>value('select '+stageExpr(name,id,authSession),client));
const maintain=()=>as('service_role',null,client=>value('select public.live_maintenance(1000)',client));
const deniedSql=(expression,message)=>`do $denied$ begin begin perform ${expression};raise exception 'UNEXPECTED_SUCCESS';
 exception when others then if sqlerrm !~ ${quote(message)} then raise;end if;end;end $denied$;`;
const denied=(role,name,expression,message)=>as(role,name,client=>exec(deniedSql(expression,message),client));
const observe=id=>value(`select jsonb_build_object(
 'state',s.state,'started_at',s.started_at,'ended_at',s.ended_at,'updated_at',s.updated_at,'replay_available',s.replay_available,
 'grants',(select count(*) from live_streams.stage_grants where session_id=s.id),
 'unrevoked',(select count(*) from live_streams.stage_grants where session_id=s.id and revoked_at is null),
 'ejects',(select count(*) from live_streams.provider_outbox where session_id=s.id and action='eject'),
 'stops',(select count(*) from live_streams.provider_outbox where session_id=s.id and action='stop'),
 'controls',(select count(*) from live_streams.controls where session_id=s.id),
 'provider_events',(select count(*) from live_streams.provider_events where session_id=s.id),
 'notifications',(select count(*) from public.notifications),
 'cancel_audits',(select count(*) from live_streams.audit where session_id=s.id and action='cancel'))
 from live_streams.sessions s where s.id=${quote(id)}`);
async function metadata(){return rows(`select p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,
 p.proacl::text acl,p.proconfig config,p.prosecdef security_definer,p.provolatile volatility
 from pg_proc p where p.oid in(${signatures.map(name=>quote(name)+'::regprocedure').join(',')}) order by signature`);}
async function accounts(){return value(`select jsonb_build_object(
 'users',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u),
 'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
 'sessions',(select jsonb_agg(to_jsonb(s) order by id) from auth.sessions s),
 'settings',(select to_jsonb(s) from live_streams.settings s where singleton))`);}
function check(name,run){test(name,{timeout:30000},async()=>{
 await exec('begin');try{await run();}finally{await exec('rollback;set role postgres');}
});}

before(async()=>{
 const {extensions}=await import('./rpc-authorization/live-schema-fixture.mjs');
 const {loadDeployedMediaBaseline,source}=await import('./rpc-authorization/deployed-media-baseline.mjs');
 let fixture;
 if(real){
  assert.equal(process.env.PGDATABASE,'pc_scale_live_cancel');
  admin=new LocalPsqlSession();
  assert.equal(await admin.query("select current_database()='pc_scale_live_cancel' and inet_server_addr() is null and to_regnamespace('live_streams') is null and to_regnamespace('auth') is null;"),'t');
  await admin.query("do $$begin if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres superuser;end if;end$$;set role postgres;set client_min_messages='warning';set jit=off;");
  // Roles are shared across the existing CI database fixtures. Database objects
  // and all identities below live only in this dedicated Unix-socket database.
  fixture={exec:sql=>admin.query(sql.replace(/create role (anon|authenticated|service_role);/gi,(_all,role)=>
   `do $roles$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end $roles$;`))};
 }else{
  const {PGlite}=require('./rpc-authorization/node_modules/@electric-sql/pglite');
  db=new PGlite({extensions});fixture=db;
 }
 await loadDeployedMediaBaseline(fixture);
 await exec('alter table auth.users add column if not exists is_anonymous boolean default false');
 for(const name of ['20261103000609_live_portable_control_plane','20261103002858_live_interactivity','20261104022616_live_viewer_presence'])await exec(await source(`supabase/migrations/${name}.sql`));
 for(const name of Object.keys(actors))await exec(`insert into auth.users(id,email) values(${quote(actors[name])},${quote('cancel-'+name+'@example.test')});
  insert into public.profiles(id,username,email,full_name,profile_visibility,account_type)
  values(${quote(actors[name])},${quote('cancel_'+name)},${quote('cancel-'+name+'@example.test')},${quote(name)},'public','personal')
  on conflict(id) do update set username=excluded.username,full_name=excluded.full_name,profile_visibility='public';
  insert into auth.sessions(id,user_id,aal) values(${quote(sessions[name])},${quote(actors[name])},'aal1');`);
 await exec('update live_streams.settings set stage_enabled=true,delivery_enabled=true,private_delivery_enabled=true');
 originals=[];
 for(let index=0;index<signatures.length;index++){
  assert.equal(await value(`select md5(pg_get_functiondef(${quote(signatures[index])}::regprocedure))`),fingerprints[index]);
  originals.push(await value(`select pg_get_functiondef(${quote(signatures[index])}::regprocedure)`));
 }
 beforeMetadata=await metadata();beforeAccounts=await accounts();
 await exec(migration);
 await exec(terminalMigration);
 afterMetadata=await metadata();afterAccounts=await accounts();
 if(real){
  a=new LocalPsqlSession();b=new LocalPsqlSession();
  for(const client of [admin,a,b])await client.query("set role postgres;set statement_timeout='10s';set jit=off;");
  aPid=Number(await a.query('select pg_backend_pid();'));bPid=Number(await b.query('select pg_backend_pid();'));
  assert.notEqual(aPid,bPid);
 }
});
after(async()=>{if(real)await Promise.all([admin?.close(),a?.close(),b?.close()]);else await db?.close();});

check('guarded install preserves existing identities, settings and function owner/ACL/search path',async()=>{
 assert.deepEqual(afterMetadata,beforeMetadata);assert.deepEqual(afterAccounts,beforeAccounts);
});
check('unexpected function or grant definitions abort before any repair is installed',async()=>{
 const installBody=migration.replace(/^begin;\n/m,'').replace(/\ncommit;\s*$/,'');
 for(const kind of ['definition','grant']){
  for(const definition of originals)await exec(definition);
  if(kind==='definition')await exec(originals[0].replace('#variable_conflict use_variable','#variable_conflict use_variable\n-- unknown revision'));
  else await exec('grant execute on function live_streams.command(text,uuid,jsonb,uuid) to anon');
  const before=await rows(`select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) hash,proacl::text acl from pg_proc where oid in(${signatures.map(name=>quote(name)+'::regprocedure').join(',')}) order by signature`);
  await exec(`do $guard$ begin begin execute ${quote(installBody)};raise exception 'UNEXPECTED_SUCCESS';
   exception when others then if sqlerrm !~ '^LIVE_CANCEL_CLEANUP_BASELINE_DRIFT' then raise;end if;end;end $guard$;`);
  assert.deepEqual(await rows(`select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) hash,proacl::text acl from pg_proc where oid in(${signatures.map(name=>quote(name)+'::regprocedure').join(',')}) order by signature`),before);
  await exec('revoke execute on function live_streams.command(text,uuid,jsonb,uuid) from anon');
 }
});
check('authorized preview cancellation revokes host and guest grants once without manufacturing a broadcast',async()=>{
 const id=await preview(true),otherHostSession=randomUUID();
 await exec(`insert into auth.sessions(id,user_id,aal) values(${quote(otherHostSession)},${quote(actors.host)},'aal1')`);
 await stage('host',id);await stage('host',id,otherHostSession);await stage('guest',id);
 const before=await observe(id);assert.equal(before.grants,3);assert.equal(before.unrevoked,3);
 const key=randomUUID();assert.equal((await command('host','cancel',id,{},key)).ok,true);
 const first=await observe(id);
 assert.equal(first.state,'cancelled');assert.equal(first.started_at,null);assert.ok(first.ended_at);assert.equal(first.replay_available,false);
 assert.equal(first.unrevoked,0);assert.equal(first.ejects,2);assert.equal(first.stops,0);assert.equal(first.controls,0);
 assert.equal(first.provider_events,before.provider_events);assert.equal(first.notifications,before.notifications);assert.equal(first.cancel_audits,1);
 assert.equal((await command('host','cancel',id,{},key)).duplicate,true);assert.deepEqual(await observe(id),first);
 await maintain();assert.deepEqual(await observe(id),first);
});
check('cancellation keeps authorization boundaries and rejects every new stage or start request',async()=>{
 const id=await preview(true);await stage('host',id);await stage('guest',id);
 await denied('authenticated','guest',commandExpr('cancel',id),'ACCESS_DENIED');
 await denied('authenticated','outsider',commandExpr('cancel',id),'LIVE_NOT_AVAILABLE');
 assert.equal((await observe(id)).unrevoked,2);
 await command('host','cancel',id);
 await denied('authenticated','host',`public.live_provider_access(${quote(id)},'stage')`,'ACCESS_DENIED');
 await denied('service_role',null,stageExpr('host',id),'ACCESS_DENIED');
 await denied('service_role',null,stageExpr('guest',id),'ACCESS_DENIED');
 await denied('authenticated','host',`public.live_prepare_control(${quote(id)},'start',${quote(randomUUID())},'{"preset":"host"}'::jsonb,null)`,'STATE_CONFLICT');
 assert.equal((await observe(id)).unrevoked,0);assert.equal((await observe(id)).controls,0);
});
check('existing terminal grants revoke through maintenance without a new stop or provider event',async()=>{
 for(const state of ['cancelled','ended']){
  const id=await preview(true);await stage('host',id);await stage('guest',id);
  await exec(`update live_streams.sessions set state=${quote(state)},ended_at=now(),updated_at=now()-interval '10 minutes' where id=${quote(id)};
   update live_streams.provider_sessions set published_participants=${json([{provider_identity:actors.host}])} where session_id=${quote(id)};`);
  const before=await observe(id);await maintain();const after=await observe(id);
  assert.equal(after.state,state);assert.equal(after.unrevoked,0);assert.equal(after.ejects,2);assert.equal(after.stops,0);
  for(const field of ['started_at','ended_at','updated_at','controls','provider_events','notifications'])assert.equal(after[field],before[field],field);
  await maintain();assert.deepEqual(await observe(id),after);
 }
});
check('valid backstage, starting, live, reconnecting and ending grants remain usable until their existing authority changes',async()=>{
 for(const state of ['backstage','starting','live','reconnecting','ending']){
  const id=await preview();await stage('host',id);
  await exec(`update live_streams.sessions set state=${quote(state)},updated_at=now() where id=${quote(id)};
   update live_streams.provider_sessions set authority_actor_id=${quote(actors.host)},authority_session_id=${quote(sessions.host)},authority_checked_at=null,
    published_participants=${json([{provider_identity:actors.host}])} where session_id=${quote(id)};`);
  const before=await observe(id);await maintain();const after=await observe(id);
  for(const field of ['state','started_at','ended_at','updated_at','unrevoked','ejects','stops','controls','provider_events','notifications'])assert.equal(after[field],before[field],`${state}: ${field}`);
 }
});
check('a previously queued eject is reused when cancellation revokes the matching grant',async()=>{
 const id=await preview();await stage('host',id);
 await exec(`insert into live_streams.provider_outbox(session_id,action,provider_identity) values(${quote(id)},'eject',${quote(actors.host)})`);
 await command('host','cancel',id);const result=await observe(id);assert.equal(result.unrevoked,0);assert.equal(result.ejects,1);assert.equal(result.stops,0);
});

async function terminalFixture(withGuest=false){
 const id=await preview(withGuest);await stage('host',id);if(withGuest)await stage('guest',id);
 await command('host','cancel',id);
 const job=(await rows(`select o.id,o.session_id,ps.instance_id,ps.room_name,o.provider_identity from live_streams.provider_outbox o
  join live_streams.provider_sessions ps on ps.session_id=o.session_id where o.session_id=${quote(id)} and o.provider_identity=${quote(actors.host)} and o.action='eject'`))[0];
 job.lease_id=randomUUID();
 await exec(`update live_streams.sessions set ended_at=clock_timestamp()-interval '4 minutes' where id=${quote(id)};
  update live_streams.stage_grants set revoked_at=clock_timestamp()-interval '4 minutes',expires_at=clock_timestamp()+interval '6 hours'-interval '4 minutes' where session_id=${quote(id)};
  update live_streams.provider_outbox set state='leased',lease_id=${quote(job.lease_id)},lease_until=clock_timestamp()+interval '1 minute',attempts=1 where id=${quote(job.id)};`);
 return job;
}
const terminalExpr=(job,observed='clock_timestamp()',override={})=>{
 const j={...job,...override};return `public.live_finish_terminal_eject(${quote(j.id)},${quote(j.lease_id)},${quote(j.session_id)},${quote(j.instance_id)},${quote(j.room_name)},${quote(j.provider_identity)},${observed})`;
};
const terminalFinish=(job,observed)=>as('service_role',null,client=>value('select '+terminalExpr(job,observed),client));
const terminalAudit=id=>rows(`select actor_id,action,payload from live_streams.audit where session_id=${quote(id)} and action='terminal_stage_absence_confirmed'`);
check('terminal absence completion is service-only and preserves all existing function metadata',async()=>{
 for(const role of ['anon','authenticated','service_role'])for(const name of ['live_streams.finish_terminal_eject','public.live_finish_terminal_eject']){
  assert.equal(await value(`select has_function_privilege(${quote(role)},${quote(name+'(uuid,uuid,uuid,uuid,text,uuid,timestamptz)')},'execute')`),role==='service_role');
 }
 const fn=(await rows("select pg_get_userbyid(proowner) owner,prosecdef,proconfig from pg_proc where oid='live_streams.finish_terminal_eject(uuid,uuid,uuid,uuid,text,uuid,timestamptz)'::regprocedure"))[0];
 assert.equal(fn.owner,'postgres');assert.equal(fn.prosecdef,true);assert.deepEqual(fn.proconfig,['search_path=""']);
 assert.deepEqual(await metadata(),afterMetadata);
});
check('a no-current-call observation before the cutoff fails, and the exact cutoff completes only that lease without changing broadcast history',async()=>{
 const job=await terminalFixture(),id=job.session_id;
 await exec(`update live_streams.sessions set ended_at=clock_timestamp()-interval '3 minutes' where id=${quote(id)}`);
 const cutoff=await value(`select (ended_at+interval '3 minutes')::text from live_streams.sessions where id=${quote(id)}`);
 const before=await observe(id);
 await denied('service_role',null,terminalExpr(job,`${quote(cutoff)}::timestamptz-interval '1 microsecond'`),'TERMINAL_EJECT_TOKEN_WINDOW');
 assert.equal(await value(`select state from live_streams.provider_outbox where id=${quote(job.id)}`),'leased');
 assert.equal((await terminalAudit(id)).length,0);
 const result=await terminalFinish(job,`${quote(cutoff)}::timestamptz`);
 assert.equal(result.ok,true);assert.equal(result.outcome,'no_current_call_after_token_window');assert.equal(result.state,'cancelled');
 assert.equal(await value(`select state from live_streams.provider_outbox where id=${quote(job.id)}`),'done');
 assert.deepEqual(await observe(id),before);
 const audit=await terminalAudit(id);assert.equal(audit.length,1);assert.equal(audit[0].actor_id,actors.host);
 assert.equal(audit[0].payload.no_current_call,true);assert.equal(audit[0].payload.performed_by,'live-maintenance');
 assert.equal(audit[0].payload.actor_kind,'system');assert.equal(audit[0].payload.owner_id,actors.host);
 await denied('service_role',null,terminalExpr(job),'TERMINAL_EJECT_NOT_ELIGIBLE');assert.equal((await terminalAudit(id)).length,1);
});
check('the terminal token barrier includes every session grant revocation and renewal, not only the ejected identity',async()=>{
 const job=await terminalFixture(true),id=job.session_id;
 for(const change of [
  `update live_streams.sessions set ended_at=clock_timestamp() where id=${quote(id)}`,
  `update live_streams.stage_grants set revoked_at=clock_timestamp() where session_id=${quote(id)} and user_id=${quote(actors.guest)}`,
  `update live_streams.stage_grants set expires_at=clock_timestamp()+interval '6 hours' where session_id=${quote(id)} and user_id=${quote(actors.guest)}`,
 ]){
  await exec('savepoint boundary');await exec(change);
  await denied('service_role',null,terminalExpr(job),'TERMINAL_EJECT_TOKEN_WINDOW');
  assert.equal((await terminalAudit(id)).length,0);await exec('rollback to savepoint boundary;release savepoint boundary');
 }
 assert.equal((await terminalFinish(job)).ok,true);
 assert.equal(await value(`select count(*)::integer from live_streams.provider_outbox where session_id=${quote(id)} and state='pending'`),1);
});
check('wrong identity or session scope, stale leases, fresh grant authority and nonterminal states cannot acknowledge an eject',async()=>{
 const job=await terminalFixture(true),id=job.session_id;
 for(const override of [{id:randomUUID()},{lease_id:randomUUID()},{session_id:randomUUID()},{instance_id:randomUUID()},
  {room_name:'pc-live-'+randomUUID().replaceAll('-','')},{provider_identity:actors.outsider}]){
  await denied('service_role',null,terminalExpr(job,undefined,override),'TERMINAL_EJECT_NOT_ELIGIBLE');
 }
 for(const change of [
  `update live_streams.provider_outbox set lease_until=clock_timestamp()-interval '1 second' where id=${quote(job.id)}`,
  `update live_streams.provider_outbox set lease_until=null where id=${quote(job.id)}`,
  `update live_streams.provider_outbox set lease_id=null where id=${quote(job.id)}`,
  `update live_streams.provider_outbox set state='pending' where id=${quote(job.id)}`,
  `update live_streams.provider_outbox set action='stop' where id=${quote(job.id)}`,
  `update live_streams.sessions set ended_at=null where id=${quote(id)}`,
  ...['queued','processing'].map(status=>`insert into live_streams.controls(id,session_id,actor_id,auth_session_id,action,payload,status)
   values(${quote(randomUUID())},${quote(id)},${quote(actors.host)},${quote(sessions.host)},'start','{}'::jsonb,${quote(status)})`),
  `update live_streams.stage_grants set revoked_at=null where session_id=${quote(id)} and user_id=${quote(actors.guest)}`,
  `delete from live_streams.stage_grants where session_id=${quote(id)} and provider_identity=${quote(actors.host)}`,
  ...['backstage','starting','live','reconnecting','ending'].map(state=>`update live_streams.sessions set state=${quote(state)} where id=${quote(id)}`),
 ]){
  await exec('savepoint boundary');await exec(change);
  await denied('service_role',null,terminalExpr(job),'TERMINAL_EJECT_NOT_ELIGIBLE');
  assert.equal((await terminalAudit(id)).length,0);await exec('rollback to savepoint boundary;release savepoint boundary');
 }
 for(const observed of ['null',"clock_timestamp()-interval '21 seconds'","clock_timestamp()+interval '6 seconds'"]){
  await denied('service_role',null,terminalExpr(job,observed),'INVALID_EJECT_EVIDENCE');
 }
 assert.equal(await value(`select state from live_streams.provider_outbox where id=${quote(job.id)}`),'leased');
 assert.equal((await observe(id)).provider_events,0);assert.equal((await observe(id)).stops,0);
});
check('already ended sessions can acknowledge scoped absence without replacing their existing end or replay state',async()=>{
 const job=await terminalFixture();await exec(`update live_streams.sessions set state='ended',replay_available=true where id=${quote(job.session_id)}`);
 const before=await observe(job.session_id);assert.equal((await terminalFinish(job)).state,'ended');assert.deepEqual(await observe(job.session_id),before);
});

async function blockedBy(waiter,blocker){
 const deadline=Date.now()+3000;
 while(Date.now()<deadline){
  if(await admin.query(`select ${blocker}=any(pg_blocking_pids(${waiter}));`)==='t')return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw Error('Expected independent PostgreSQL lock wait was not observed.');
}
async function committedPreview(){await exec('begin');const id=await preview();await exec('commit');return id;}
const concurrent=(name,run)=>test(name,{skip:!real,timeout:20000},run);
concurrent('PostgreSQL: issuance first blocks cancel, then cancellation revokes the committed grant',async()=>{
 const id=await committedPreview();
 try{
  await a.query(`begin;${login('service_role',null)}select ${stageExpr('host',id)};`);
  await b.query(`begin;${login('authenticated','host')}`);
  const pending=b.query('select '+commandExpr('cancel',id)+';');
  await blockedBy(bPid,aPid);await a.query('commit;');await pending;await b.query('commit;');
  const result=await observe(id);assert.equal(result.state,'cancelled');assert.equal(result.grants,1);assert.equal(result.unrevoked,0);assert.equal(result.ejects,1);
  assert.equal(result.stops,0);assert.equal(result.controls,0);assert.equal(result.provider_events,0);assert.equal(result.notifications,0);
 }finally{await Promise.allSettled([a.query('rollback;set role postgres;'),b.query('rollback;set role postgres;')]);}
});
concurrent('PostgreSQL: cancel first blocks issuance, then the stage request sees cancelled and cannot insert a grant',async()=>{
 const id=await committedPreview();
 try{
  await a.query(`begin;${login('authenticated','host')}select ${commandExpr('cancel',id)};`);
  await b.query(`begin;${login('service_role',null)}`);
  const pending=b.query(deniedSql(stageExpr('host',id),'ACCESS_DENIED'));
  await blockedBy(bPid,aPid);await a.query('commit;');await pending;await b.query('commit;');
  const result=await observe(id);assert.equal(result.state,'cancelled');assert.equal(result.grants,0);assert.equal(result.ejects,0);
  assert.equal(result.stops,0);assert.equal(result.controls,0);assert.equal(result.provider_events,0);assert.equal(result.notifications,0);
 }finally{await Promise.allSettled([a.query('rollback;set role postgres;'),b.query('rollback;set role postgres;')]);}
});
concurrent('PostgreSQL: maintenance and provider-event lock ordering finish without a reversed-lock cycle',async()=>{
 const id=await committedPreview();
 await exec('begin');await stage('host',id);
 await exec(`update live_streams.sessions set state='cancelled',ended_at=now() where id=${quote(id)};commit`);
 try{
  // Match the provider-event lock order without fabricating any provider event.
  await a.query(`begin;select session_id from live_streams.provider_sessions where session_id=${quote(id)} for update;`);
  await b.query(`begin;${login('service_role',null)}select public.live_maintenance(1000);`);
  const pending=a.query(`select id from live_streams.sessions where id=${quote(id)} for update;`);
  await blockedBy(aPid,bPid);await b.query('commit;');await pending;await a.query('rollback;');
  const result=await observe(id);assert.equal(result.state,'cancelled');assert.equal(result.unrevoked,0);assert.equal(result.ejects,1);
  assert.equal(result.stops,0);assert.equal(result.controls,0);assert.equal(result.provider_events,0);assert.equal(result.notifications,0);
 }finally{await Promise.allSettled([a.query('rollback;set role postgres;'),b.query('rollback;set role postgres;')]);}
});
concurrent('PostgreSQL: an observation that expires while waiting for a session lock cannot complete the eject',async()=>{
 await exec('begin');const job=await terminalFixture();await exec('commit');
 try{
  await a.query(`begin;select id from live_streams.sessions where id=${quote(job.session_id)} for update;`);
  await b.query(`begin;${login('service_role',null)}`);
  const pending=b.query(deniedSql(terminalExpr(job,"clock_timestamp()-interval '19 seconds'"),'INVALID_EJECT_EVIDENCE'));
  await blockedBy(bPid,aPid);
  await a.query('select pg_sleep(1.1);commit;');await pending;await b.query('commit;');
  assert.equal(await value(`select state from live_streams.provider_outbox where id=${quote(job.id)}`),'leased');
  assert.equal((await terminalAudit(job.session_id)).length,0);
  const result=await observe(job.session_id);assert.equal(result.state,'cancelled');assert.equal(result.stops,0);assert.equal(result.provider_events,0);
 }finally{await Promise.allSettled([a.query('rollback;set role postgres;'),b.query('rollback;set role postgres;')]);}
});
