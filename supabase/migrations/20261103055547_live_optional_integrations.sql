-- Optional integrations are closed until an owner configures real provider apps.
-- No credentials, active gates, subscriptions, or remote publications are created.
create table live_streams.integration_runtime (
 platform text primary key check(platform in ('x','facebook','instagram','youtube','tiktok','transcription')),
 enabled boolean not null default false,
 publishing_enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into live_streams.integration_runtime(platform) values('x'),('facebook'),('instagram'),('youtube'),('tiktok'),('transcription');
create table live_streams.social_connections (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 platform text not null references live_streams.integration_runtime(platform),account_id text,account_name text,
 state text not null default 'disconnected' check(state in ('connected','disconnected','reconnect_required')),
 ciphertext text check(length(ciphertext)<=85000),scopes jsonb not null default '[]',expires_at timestamptz,
 version bigint not null default 1,refresh_lease uuid,refresh_until timestamptz,connected_at timestamptz,updated_at timestamptz not null default now(),
 unique(user_id,platform),check(platform<>'transcription'),check(account_id is null or length(account_id) between 1 and 160),check(account_name is null or length(account_name) between 1 and 160)
);
create table live_streams.oauth_states (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 auth_session_id uuid not null,connection_id uuid not null references live_streams.social_connections(id) on delete cascade,
 platform text not null,state_hash text not null unique check(state_hash~'^[a-f0-9]{64}$'),
 state text not null default 'pending' check(state in ('pending','claimed','selection','selected','finished','failed')),
 ciphertext text check(length(ciphertext)<=85000),expires_at timestamptz not null default now()+interval '10 minutes',created_at timestamptz not null default now()
);
create index oauth_states_actor_expiry on live_streams.oauth_states(user_id,expires_at);
create index oauth_states_connection on live_streams.oauth_states(connection_id);
alter table live_streams.integration_runtime enable row level security;
alter table live_streams.social_connections enable row level security;
alter table live_streams.oauth_states enable row level security;
revoke all on live_streams.integration_runtime,live_streams.social_connections,live_streams.oauth_states from public,anon,authenticated,service_role;

create function public.live_integration_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=live_streams.require_user();sid uuid:=(auth.jwt()->>'session_id')::uuid;
begin
 if not live_streams.publisher_allowed(uid,sid) then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 return jsonb_build_object('user_id',uid,'auth_session_id',sid);
end $$;
create function public.live_oauth_operation(p_actor uuid,p_session uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare plat text:=p_data->>'platform';o live_streams.oauth_states;c live_streams.social_connections;cid uuid;items jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' or p_actor is null or p_session is null or not live_streams.publisher_allowed(p_actor,p_session) then return jsonb_build_object('error','AUTH_REQUIRED');end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>100000 then return jsonb_build_object('error','INVALID_REQUEST');end if;
 if p_action='status' then
  select coalesce(jsonb_agg(jsonb_build_object('platform',r.platform,'enabled',r.enabled,'state',coalesce(s.state,'disconnected'),'account_name',s.account_name,
   'can_publish',r.enabled and r.publishing_enabled and coalesce(s.state='connected',false),'connected_at',s.connected_at,'expires_at',s.expires_at) order by r.platform),'[]') into items
  from live_streams.integration_runtime r left join live_streams.social_connections s on s.platform=r.platform and s.user_id=p_actor where r.platform<>'transcription';
  return jsonb_build_object('items',items,'direct_publishing',exists(select 1 from live_streams.integration_runtime where enabled and publishing_enabled and platform<>'transcription'));
 end if;
 if plat not in ('x','facebook','instagram','youtube','tiktok') or plat is null then return jsonb_build_object('error','INVALID_REQUEST');end if;
 perform pg_advisory_xact_lock(hashtextextended('live-oauth:'||p_actor::text||':'||plat,0));
 if p_action='disconnect' then
  update live_streams.social_connections set state='disconnected',ciphertext=null,refresh_lease=null,refresh_until=null,version=version+1,updated_at=now() where user_id=p_actor and platform=plat;
  update live_streams.oauth_states set state='failed',ciphertext=null where user_id=p_actor and platform=plat and state not in ('finished','failed');
  return jsonb_build_object('ok',true,'state','disconnected','provider_revocation','owner_account_settings');
 end if;
 if not exists(select 1 from live_streams.integration_runtime where platform=plat and enabled) then return jsonb_build_object('error','INTEGRATION_DISABLED');end if;
 if p_action='begin' then
  perform live_streams.take_rate('social_connect',p_actor::text,12,3600);
  delete from live_streams.oauth_states where user_id=p_actor and expires_at<now()-interval '1 day';
  if (select count(*) from live_streams.oauth_states where user_id=p_actor and expires_at>now() and state in ('pending','claimed','selection'))>=5 then return jsonb_build_object('error','ACCOUNT_LIMIT');end if;
  if coalesce(p_data->>'ciphertext','')!~'^v1[.]' or coalesce(p_data->>'state_hash','')!~'^[a-f0-9]{64}$' then return jsonb_build_object('error','INVALID_CIPHERTEXT');end if;
  insert into live_streams.social_connections(user_id,platform) values(p_actor,plat) on conflict(user_id,platform) do nothing;
  select id into cid from live_streams.social_connections where user_id=p_actor and platform=plat;
  insert into live_streams.oauth_states(id,user_id,auth_session_id,connection_id,platform,state_hash,ciphertext) values((p_data->>'id')::uuid,p_actor,p_session,cid,plat,p_data->>'state_hash',p_data->>'ciphertext');
  return jsonb_build_object('ok',true);
 end if;
 if p_action like 'refresh_%' then
  select * into c from live_streams.social_connections where user_id=p_actor and platform=plat for update;
  if not found or c.state<>'connected' then return jsonb_build_object('error','RECONNECT_REQUIRED');end if;
  if p_action='refresh_claim' then
   perform live_streams.take_rate('social_refresh',p_actor::text,12,3600);
   if c.refresh_lease is not null then
    if c.refresh_until>now() then return jsonb_build_object('error','OPERATION_AMBIGUOUS');end if;
    -- A timed-out rotating token exchange must be reconciled by re-consent.
    update live_streams.social_connections set state='reconnect_required',ciphertext=null,refresh_lease=null,refresh_until=null where id=c.id;
    return jsonb_build_object('error','RECONNECT_REQUIRED');
   end if;
   cid:=gen_random_uuid();update live_streams.social_connections set refresh_lease=cid,refresh_until=now()+interval '45 seconds' where id=c.id;
   return jsonb_build_object('id',c.id,'lease_id',cid,'version',c.version,'ciphertext',c.ciphertext);
  end if;
  if c.id is distinct from (p_data->>'id')::uuid or c.refresh_lease is null or c.refresh_lease is distinct from (p_data->>'lease_id')::uuid then return jsonb_build_object('error','STATE_REPLAYED');end if;
  if p_action='refresh_failed' then
   update live_streams.social_connections set state='reconnect_required',ciphertext=null,refresh_lease=null,refresh_until=null,version=version+1 where id=c.id;
   return jsonb_build_object('ok',true);
  elsif p_action='refresh_finish' and c.refresh_until>now() and c.version=(p_data->>'version')::bigint and coalesce(p_data->>'ciphertext','')~'^v1[.]' then
   update live_streams.social_connections set ciphertext=p_data->>'ciphertext',expires_at=(p_data->>'expires_at')::timestamptz,refresh_lease=null,refresh_until=null,version=version+1,updated_at=now() where id=c.id;
   return jsonb_build_object('ok',true,'state','connected');
  end if;
  return jsonb_build_object('error','STATE_EXPIRED');
 end if;
 if p_action='claim' then select * into o from live_streams.oauth_states where state_hash=p_data->>'state_hash' and user_id=p_actor and auth_session_id=p_session and platform=plat for update;
 else select * into o from live_streams.oauth_states where id=(p_data->>'id')::uuid and user_id=p_actor and auth_session_id=p_session and platform=plat for update;end if;
 if not found or o.expires_at<=now() then return jsonb_build_object('error','STATE_EXPIRED');end if;
 if p_action='claim' and o.state='pending' then
  update live_streams.oauth_states set state='claimed' where id=o.id;
  return jsonb_build_object('id',o.id,'connection_id',o.connection_id,'ciphertext',o.ciphertext);
 elsif p_action='selection' and o.state='claimed' and coalesce(p_data->>'ciphertext','')~'^v1[.]' then
  update live_streams.oauth_states set state='selection',ciphertext=p_data->>'ciphertext' where id=o.id;return jsonb_build_object('ok',true);
 elsif p_action='select' and o.state='selection' then
  update live_streams.oauth_states set state='selected' where id=o.id;return jsonb_build_object('id',o.id,'connection_id',o.connection_id,'ciphertext',o.ciphertext);
 elsif p_action='finish' and o.state in ('claimed','selected') then
  if coalesce(p_data->>'ciphertext','')!~'^v1[.]' or coalesce(p_data->>'account_id','')!~'^[a-zA-Z0-9_.-]{1,160}$' or length(coalesce(p_data->>'account_name','')) not between 1 and 160
   or jsonb_typeof(p_data->'scopes') is distinct from 'array' or jsonb_array_length(p_data->'scopes')>20 then return jsonb_build_object('error','PROVIDER_RESPONSE_INVALID');end if;
  update live_streams.social_connections set account_id=p_data->>'account_id',account_name=p_data->>'account_name',state='connected',ciphertext=p_data->>'ciphertext',scopes=p_data->'scopes',
   expires_at=(p_data->>'expires_at')::timestamptz,connected_at=now(),updated_at=now(),version=version+1,refresh_lease=null,refresh_until=null where id=o.connection_id;
  update live_streams.oauth_states set state='finished',ciphertext=null where id=o.id;
  return jsonb_build_object('ok',true,'state','connected','platform',plat,'account_name',p_data->>'account_name','can_publish',false);
 elsif p_action='failed' and o.state in ('claimed','selection','selected') then
  update live_streams.oauth_states set state='failed',ciphertext=null where id=o.id;return jsonb_build_object('ok',true);
 end if;
 return jsonb_build_object('error','STATE_REPLAYED');
end $$;

-- Preserve the existing truthful device-export history; connection is not proof of a post.
create or replace function live_streams.clip_platform_connections(p_cursor jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=live_streams.require_user();ct timestamptz;ci uuid;history jsonb;items jsonb;nc jsonb;
begin
 if p_cursor is not null then ct:=(p_cursor->>'created_at')::timestamptz;ci:=(p_cursor->>'id')::uuid;if ct is null or ci is null then raise exception 'INVALID_CURSOR';end if;end if;
 with candidates as materialized(select id,created_at from live_streams.clip_publications where actor_id=uid and destination in ('x','facebook','instagram','youtube','tiktok')
 and(ct is null or(created_at,id)<(ct,ci)) order by created_at desc,id desc limit 26),page as(select * from candidates order by created_at desc,id desc limit 25)
 select coalesce((select jsonb_agg(live_streams.clip_publication_json(id) order by created_at desc,id desc) from page),'[]'),
 case when(select count(*) from candidates)>25 then(select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)else null end into history,nc;
 select coalesce(jsonb_agg(jsonb_build_object('platform',s.platform,'state',s.state,'account_name',s.account_name,'connected_at',s.connected_at,
  'can_publish',s.state='connected' and coalesce(r.enabled and r.publishing_enabled,false)) order by s.platform),'[]') into items
 from live_streams.social_connections s left join live_streams.integration_runtime r on r.platform=s.platform where s.user_id=uid and s.state<>'disconnected';
 return jsonb_build_object('items',items,'history',history,'next_cursor',nc,'direct_publishing',exists(select 1 from live_streams.integration_runtime where enabled and publishing_enabled and platform<>'transcription'));
end $$;
revoke all on function public.live_integration_context(),public.live_oauth_operation(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.live_integration_context() to authenticated;
grant execute on function public.live_oauth_operation(uuid,uuid,text,jsonb) to service_role;

create table live_streams.transcription_jobs (
 id uuid primary key default gen_random_uuid(),clip_id uuid not null references live_streams.clips(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade,auth_session_id uuid not null,request_id uuid not null,request_payload jsonb not null,
 revision integer not null,object_path text not null,format text not null check(format in ('horizontal','vertical')),duration_ms integer not null check(duration_ms between 1000 and 600000),
 language text not null check(language in ('en-US','en-GB','es-US','fr-FR','de-DE','pt-BR','it-IT','hi-IN','ja-JP','ko-KR','zh-CN','ar-SA')),
 state text not null default 'pending' check(state in ('pending','leased','draft','reviewed','rejected','failed','cancelled')),
 lease_id uuid,lease_until timestamptz,attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 draft jsonb,error_code text,review_payload jsonb,review_result jsonb,reviewer_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(actor_id,request_id),
 check(draft is null or octet_length(draft::text)<=320000)
);
create index transcription_jobs_claim on live_streams.transcription_jobs(next_attempt_at,id) where state in ('pending','leased');
create index transcription_jobs_actor on live_streams.transcription_jobs(actor_id,state,created_at);
create index transcription_jobs_clip on live_streams.transcription_jobs(clip_id,created_at desc,id desc);
create index transcription_jobs_reviewer on live_streams.transcription_jobs(reviewer_id) where reviewer_id is not null;
alter table live_streams.transcription_jobs enable row level security;
revoke all on live_streams.transcription_jobs from public,anon,authenticated,service_role;

-- Provider capacity survives clip/account deletion and an ambiguous AWS Start.
-- No FK cascade may erase a running provider slot or the UTC-day start counter.
create table live_streams.transcription_limits (
 singleton boolean primary key default true check(singleton),
 max_provider_active integer not null default 2 check(max_provider_active between 1 and 2),
 max_daily_starts integer not null default 12 check(max_daily_starts between 1 and 24),
 max_daily_audio_ms integer not null default 900000 check(max_daily_audio_ms between 1000 and 900000)
);
insert into live_streams.transcription_limits(singleton) values(true);
create table live_streams.transcription_reservations (
 id uuid primary key,clip_id uuid not null,format text not null check(format in ('horizontal','vertical')),
 duration_ms integer not null check(duration_ms between 1000 and 600000),language text not null,
 -- Round upward to seconds and reserve an extra second for encoder tolerance.
 -- This is an admission budget, not an estimate of the AWS invoice.
 budget_audio_ms integer generated always as ((((duration_ms+999)/1000)+1)*1000) stored,
 configuration_hash text not null check(configuration_hash~'^[a-f0-9]{64}$'),
 provider_state text not null default 'active' check(provider_state in ('active','terminal')),
 reserved_at timestamptz not null default now(),terminal_at timestamptz,terminal_status text,
 cleanup_lease_id uuid,cleanup_lease_until timestamptz,next_cleanup_at timestamptz not null default now(),
 check(terminal_status is null or terminal_status in ('COMPLETED','FAILED','NOT_FOUND','NOT_SUBMITTED'))
);
create index transcription_reservations_day on live_streams.transcription_reservations(reserved_at);
create index transcription_reservations_active on live_streams.transcription_reservations(next_cleanup_at,id) where provider_state='active';
alter table live_streams.transcription_limits enable row level security;
alter table live_streams.transcription_reservations enable row level security;
revoke all on live_streams.transcription_limits,live_streams.transcription_reservations from public,anon,authenticated,service_role;

create function live_streams.transcription_allowed(p_job live_streams.transcription_jobs) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from live_streams.clips c where c.id=p_job.clip_id and c.state='ready' and c.render_revision=p_job.revision
  and c.output_prefix||p_job.format||'.mp4'=p_job.object_path and c.moderation_state='approved' and c.copyright_state='cleared'
  and live_streams.publisher_allowed(p_job.actor_id,p_job.auth_session_id) and live_streams.can_view(c.session_id,p_job.actor_id)
  and live_streams.clip_can_create(c.session_id,c.creator_id) and (c.creator_id=p_job.actor_id or live_streams.clip_manage(c.session_id,p_job.actor_id))
  and exists(select 1 from storage.objects o where o.bucket_id='live-clips' and o.name=p_job.object_path));
$$;
create function public.live_transcription_command(p_clip_id uuid,p_action text,p_payload jsonb default '{}'::jsonb,p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=live_streams.require_user();sid uuid:=(auth.jwt()->>'session_id')::uuid;c live_streams.clips;j live_streams.transcription_jobs;spec jsonb;result jsonb;fmt text;items jsonb;
begin
 select * into c from live_streams.clips where id=p_clip_id for update;
 if not found or not live_streams.clip_can_read(c.id,uid) or not(c.creator_id=uid or live_streams.clip_manage(c.session_id,uid)) or not live_streams.publisher_allowed(uid,sid) then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>320000 then raise exception 'INVALID_REQUEST';end if;
 if p_action='status' then
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'state',q.state,'language',q.language,'draft',q.draft,'error_code',q.error_code,'created_at',q.created_at,'revision',q.revision) order by q.created_at desc,q.id desc),'[]') into items
  from(select * from live_streams.transcription_jobs where clip_id=c.id order by created_at desc,id desc limit 10) q;
  return jsonb_build_object('items',items,'enabled',(select enabled from live_streams.integration_runtime where platform='transcription'),'requires_review',true);
 end if;
 if p_request_id is null then raise exception 'INVALID_REQUEST';end if;
 if p_action='request' then
  perform pg_advisory_xact_lock(hashtextextended('live-transcription:'||uid::text,0));
  select * into j from live_streams.transcription_jobs where actor_id=uid and request_id=p_request_id;
  if found then
   if j.clip_id<>c.id or j.request_payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return jsonb_build_object('id',j.id,'state',j.state,'duplicate',true);
  end if;
  if not coalesce((select enabled from live_streams.integration_runtime where platform='transcription'),false) then raise exception 'INTEGRATION_DISABLED';end if;
  if p_payload->'consent' is distinct from 'true'::jsonb or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('consent','language','format'))
   or coalesce(p_payload->>'language','') not in ('en-US','en-GB','es-US','fr-FR','de-DE','pt-BR','it-IT','hi-IN','ja-JP','ko-KR','zh-CN','ar-SA') then raise exception 'INVALID_REQUEST';end if;
  fmt:=coalesce(p_payload->>'format',case when c.formats?'horizontal' then 'horizontal' else 'vertical' end);
  if fmt not in ('horizontal','vertical') or not(c.formats?fmt) or c.state<>'ready' or c.moderation_state<>'approved' or c.copyright_state<>'cleared' or not live_streams.clip_can_create(c.session_id,c.creator_id) then raise exception 'CLIP_CHANGED';end if;
  perform live_streams.take_rate('transcription_request',uid::text,5,3600);
  if (select count(*) from live_streams.transcription_jobs where actor_id=uid and state in ('pending','leased'))>=2 then raise exception 'ACCOUNT_LIMIT';end if;
  insert into live_streams.transcription_jobs(clip_id,actor_id,auth_session_id,request_id,request_payload,revision,object_path,format,duration_ms,language)
   values(c.id,uid,sid,p_request_id,p_payload,c.render_revision,c.output_prefix||fmt||'.mp4',fmt,c.end_ms-c.start_ms,p_payload->>'language') returning * into j;
  return jsonb_build_object('id',j.id,'state',j.state);
 end if;
 select * into j from live_streams.transcription_jobs where id=(p_payload->>'id')::uuid and clip_id=c.id for update;
 if not found then raise exception 'INVALID_REQUEST';end if;
 if j.state='reviewed' and j.reviewer_id=uid and j.review_payload=p_payload then return j.review_result||jsonb_build_object('duplicate',true);end if;
 if p_action='reject' and j.state in ('pending','leased','draft') then
  update live_streams.transcription_jobs set state='rejected',draft=null,lease_id=null,lease_until=null,reviewer_id=uid,updated_at=now() where id=j.id;
  return jsonb_build_object('ok',true,'state','rejected');
 end if;
 if p_action<>'review' or j.state<>'draft' or c.render_revision<>j.revision or c.state<>'ready' or p_payload->'reviewed' is distinct from 'true'::jsonb
  or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('id','reviewed','cues','burn_captions')) then raise exception 'REVIEW_REQUIRED';end if;
 spec:=jsonb_build_object('title',c.title,'caption',c.caption,'tags',c.tags,'start_ms',c.start_ms,'end_ms',c.end_ms,'cover_ms',c.cover_ms,'formats',c.formats,
  'watermark',c.watermark,'brand_text',c.brand_text,'burn_captions',coalesce(p_payload->'burn_captions',to_jsonb(c.burn_captions)),'subtitles',p_payload->'cues');
 -- This existing command validates captions, respects published immutability,
 -- enforces creator watermark/moderation, and queues a new render atomically.
 result:=live_streams.clip_command(c.session_id,c.id,'edit',spec,p_request_id);
 update live_streams.transcription_jobs set state='reviewed',review_payload=p_payload,review_result=result,reviewer_id=uid,updated_at=now() where id=j.id;
 return result;
