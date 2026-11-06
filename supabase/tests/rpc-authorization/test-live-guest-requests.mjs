import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';
const db=new PGlite({extensions});
const names=['host','viewer','other','producer','blocked','muted','late',...Array.from({length:12},(_,i)=>'guest'+i)];
const actors=Object.fromEntries(names.map(n=>[n,randomUUID()])),sessions=Object.fromEntries(names.map(n=>[n,randomUUID()]));
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
async function as(role,name,sql,args=[]){
 await db.exec('savepoint request');try{
  await db.exec(`set local role ${role}`);const claims={sub:actors[name]||null,role,session_id:sessions[name]||null,is_anonymous:false};
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[claims.sub||'',role,JSON.stringify(claims)]);
  const result=await value(sql,args);await db.exec('reset role;release savepoint request');return result;
 }catch(e){await db.exec('rollback to savepoint request;release savepoint request');throw e;}
}
const command=(name,action,id,payload={},request=randomUUID())=>as('authenticated',name,'select public.live_command($1,$2,$3,$4)',[action,id,JSON.stringify(payload),request]);
const detail=(name,id)=>as('authenticated',name,'select public.live_session($1)',[id]);
const create=async(audience='public',live=true)=>{const id=(await command('host','create',null,{title:'Guest request test',topic:'gaming',audience})).session_id;if(live)await db.query("update live_streams.sessions set state='live' where id=$1",[id]);return id;};
before(async()=>{
 await loadDeployedMediaBaseline(db);await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false');
 // Match the already deployed trigger search path from database_access_hardening.
 await db.exec("alter function public.stamp_notification_account_type() set search_path=pg_catalog,public,extensions,pg_temp");
 for(const n of ['20261103000609_live_portable_control_plane','20261103002858_live_interactivity','20261104022616_live_viewer_presence','20261104052000_live_cancel_stage_cleanup','20261104054700_live_terminal_eject_acknowledgement','20261104175749_live_guest_requests','20261104180010_live_portrait_broadcast','20261104180300_live_approved_guest_sources','20261104180638_live_detail_orientation','20261106031000_live_guest_leave_and_removal','20261106182541_live_guest_decision_notifications','20261106182835_live_host_follow_desired_state'])await db.exec(await source(`supabase/migrations/${n}.sql`));
 for(const name of names){await db.query('insert into auth.users(id,email) values($1,$2)',[actors[name],name+'@example.test']);
  await db.query("insert into public.profiles(id,username,email,full_name,profile_visibility,account_type) values($1,$2,$3,$2,'public','personal') on conflict(id) do update set username=excluded.username,profile_visibility='public'",[actors[name],name,name+'@example.test']);
  await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],actors[name]]);}
 await db.exec('update live_streams.settings set stage_enabled=true,delivery_enabled=true,private_delivery_enabled=true,reminders_enabled=true');
});
after(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
test('request is idempotent, private to requester and host, and grants no stage authority',async()=>{
 const id=await create(),key=randomUUID();assert.equal((await command('viewer','request_join',id,{},key)).status,'pending');assert.equal((await command('viewer','request_join',id,{},key)).duplicate,true);
 assert.equal((await detail('host',id)).join_requests.length,1);assert.equal((await detail('viewer',id)).join_requests.length,0);assert.equal((await detail('other',id)).own_join_request,null);
 assert.equal((await detail('viewer',id)).own_join_request.status,'pending');assert.equal(await value('select count(*) from live_streams.members where session_id=$1',[id]),0);
 await assert.rejects(command('viewer','request_join',id,{user_id:actors.other}),/INVALID_COMMAND_FIELD/);
 await assert.rejects(as('authenticated','viewer','select count(*) from live_streams.guest_requests'),/permission denied/);
 await assert.rejects(as('authenticated','viewer','select live_streams.guest_command($1,$2,$3,$4)',['request_join',id,'{}',randomUUID()]),/permission denied/);
});
test('host accepts a requested guest once and another viewer cannot approve',async()=>{
 const id=await create();await command('viewer','request_join',id);await assert.rejects(command('other','accept_join_request',id,{user_id:actors.viewer}),/ACCESS_DENIED/);
 const key=randomUUID();assert.equal((await command('host','accept_join_request',id,{user_id:actors.viewer},key)).status,'accepted');assert.equal((await command('host','accept_join_request',id,{user_id:actors.viewer},key)).duplicate,true);
 const d=await detail('viewer',id);assert.equal(d.role,'guest');assert.equal(d.invitation.status,'accepted');assert.equal(d.own_join_request.status,'accepted');assert.equal(d.stage.occupied,2);assert.equal((await detail('host',id)).join_requests.length,0);
});
test('decline and cancellation preserve consent and stop repeated requests after a decline',async()=>{
 const id=await create();await command('viewer','request_join',id);await command('viewer','cancel_join_request',id);assert.equal((await detail('viewer',id)).own_join_request.status,'cancelled');
 await command('viewer','request_join',id);await command('host','decline_join_request',id,{user_id:actors.viewer});assert.equal((await detail('viewer',id)).own_join_request.status,'declined');
 await assert.rejects(command('viewer','request_join',id),/JOIN_REQUEST_NOT_AVAILABLE/);assert.equal(await value('select count(*) from live_streams.members where session_id=$1',[id]),0);
});
test('fresh request IDs cannot bypass the request rate limit while already pending',async()=>{
 const id=await create();for(let i=0;i<3;i++)await command('viewer','request_join',id);
 await assert.rejects(command('viewer','request_join',id),/RATE_LIMIT/);
 assert.equal(await value('select count(*) from live_streams.guest_requests where session_id=$1',[id]),1);
});
test('several guests are supported and approvals include host and outstanding invitations in the stage cap',async()=>{
 const id=await create();await db.exec('update live_streams.settings set max_stage_members=4');
 for(const n of ['guest0','guest1']){await command(n,'request_join',id);await command('host','accept_join_request',id,{user_id:actors[n]});}
 await command('host','invite',id,{user_id:actors.guest2,role:'guest'});await command('guest3','request_join',id);
 assert.equal((await detail('host',id)).stage.occupied,4);await assert.rejects(command('host','accept_join_request',id,{user_id:actors.guest3}),/STAGE_FULL/);
 await command('host','remove_member',id,{user_id:actors.guest2});await command('host','accept_join_request',id,{user_id:actors.guest3});assert.equal((await detail('host',id)).stage.available,0);
});
test('request and approval recheck audience, blocks, exclusions, terminal state and removed membership',async()=>{
 const id=await create('followers');await assert.rejects(command('viewer','request_join',id),/LIVE_NOT_AVAILABLE/);
 await db.query('insert into public.follows(follower_id,following_id) values($1,$2)',[actors.viewer,actors.host]);await command('viewer','request_join',id);
 await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[actors.host,actors.viewer]);assert.equal((await detail('host',id)).join_requests.length,0);
 await assert.rejects(command('host','accept_join_request',id,{user_id:actors.viewer}),/JOIN_REQUEST_NOT_AVAILABLE/);
 await db.exec('delete from public.blocked_users');await db.query("update live_streams.sessions set state='ended' where id=$1",[id]);await assert.rejects(command('host','accept_join_request',id,{user_id:actors.viewer}),/STATE_CONFLICT/);
 const publicId=await create();await command('other','request_join',publicId);await command('host','accept_join_request',publicId,{user_id:actors.other});await command('host','remove_member',publicId,{user_id:actors.other});await assert.rejects(command('other','request_join',publicId),/JOIN_REQUEST_NOT_AVAILABLE/);
});
test('scoped realtime authorization rejects other users topics, malformed topics and lost visibility',async()=>{
 const id=await create(),topic=(n)=>'live-guests:'+id+':'+actors[n];assert.equal((await detail('viewer',id)).guest_topic,topic('viewer'));
 assert.equal(await as('authenticated','viewer','select live_streams.guest_can_receive($1)',[topic('viewer')]),true);
 assert.equal(await as('authenticated','viewer','select live_streams.guest_can_receive($1)',[topic('host')]),false);
 assert.equal(await as('authenticated','viewer','select live_streams.guest_can_receive($1)',['live-guests:bad']),false);
 await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[actors.host,actors.viewer]);assert.equal(await as('authenticated','viewer','select live_streams.guest_can_receive($1)',[topic('viewer')]),false);
});
test('Live notifications start only after provider confirmation and exclude blocked, opted-out and late followers',async()=>{
 const id=await create('public',false);for(const n of ['viewer','blocked','muted'])await db.query("insert into public.follows(follower_id,following_id,created_at) values($1,$2,now()-interval '1 hour')",[actors[n],actors.host]);
 await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[actors.host,actors.blocked]);await db.query("update public.profiles set notif_prefs=$2::jsonb where id=$1",[actors.muted,JSON.stringify({all:false})]);
 assert.equal(await value('select live_streams.notification_batch(200)'),0);assert.equal(await value('select count(*) from live_streams.notification_jobs where session_id=$1',[id]),0);
 await db.query("update live_streams.sessions set state='starting' where id=$1",[id]);const instance=await value('select instance_id from live_streams.provider_sessions where session_id=$1',[id]);const event=randomUUID(),time=new Date().toISOString();
 await as('service_role',null,'select public.live_provider_event($1,$2,$3,$4,$5)',[event,instance,'streaming.started',time,'a'.repeat(64)]);
 await db.query("insert into public.follows(follower_id,following_id,created_at) values($1,$2,now()+interval '1 minute')",[actors.late,actors.host]);
 assert.equal(await value('select live_streams.notification_batch(200)'),1);assert.equal(await value('select live_streams.notification_batch(200)'),0);
 await as('service_role',null,'select public.live_provider_event($1,$2,$3,$4,$5)',[event,instance,'streaming.started',time,'a'.repeat(64)]);assert.equal(await value('select live_streams.notification_batch(200)'),0);
 const notifications=(await db.query("select recipient_id,data from public.notifications where type='live_stream'")).rows;assert.equal(notifications.length,1);assert.equal(notifications[0].recipient_id,actors.viewer);assert.equal(notifications[0].data.sessionId,id);
});


test('review: invited producer cannot approve, accepted producer grants only guest',async()=>{
 const id=await create();await command('viewer','request_join',id);
 await command('host','invite',id,{user_id:actors.producer,role:'producer'});
 await assert.rejects(command('producer','accept_join_request',id,{user_id:actors.viewer}),/ACCESS_DENIED/);
 await command('producer','accept_invite',id);
 await assert.rejects(command('producer','accept_join_request',id,{user_id:actors.viewer,role:'host'}),/INVALID_COMMAND_FIELD/);
 await command('producer','accept_join_request',id,{user_id:actors.viewer});
 assert.equal((await detail('viewer',id)).role,'guest');
});
test('review: request IDs cannot switch actions, session, or approval target',async()=>{
 const id=await create(),otherId=await create(),key=randomUUID();
 await command('viewer','request_join',id,{},key);
 await assert.rejects(command('viewer','cancel_join_request',id,{},key),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(command('viewer','request_join',otherId,{},key),/IDEMPOTENCY_CONFLICT/);
 await command('other','request_join',id);const approval=randomUUID();
 await command('host','accept_join_request',id,{user_id:actors.viewer},approval);
 await assert.rejects(command('host','accept_join_request',id,{user_id:actors.other},approval),/IDEMPOTENCY_CONFLICT/);
 assert.equal((await detail('other',id)).role,'viewer');
});
test('review: revoked auth sessions cannot request, cancel, or join the private topic',async()=>{
 const id=await create();await command('viewer','request_join',id);
 await db.query('delete from auth.sessions where id=$1',[sessions.viewer]);
 await assert.rejects(command('viewer','request_join',id),/AUTH_REQUIRED/);
 await assert.rejects(command('viewer','cancel_join_request',id),/AUTH_REQUIRED/);
 assert.equal(await as('authenticated','viewer','select live_streams.guest_can_receive($1)',['live-guests:'+id+':'+actors.viewer]),false);
});
test('review: follow revocation blocks outstanding approval and private topic access',async()=>{
 const id=await create('followers');await db.query('insert into public.follows(follower_id,following_id) values($1,$2)',[actors.viewer,actors.host]);
 await command('viewer','request_join',id);await db.query('delete from public.follows where follower_id=$1 and following_id=$2',[actors.viewer,actors.host]);
 assert.equal((await detail('host',id)).join_requests.length,0);
 await assert.rejects(command('host','accept_join_request',id,{user_id:actors.viewer}),/JOIN_REQUEST_NOT_AVAILABLE/);
 assert.equal(await as('authenticated','viewer','select live_streams.guest_can_receive($1)',['live-guests:'+id+':'+actors.viewer]),false);
});
test('review: removal and terminal state leave historical requests inert',async()=>{
 const id=await create(),key=randomUUID();await command('viewer','request_join',id);
 await command('host','accept_join_request',id,{user_id:actors.viewer},key);
 await command('host','remove_member',id,{user_id:actors.viewer});
 assert.equal((await command('host','accept_join_request',id,{user_id:actors.viewer},key)).duplicate,true);
 assert.equal((await detail('viewer',id)).role,'viewer');
 await command('other','request_join',id);await db.query("update live_streams.sessions set state='ended' where id=$1",[id]);
 assert.equal((await detail('host',id)).join_requests.length,0);
 await assert.rejects(command('host','accept_join_request',id,{user_id:actors.other}),/STATE_CONFLICT/);
 assert.equal(await value("select count(*) from live_streams.members where session_id=$1 and status='accepted'",[id]),0);
});
test('review: maximum twelve includes host and rejects a thirteenth participant',async()=>{
 const id=await create();await db.exec('update live_streams.settings set max_stage_members=12');
 for(let i=0;i<12;i++)await command('guest'+i,'request_join',id);
 for(let i=0;i<11;i++)await command('host','accept_join_request',id,{user_id:actors['guest'+i]});
 await assert.rejects(command('host','accept_join_request',id,{user_id:actors.guest11}),/STAGE_FULL/);
 assert.equal((await detail('host',id)).stage.occupied,12);
 assert.equal(await value("select count(*) from live_streams.members where session_id=$1 and status='accepted'",[id]),11);
});

test('portrait is validated and fixed at broadcast start while existing clients remain landscape',async()=>{
 const prepare=(id,scene,action='start',request=randomUUID())=>as('authenticated','host','select public.live_prepare_control($1,$2,$3,$4,null)',[id,action,request,JSON.stringify(scene)]);
 const portrait=await create('public',false);
 assert.equal((await detail('host',portrait)).output_orientation,null);
 for(const orientation of ['square',null,5])await assert.rejects(prepare(portrait,{preset:'host',orientation}),/INVALID_SCENE/);
 await prepare(portrait,{preset:'host',orientation:'portrait'});
 assert.equal((await detail('host',portrait)).output_orientation,'portrait');
 assert.equal(await value('select output_orientation from live_streams.provider_sessions where session_id=$1',[portrait]),'portrait');
 await db.query("update live_streams.controls set status='accepted' where session_id=$1",[portrait]);
 await db.query("update live_streams.sessions set state='live' where id=$1",[portrait]);
 await prepare(portrait,{preset:'grid',participant_ids:[actors.host]},'scene');
 assert.equal(await value('select output_orientation from live_streams.provider_sessions where session_id=$1',[portrait]),'portrait');
 const context=await as('service_role',null,'select public.live_service_context($1,$2,$3,$4)',[portrait,actors.host,sessions.host,'stage']);
 assert.equal(context.output_orientation,'portrait');
 const landscape=await create('public',false);await prepare(landscape,{preset:'host'});
 assert.equal((await detail('host',landscape)).output_orientation,'landscape');
 assert.equal(await value('select output_orientation from live_streams.provider_sessions where session_id=$1',[landscape]),'landscape');
});

test('automatic guest identities are private, accepted-guest-only and require a current publishing grant',async()=>{
 const id=await create();
 for(const [name,role] of [['viewer','guest'],['producer','producer'],['other','camera']]){
  await command('host','invite',id,{user_id:actors[name],role});await command(name,'accept_invite',id);
  await as('service_role',null,'select public.live_service_context($1,$2,$3,$4)',[id,actors[name],sessions[name],'stage']);
 }
 const identity=await value('select provider_identity from live_streams.members where session_id=$1 and user_id=$2',[id,actors.viewer]);
 assert.deepEqual((await detail('host',id)).stage_guest_identities,[identity]);
 assert.deepEqual((await detail('producer',id)).stage_guest_identities,[identity]);
 assert.deepEqual((await detail('viewer',id)).stage_guest_identities,[]);
 await db.query('update live_streams.stage_grants set revoked_at=now() where session_id=$1 and user_id=$2',[id,actors.viewer]);
 assert.deepEqual((await detail('host',id)).stage_guest_identities,[]);
});

test('an accepted guest can leave the stage: the place frees, the grant is revoked, an eject is queued and a later request is allowed',async()=>{
 const id=await create();await command('viewer','request_join',id);await command('host','accept_join_request',id,{user_id:actors.viewer});
 assert.equal((await detail('host',id)).stage.occupied,2);
 const identity=await value('select provider_identity from live_streams.members where session_id=$1 and user_id=$2',[id,actors.viewer]);
 await db.query("insert into live_streams.stage_grants(session_id,user_id,auth_session_id,provider_identity,expires_at) values($1,$2,$3,$4,now()+interval '6 hours')",[id,actors.viewer,sessions.viewer,identity]);
 await db.query("update live_streams.provider_sessions set published_participants=jsonb_build_array(jsonb_build_object('provider_identity',$2::text)) where session_id=$1",[id,identity]);
 await assert.rejects(command('host','leave_stage',id),/ACCESS_DENIED/);
 await assert.rejects(command('other','leave_stage',id),/STATE_CONFLICT/);
 assert.equal((await command('viewer','leave_stage',id)).ok,true);
 assert.equal((await detail('host',id)).stage.occupied,1);assert.equal((await detail('viewer',id)).role,'viewer');
 assert.equal(await value('select count(*) from live_streams.stage_grants where session_id=$1 and user_id=$2 and revoked_at is null',[id,actors.viewer]),0);
 assert.equal(await value("select count(*) from live_streams.provider_outbox where session_id=$1 and action='eject' and provider_identity=$2",[id,identity]),1);
 assert.deepEqual(await value('select published_participants from live_streams.provider_sessions where session_id=$1',[id]),[]);
 const after=await detail('viewer',id);assert.equal(after.own_join_request.status,'cancelled');assert.equal(after.can_request_join,true);
 assert.equal((await command('viewer','request_join',id)).status,'pending');
});
test('removing a guest who is on air frees the published layout and revokes the grant instead of ending the broadcast',async()=>{
 const id=await create();await command('viewer','request_join',id);await command('host','accept_join_request',id,{user_id:actors.viewer});
 const identity=await value('select provider_identity from live_streams.members where session_id=$1 and user_id=$2',[id,actors.viewer]);
 await db.query("insert into live_streams.stage_grants(session_id,user_id,auth_session_id,provider_identity,expires_at) values($1,$2,$3,$4,now()+interval '6 hours')",[id,actors.viewer,sessions.viewer,identity]);
 await db.query("update live_streams.provider_sessions set published_participants=jsonb_build_array(jsonb_build_object('provider_identity',$2::text),jsonb_build_object('provider_identity','host-identity')) where session_id=$1",[id,identity]);
 await command('host','remove_member',id,{user_id:actors.viewer});
 assert.equal(await value('select count(*) from live_streams.stage_grants where session_id=$1 and user_id=$2 and revoked_at is null',[id,actors.viewer]),0);
 assert.deepEqual(await value('select published_participants from live_streams.provider_sessions where session_id=$1',[id]),[{provider_identity:'host-identity'}]);
 assert.equal(await value("select count(*) from live_streams.provider_outbox where session_id=$1 and action='eject' and provider_identity=$2",[id,identity]),1);
 assert.equal(await value("select count(*) from live_streams.provider_outbox where session_id=$1 and action='stop'",[id]),0);
 assert.equal(await value('select state from live_streams.sessions where id=$1',[id]),'live');
});

test('guest approvals and declines persist exactly once without titles, messages, credentials or stage authority in their payload',async()=>{
 const id=await create(),req=randomUUID(),key=randomUUID();
 const alerts=()=>db.query("select recipient_id,actor_id,message,data from public.notifications where type='live_stream' and data->>'live_session_id'=$1",[id]).then(x=>x.rows);
 await command('viewer','request_join',id,{},req);assert.deepEqual(await alerts(),[]);
 await command('host','accept_join_request',id,{user_id:actors.viewer},key);await command('host','accept_join_request',id,{user_id:actors.viewer},key);
 const [saved]=await alerts();assert.equal((await alerts()).length,1);assert.equal(saved.actor_id,null);assert.equal(saved.recipient_id,actors.viewer);
 assert.deepEqual(saved.data,{kind:'guest_accepted',live_session_id:id,recipient_id:actors.viewer});assert.match(saved.message,/accepted/);
 const retry=randomUUID();await command('other','request_join',id);await command('host','decline_join_request',id,{user_id:actors.other},retry);await command('host','decline_join_request',id,{user_id:actors.other},retry);
 const rows=await alerts();assert.equal(rows.length,2);assert.equal(rows.find(r=>r.recipient_id===actors.other).data.kind,'guest_declined');assert.equal((await detail('other',id)).role,'viewer');
});
test('withdrawn requests and silenced, restricted or no-longer-visible requesters never receive decision notifications',async()=>{
 const id=await create();
 await db.query("update public.profiles set notif_prefs='{\"updates\":false}' where id=$1",[actors.viewer]);await command('viewer','request_join',id);await command('host','accept_join_request',id,{user_id:actors.viewer});
 await command('other','request_join',id);await command('other','cancel_join_request',id);
 await command('blocked','request_join',id);await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[actors.host,actors.blocked]);await command('host','decline_join_request',id,{user_id:actors.blocked});
 await command('muted','request_join',id);await db.query('insert into public.user_restrictions(restrictor_id,restricted_id) values($1,$2)',[actors.muted,actors.host]);await command('host','decline_join_request',id,{user_id:actors.muted});
 assert.equal(await value("select count(*) from public.notifications where type='live_stream' and data->>'live_session_id'=$1",[id]),0);
});
test('live follow desired state never toggles on replay; private host remains a request and unfollow removes both',async()=>{
 const id=await create();const follow=(wanted,target=actors.host)=>as('authenticated','viewer','select public.set_live_host_follow_v1($1,$2,$3)',[id,target,wanted]);
 await assert.rejects(follow(true,actors.other),/LIVE_NOT_AVAILABLE/);
 assert.deepEqual(await follow(true),{state:'following'});assert.deepEqual(await follow(true),{state:'following'});
 assert.equal(await value('select count(*) from public.follows where follower_id=$1 and following_id=$2',[actors.viewer,actors.host]),1);
 assert.deepEqual(await follow(false),{state:'none'});assert.deepEqual(await follow(false),{state:'none'});
 await db.query("update public.profiles set profile_visibility='private' where id=$1",[actors.host]);
 assert.deepEqual(await follow(true),{state:'requested'});assert.deepEqual(await follow(true),{state:'requested'});
 assert.equal(await value('select count(*) from public.follows where follower_id=$1 and following_id=$2',[actors.viewer,actors.host]),0);
 assert.equal(await value("select count(*) from public.follow_requests where requester_id=$1 and target_id=$2 and status='pending'",[actors.viewer,actors.host]),1);
 assert.deepEqual(await follow(false),{state:'none'});assert.equal(await value('select count(*) from public.follow_requests where requester_id=$1 and target_id=$2',[actors.viewer,actors.host]),0);
});
test('room follow rejects self, both block directions, removed access and expired sessions',async()=>{
 const id=await create();const f=(who='viewer')=>as('authenticated',who,'select public.set_live_host_follow_v1($1,$2,true)',[id,actors.host]);await assert.rejects(f('host'),/INVALID_FOLLOW_TARGET/);
 for(const [a,b] of [[actors.host,actors.viewer],[actors.viewer,actors.host]]){await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[a,b]);await assert.rejects(f(),/LIVE_NOT_AVAILABLE/);await db.query('delete from public.blocked_users where blocker_id=$1 and blocked_id=$2',[a,b]);}
 await db.query("update live_streams.sessions set audience='invite' where id=$1",[id]);await assert.rejects(f(),/LIVE_NOT_AVAILABLE/);
 await db.query("update live_streams.sessions set audience='public' where id=$1",[id]);await db.query('delete from auth.sessions where id=$1',[sessions.viewer]);await assert.rejects(f(),/AUTH_REQUIRED/);
 assert.equal(await value("select has_function_privilege('anon','public.set_live_host_follow_v1(uuid,uuid,boolean)','execute')"),false);
});