end $$;

create function public.live_transcription_worker(p_action text,p_id uuid default null,p_lease_id uuid default null,p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j live_streams.transcription_jobs;r live_streams.transcription_reservations;limits live_streams.transcription_limits;
 items jsonb:='[]';cue jsonb;last_end bigint:=0;n bigint;eid uuid;enabled boolean;lease_ok boolean;status text;
 active_leases integer;active_provider integer;daily_starts bigint;daily_audio bigint;cleanup_due boolean;normal_due boolean:=false;maintenance_due boolean:=false;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 enabled:=coalesce((select i.enabled from live_streams.integration_runtime i where platform='transcription'),false);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>320000 then raise exception 'INVALID_REQUEST';end if;
 if p_action='peek' then
  -- Read-only scheduler signal. Never return actors, clips, leases or media.
  select least(2,(select count(*) from live_streams.transcription_jobs where state='leased' and lease_until>now())+
   (select count(*) from live_streams.transcription_reservations where cleanup_lease_until>now())) into active_leases;
  select count(*) into active_provider from live_streams.transcription_reservations where provider_state='active';
  select count(*),coalesce(sum(budget_audio_ms),0) into daily_starts,daily_audio from live_streams.transcription_reservations where reserved_at>=date_trunc('day',now(),'UTC');
  select exists(select 1 from live_streams.transcription_reservations qr left join live_streams.transcription_jobs tj on tj.id=qr.id
   where qr.provider_state='active' and qr.next_cleanup_at<=now() and (qr.cleanup_lease_until is null or qr.cleanup_lease_until<=now())
    and (tj.id is null or tj.state in ('failed','cancelled','rejected') or not enabled or not live_streams.transcription_allowed(tj)
     or tj.created_at<now()-interval '2 hours' or tj.attempts>=120)) into cleanup_due;
  -- Expired or revoked unreserved work still needs the existing claim cleanup,
  -- even when no eligible paid submission remains to wake an executor.
  if enabled then
   select exists(select 1 from live_streams.transcription_jobs tj where
    ((tj.state='pending' and tj.next_attempt_at<=now()) or(tj.state='leased' and tj.lease_until<=now()))
    and (tj.created_at<now()-interval '2 hours' or tj.attempts>=120 or not live_streams.transcription_allowed(tj))) into maintenance_due;
  end if;
  select * into limits from live_streams.transcription_limits where singleton;
  if enabled and found then
   select exists(select 1 from live_streams.transcription_jobs tj left join live_streams.transcription_reservations qr on qr.id=tj.id
    where ((tj.state='pending' and tj.next_attempt_at<=now()) or(tj.state='leased' and tj.lease_until<=now()))
     and tj.created_at>=now()-interval '2 hours' and tj.attempts<120 and live_streams.transcription_allowed(tj)
     and (qr.provider_state='active' or (qr.id is null and active_provider<limits.max_provider_active and daily_starts<limits.max_daily_starts
      and daily_audio+((((tj.duration_ms+999)/1000)+1)*1000)<=limits.max_daily_audio_ms))) into normal_due;
  end if;
  return jsonb_build_object('enabled',enabled or cleanup_due,'due',active_leases<2 and (cleanup_due or normal_due or maintenance_due),'active',active_leases);
 end if;
 if p_action='claim' then
  perform pg_advisory_xact_lock(hashtextextended('live-transcription-workers',0));
  update live_streams.transcription_jobs set state='failed',error_code='TRANSCRIPTION_EXPIRED',lease_id=null,lease_until=null
   where state in ('pending','leased') and (created_at<now()-interval '2 hours' or attempts>=120);
  if (select count(*) from live_streams.transcription_jobs where state='leased' and lease_until>now())+
   (select count(*) from live_streams.transcription_reservations where cleanup_lease_until>now())>=2 then return jsonb_build_object('items','[]'::jsonb);end if;
  -- Reconciliation never gives a revoked actor a media grant. It is limited to
  -- the already-reserved deterministic provider job and its two scratch keys.
  select q.* into r from live_streams.transcription_reservations q left join live_streams.transcription_jobs tj on tj.id=q.id
   where q.provider_state='active' and q.next_cleanup_at<=now() and (q.cleanup_lease_until is null or q.cleanup_lease_until<=now())
   and (tj.id is null or tj.state in ('failed','cancelled','rejected') or not enabled or not live_streams.transcription_allowed(tj))
   order by q.next_cleanup_at,q.id for update of q skip locked limit 1;
  if found then
   -- Submit/finish lock the work row before its reservation. Do not wait on
   -- that row while holding a cleanup reservation; a later claim reconciles it.
   if exists(select 1 from live_streams.transcription_jobs where id=r.id) then
    perform 1 from live_streams.transcription_jobs where id=r.id for update skip locked;
    if not found then return jsonb_build_object('items','[]'::jsonb);end if;
   end if;
   update live_streams.transcription_jobs set state='cancelled',draft=null,lease_id=null,lease_until=null,error_code='CLIP_CHANGED'
    where id=r.id and state in ('pending','leased');
   eid:=gen_random_uuid();update live_streams.transcription_reservations set cleanup_lease_id=eid,cleanup_lease_until=now()+interval '2 minutes' where id=r.id;
   return jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',r.id,'lease_id',eid,'clip_id',r.clip_id,'format',r.format,
    'duration_ms',r.duration_ms,'language',r.language,'job_name','pc-live-caption-'||replace(r.id::text,'-',''),
    'cleanup',true,'configuration_hash',r.configuration_hash,'reserved_at',r.reserved_at)));
  end if;
  if not enabled then return jsonb_build_object('ok',false,'error','INTEGRATION_DISABLED','items','[]'::jsonb);end if;
  for j in select * from live_streams.transcription_jobs where (state='pending' and next_attempt_at<=now()) or(state='leased' and lease_until<=now()) order by next_attempt_at,id for update skip locked limit 1 loop
   if not live_streams.transcription_allowed(j) then update live_streams.transcription_jobs set state='cancelled',draft=null,lease_id=null,lease_until=null,error_code='CLIP_CHANGED' where id=j.id;continue;end if;
   eid:=gen_random_uuid();update live_streams.transcription_jobs set state='leased',lease_id=eid,lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() where id=j.id;
   select * into r from live_streams.transcription_reservations where id=j.id;
   items:=items||jsonb_build_array(jsonb_build_object('id',j.id,'lease_id',eid,'clip_id',j.clip_id,'format',j.format,'duration_ms',j.duration_ms,
    'language',j.language,'job_name','pc-live-caption-'||replace(j.id::text,'-',''),'cleanup',false,
    'configuration_hash',r.configuration_hash,'reserved_at',r.reserved_at));
  end loop;
  return jsonb_build_object('items',items);
 end if;
 if p_action in ('settle','cleanup_defer') then
  select * into r from live_streams.transcription_reservations where id=p_id for update;
  if not found or r.provider_state<>'active' then return jsonb_build_object('ok',false,'error','STATE_EXPIRED');end if;
  lease_ok:=r.cleanup_lease_id=p_lease_id and r.cleanup_lease_until>now();
  if p_action='settle' and not coalesce(lease_ok,false) then
   lease_ok:=exists(select 1 from live_streams.transcription_jobs where id=p_id and state='leased' and lease_id=p_lease_id and lease_until>now());
  end if;
  if not coalesce(lease_ok,false) then return jsonb_build_object('ok',false,'error','STATE_EXPIRED');end if;
  if p_action='cleanup_defer' then
   update live_streams.transcription_reservations set next_cleanup_at=now()+interval '60 seconds',cleanup_lease_id=null,cleanup_lease_until=null where id=r.id;
   return jsonb_build_object('ok',true);
  end if;
  status:=p_payload->>'provider_status';
  if status not in ('COMPLETED','FAILED','NOT_FOUND','NOT_SUBMITTED') or status is null then raise exception 'INVALID_REQUEST';end if;
  if status='NOT_FOUND' and r.reserved_at>now()-interval '2 minutes' then return jsonb_build_object('ok',false,'error','SETTLEMENT_PENDING');end if;
  if status='NOT_SUBMITTED' and r.cleanup_lease_id=p_lease_id then return jsonb_build_object('ok',false,'error','SETTLEMENT_PENDING');end if;
  update live_streams.transcription_reservations set provider_state='terminal',terminal_at=now(),terminal_status=status,cleanup_lease_id=null,cleanup_lease_until=null where id=r.id;
  return jsonb_build_object('ok',true,'provider_state','terminal');
 end if;
 if not enabled then return jsonb_build_object('ok',false,'error','INTEGRATION_DISABLED','items','[]'::jsonb);end if;
 select * into j from live_streams.transcription_jobs where id=p_id for update;
 if not found or j.state<>'leased' or j.lease_id is distinct from p_lease_id or j.lease_until<=now() then return jsonb_build_object('ok',false,'error','STATE_EXPIRED');end if;
 if not live_streams.transcription_allowed(j) then
  update live_streams.transcription_jobs set state='cancelled',draft=null,lease_id=null,lease_until=null,error_code='CLIP_CHANGED' where id=j.id;
  return jsonb_build_object('ok',false,'error','CLIP_CHANGED');
 end if;
 if p_action='check' then return jsonb_build_object('ok',true,'id',j.id,'clip_id',j.clip_id,'bucket','live-clips','object_path',j.object_path,'duration_ms',j.duration_ms,'language',j.language,'job_name','pc-live-caption-'||replace(j.id::text,'-',''));end if;
 if p_action='submit' then
  if coalesce(p_payload->>'configuration_hash','')!~'^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST';end if;
  perform pg_advisory_xact_lock(hashtextextended('live-transcription-provider-budget',0));
  select * into r from live_streams.transcription_reservations where id=j.id for update;
  if found then
   if r.provider_state<>'active' then return jsonb_build_object('ok',false,'error','STATE_EXPIRED');end if;
   if r.configuration_hash<>p_payload->>'configuration_hash' then return jsonb_build_object('ok',false,'error','CONFIGURATION_CONFLICT');end if;
   return jsonb_build_object('ok',true,'duplicate',true,'reserved_at',r.reserved_at);
  end if;
  select * into limits from live_streams.transcription_limits where singleton;
  if not found then return jsonb_build_object('ok',false,'error','INTEGRATION_DISABLED');end if;
  if (select count(*) from live_streams.transcription_reservations where provider_state='active')>=limits.max_provider_active then return jsonb_build_object('ok',false,'error','PROVIDER_CAPACITY');end if;
  if (select count(*) from live_streams.transcription_reservations where reserved_at>=date_trunc('day',now(),'UTC'))>=limits.max_daily_starts then return jsonb_build_object('ok',false,'error','DAILY_BUDGET');end if;
  if (select coalesce(sum(budget_audio_ms),0) from live_streams.transcription_reservations where reserved_at>=date_trunc('day',now(),'UTC'))+
   ((((j.duration_ms+999)/1000)+1)*1000)>limits.max_daily_audio_ms then return jsonb_build_object('ok',false,'error','DAILY_BUDGET');end if;
  insert into live_streams.transcription_reservations(id,clip_id,format,duration_ms,language,configuration_hash)
   values(j.id,j.clip_id,j.format,j.duration_ms,j.language,p_payload->>'configuration_hash') returning * into r;
  return jsonb_build_object('ok',true,'duplicate',false,'reserved_at',r.reserved_at);
 end if;
 if p_action='defer' then
  update live_streams.transcription_jobs set state='pending',next_attempt_at=now()+interval '60 seconds',lease_id=null,lease_until=null,updated_at=now() where id=j.id;
  return jsonb_build_object('ok',true);
 elsif p_action='fail' then
  if coalesce(p_payload->>'error','') not in ('TRANSCRIPTION_FAILED','PROVIDER_UNAVAILABLE','MEDIA_TOO_LARGE','PROVIDER_RESPONSE_INVALID') then raise exception 'INVALID_REQUEST';end if;
  update live_streams.transcription_jobs set state='failed',error_code=p_payload->>'error',lease_id=null,lease_until=null,updated_at=now() where id=j.id;return jsonb_build_object('ok',true);
 elsif p_action='finish' then
  if p_payload->>'provider' is distinct from 'aws_transcribe' or p_payload->>'timing' is distinct from 'provider_words' or p_payload->'requires_review' is distinct from 'true'::jsonb or jsonb_typeof(p_payload->'cues') is distinct from 'array'
   or jsonb_array_length(p_payload->'cues') not between 1 and 500 or jsonb_typeof(p_payload->'text') is distinct from 'string' or length(p_payload->>'text') not between 1 and 100000 then raise exception 'INVALID_CAPTIONS';end if;
  for cue in select * from jsonb_array_elements(p_payload->'cues') loop
   if coalesce(cue->>'start_ms','')!~'^[0-9]{1,8}$' or coalesce(cue->>'end_ms','')!~'^[0-9]{1,8}$' or jsonb_typeof(cue->'text') is distinct from 'string' or length(cue->>'text') not between 1 and 500 then raise exception 'INVALID_CAPTIONS';end if;
   n:=(cue->>'start_ms')::bigint;if n<last_end or (cue->>'end_ms')::bigint<=n or (cue->>'end_ms')::bigint>j.duration_ms then raise exception 'INVALID_CAPTIONS';end if;last_end:=(cue->>'end_ms')::bigint;
  end loop;
  update live_streams.transcription_jobs set state='draft',draft=p_payload,lease_id=null,lease_until=null,updated_at=now() where id=j.id;
  update live_streams.transcription_reservations set provider_state='terminal',terminal_at=now(),terminal_status='COMPLETED',cleanup_lease_id=null,cleanup_lease_until=null where id=j.id;
  return jsonb_build_object('ok',true,'state','draft','requires_review',true);
 end if;
 raise exception 'INVALID_REQUEST';
end $$;
revoke all on function live_streams.transcription_allowed(live_streams.transcription_jobs),public.live_transcription_command(uuid,text,jsonb,uuid),public.live_transcription_worker(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.live_transcription_command(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.live_transcription_worker(text,uuid,uuid,jsonb) to service_role;
