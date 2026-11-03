-- Explicit direct publishing has a separate queue from device-export history.
-- Existing share/retry_post actions retain export_required behavior.
-- Keep the already deployed connection platform foreign key indexed.
create index social_connections_platform on live_streams.social_connections(platform);
create table live_streams.social_publish_jobs (
 id uuid primary key default gen_random_uuid(),clip_id uuid not null references live_streams.clips(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade,auth_session_id uuid not null,
 connection_id uuid not null references live_streams.social_connections(id) on delete cascade,connection_at timestamptz not null,
 platform text not null check(platform in ('x','facebook','instagram','youtube','tiktok')),account_id text not null,
 request_id uuid not null,consent jsonb not null,revision integer not null,object_path text not null,
 state text not null default 'pending' check(state in ('pending','leased','published','confirmation_required','failed','cancelled')),
 phase text not null default 'initial' check(phase in ('initial','creating','uploading','processing','prepared','publishing','published')),
 progress_ciphertext text,lease_id uuid,lease_until timestamptz,attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 pull_ciphertext text,pull_token_hash text,pull_expires_at timestamptz,pull_reads integer not null default 0,
 reconcile_only boolean not null default false,dispatch_started boolean not null default false,provider_id text,external_url text,error_code text,published_at timestamptz,revoked_after_dispatch boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(actor_id,request_id),
 check(progress_ciphertext is null or length(progress_ciphertext)<=85000),check(provider_id is null or provider_id~'^[a-zA-Z0-9_:.~-]{1,160}$'),
 check(pull_ciphertext is null or length(pull_ciphertext)<=2000),check(pull_token_hash is null or pull_token_hash~'^[a-f0-9]{64}$'),check(pull_reads between 0 and 32)
);
create index social_publish_claim on live_streams.social_publish_jobs(next_attempt_at,id) where state in ('pending','leased');
create index social_publish_actor on live_streams.social_publish_jobs(actor_id,created_at desc,id desc);
create index social_publish_connection on live_streams.social_publish_jobs(connection_id);
create index social_publish_clip on live_streams.social_publish_jobs(clip_id,actor_id,platform,state);
alter table live_streams.social_publish_jobs enable row level security;
revoke all on live_streams.social_publish_jobs from public,anon,authenticated,service_role;

create function live_streams.social_job_allowed(j live_streams.social_publish_jobs) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from live_streams.clips c join live_streams.sessions s on s.id=c.session_id
  join live_streams.social_connections sc on sc.id=j.connection_id join live_streams.integration_runtime r on r.platform=j.platform
  where c.id=j.clip_id and c.state='ready' and c.render_revision=j.revision and c.moderation_state='approved' and c.copyright_state='cleared' and s.audience='public'
  and c.output_prefix||(j.consent->>'format')||'.mp4'=j.object_path and live_streams.clip_can_read(c.id,j.actor_id)
  and(c.creator_id=j.actor_id or live_streams.clip_manage(c.session_id,j.actor_id)) and live_streams.publisher_allowed(j.actor_id,j.auth_session_id)
  and sc.state='connected' and sc.user_id=j.actor_id and sc.platform=j.platform and sc.account_id=j.account_id and sc.connected_at=j.connection_at
  and r.enabled and r.publishing_enabled and exists(select 1 from storage.objects o where o.bucket_id='live-clips' and o.name=j.object_path));
$$;
create function live_streams.social_job_json(j live_streams.social_publish_jobs) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',j.id,'clip_id',j.clip_id,'platform',j.platform,'state',j.state,'phase',j.phase,'error_code',j.error_code,
  'provider_id',j.provider_id,'external_url',j.external_url,'created_at',j.created_at,'published_at',j.published_at,'revoked_after_dispatch',j.revoked_after_dispatch);
$$;
create function public.live_social_command(p_clip_id uuid,p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=live_streams.require_user();sid uuid:=(auth.jwt()->>'session_id')::uuid;c live_streams.clips;s live_streams.sessions;sc live_streams.social_connections;j live_streams.social_publish_jobs;plat text:=p_payload->>'platform';items jsonb;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16000 then raise exception 'INVALID_REQUEST';end if;
 if p_action='history' then
  select coalesce(jsonb_agg(live_streams.social_job_json(q) order by q.created_at desc,q.id desc),'[]') into items from(select * from live_streams.social_publish_jobs where actor_id=uid and(clip_id=p_clip_id or p_clip_id is null) order by created_at desc,id desc limit 30) q;
  return jsonb_build_object('items',items);
 end if;
 select * into c from live_streams.clips where id=p_clip_id for update;
 if not found or not live_streams.clip_can_read(c.id,uid) or not(c.creator_id=uid or live_streams.clip_manage(c.session_id,uid)) or not live_streams.publisher_allowed(uid,sid) then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 if p_action in ('cancel','reconcile','retry') then
  select * into j from live_streams.social_publish_jobs where id=(p_payload->>'id')::uuid and clip_id=c.id and actor_id=uid for update;
  if not found then raise exception 'ACCESS_DENIED';end if;
  if p_action='cancel' then
   if j.state='published' then raise exception 'PUBLICATION_ALREADY_PUBLISHED';end if;
   if (j.dispatch_started or j.phase in ('creating','publishing')) and p_payload->'checked_provider' is distinct from 'true'::jsonb then raise exception 'PUBLICATION_CONFIRMATION_REQUIRED';end if;
   update live_streams.social_publish_jobs set state='cancelled',lease_id=null,lease_until=null,updated_at=now() where id=j.id;
  elsif p_action='reconcile' and j.state='confirmation_required' and j.progress_ciphertext is not null then
   update live_streams.social_publish_jobs set state='pending',reconcile_only=true,next_attempt_at=now(),auth_session_id=sid,updated_at=now() where id=j.id;
  elsif p_action='retry' and j.state='failed' and j.phase not in ('creating','publishing','published') and j.attempts<100 then
   update live_streams.social_publish_jobs set state='pending',reconcile_only=false,next_attempt_at=now(),auth_session_id=sid,updated_at=now() where id=j.id;
  else raise exception 'PUBLICATION_CONFIRMATION_REQUIRED';end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action<>'publish' or p_request_id is null or plat is null or plat not in ('x','facebook','instagram','youtube','tiktok') then raise exception 'INVALID_REQUEST';end if;
 perform pg_advisory_xact_lock(hashtextextended('live-social-admission:'||uid::text,0));
 select * into j from live_streams.social_publish_jobs where actor_id=uid and request_id=p_request_id;
 if found then if j.clip_id<>c.id or j.consent<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;return live_streams.social_job_json(j)||jsonb_build_object('duplicate',true);end if;
 if not exists(select 1 from live_streams.integration_runtime where platform=plat and enabled and publishing_enabled) then raise exception 'INTEGRATION_DISABLED';end if;
 select * into sc from live_streams.social_connections where user_id=uid and platform=plat and state='connected';if not found then raise exception 'RECONNECT_REQUIRED';end if;
 select * into s from live_streams.sessions where id=c.session_id;
 if c.state<>'ready' or c.moderation_state<>'approved' or c.copyright_state<>'cleared' then raise exception 'REVIEW_REQUIRED';end if;
 if s.audience<>'public' then raise exception 'PRIVATE_STREAM_EXPORT_RESTRICTED';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('platform','format','consent','caption','title','privacy','made_for_kids','disable_comment','disable_duet','disable_stitch','brand_content','brand_organic','is_aigc','agree_music_usage'))
  or p_payload->'consent' is distinct from 'true'::jsonb or coalesce(p_payload->>'format','') not in ('horizontal','vertical') or not(c.formats?(p_payload->>'format'))
  or jsonb_typeof(p_payload->'caption') is distinct from 'string' or length(p_payload->>'caption')>2200 or jsonb_typeof(p_payload->'title') is distinct from 'string' or length(p_payload->>'title') not between 1 and 100 then raise exception 'INVALID_REQUEST';end if;
 if plat='x' and length(p_payload->>'caption')>280 then raise exception 'INVALID_REQUEST';end if;
 if plat in ('instagram','facebook','tiktok') and (p_payload->>'format'<>'vertical' or c.end_ms-c.start_ms<3000) then raise exception 'UNSUPPORTED_FORMAT';end if;
 if plat='facebook' and (c.end_ms-c.start_ms<4000 or c.end_ms-c.start_ms>60000) then raise exception 'UNSUPPORTED_FORMAT';end if;
 if plat='youtube' and (p_payload->>'format'<>'vertical' or c.end_ms-c.start_ms>180000 or coalesce(p_payload->>'privacy','') not in ('public','unlisted','private') or jsonb_typeof(p_payload->'made_for_kids') is distinct from 'boolean') then raise exception 'INVALID_REQUEST';end if;
 if plat='tiktok' and c.watermark then raise exception 'TIKTOK_CLEAN_EXPORT_REQUIRED';end if;
 if plat='tiktok' and (coalesce(p_payload->>'privacy','') not in ('PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY') or p_payload->'agree_music_usage' is distinct from 'true'::jsonb
  or exists(select 1 from unnest(array['disable_comment','disable_duet','disable_stitch','brand_content','brand_organic','is_aigc']) k where jsonb_typeof(p_payload->k) is distinct from 'boolean')) then raise exception 'INVALID_REQUEST';end if;
 if (select count(*) from live_streams.social_publish_jobs where actor_id=uid and state in ('pending','leased','confirmation_required'))>=5 then raise exception 'ACCOUNT_LIMIT';end if;
 if exists(select 1 from live_streams.social_publish_jobs where actor_id=uid and clip_id=c.id and platform=plat and state in ('pending','leased','confirmation_required')) then raise exception 'PUBLICATION_CONFIRMATION_REQUIRED';end if;
 perform live_streams.take_rate('social_publish',uid::text,10,3600);
 insert into live_streams.social_publish_jobs(clip_id,actor_id,auth_session_id,connection_id,connection_at,platform,account_id,request_id,consent,revision,object_path)
  values(c.id,uid,sid,sc.id,sc.connected_at,plat,sc.account_id,p_request_id,p_payload,c.render_revision,c.output_prefix||(p_payload->>'format')||'.mp4') returning * into j;
 return live_streams.social_job_json(j);
end $$;

create function public.live_social_credentials(p_actor uuid,p_session uuid,p_platform text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c live_streams.social_connections;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' or not coalesce(live_streams.publisher_allowed(p_actor,p_session),false) then raise exception 'ACCESS_DENIED';end if;
 if not exists(select 1 from live_streams.integration_runtime where platform=p_platform and enabled and publishing_enabled) then raise exception 'INTEGRATION_DISABLED';end if;
 perform live_streams.take_rate('social_credentials',p_actor::text||':'||p_platform,12,60);
 select * into c from live_streams.social_connections where user_id=p_actor and platform=p_platform and state='connected';if not found then raise exception 'RECONNECT_REQUIRED';end if;
 return jsonb_build_object('id',c.id,'platform',c.platform,'account_id',c.account_id,'account_name',c.account_name,'ciphertext',c.ciphertext,'expires_at',c.expires_at);
end $$;

create function public.live_social_worker(p_action text,p_id uuid default null,p_lease_id uuid default null,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare j live_streams.social_publish_jobs;c live_streams.clips;items jsonb:='[]';eid uuid;allowed boolean;media_bytes bigint;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'ACCESS_DENIED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>100000 then raise exception 'INVALID_REQUEST';end if;
 if p_action='claim' then
  perform pg_advisory_xact_lock(hashtextextended('live-social-workers',0));
  update live_streams.social_publish_jobs set state='confirmation_required',lease_id=null,lease_until=null,error_code='PUBLICATION_CONFIRMATION_REQUIRED' where state='leased' and lease_until<=now() and phase in ('creating','publishing');
  update live_streams.social_publish_jobs set state=case when dispatch_started then 'confirmation_required' else 'failed' end,lease_id=null,lease_until=null,error_code='PUBLICATION_EXPIRED' where state in ('pending','leased') and (created_at<now()-interval '24 hours' or attempts>=100);
  if(select count(*) from live_streams.social_publish_jobs where state='leased' and lease_until>now())>=2 then return jsonb_build_object('items','[]'::jsonb);end if;
  for j in select * from live_streams.social_publish_jobs where(state='pending' and next_attempt_at<=now())or(state='leased' and lease_until<=now()) order by next_attempt_at,id for update skip locked limit 1 loop
   if not live_streams.social_job_allowed(j) then update live_streams.social_publish_jobs set state=case when j.dispatch_started then 'confirmation_required' else 'cancelled' end,lease_id=null,lease_until=null,error_code='CLIP_CHANGED' where id=j.id;continue;end if;
   eid:=gen_random_uuid();update live_streams.social_publish_jobs set state='leased',lease_id=eid,lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() where id=j.id;
   items:=items||jsonb_build_array(jsonb_build_object('id',j.id,'lease_id',eid));
  end loop;return jsonb_build_object('items',items);
 end if;
 select * into j from live_streams.social_publish_jobs where id=p_id for update;
 if p_action='receipt' and j.state='published' then return jsonb_build_object('ok',true,'platform',j.platform,'id',j.id);end if;
 if p_action='finish' and j.state='published' and j.provider_id=p_payload->>'provider_id' then return jsonb_build_object('ok',true,'duplicate',true);end if;
 if not found or j.state<>'leased' or j.lease_id is distinct from p_lease_id or j.lease_until<=now() then return jsonb_build_object('ok',false,'error','STATE_EXPIRED');end if;
 if p_action='receipt' then return jsonb_build_object('ok',true,'platform',j.platform,'id',j.id);end if;
 allowed:=live_streams.social_job_allowed(j);
 if p_action='finish' and j.dispatch_started and j.phase in ('publishing','processing','published') and coalesce(p_payload->>'provider_id','')~'^[a-zA-Z0-9_:.~-]{1,160}$' then
  update live_streams.social_publish_jobs set state='published',phase='published',provider_id=p_payload->>'provider_id',external_url=p_payload->>'external_url',published_at=now(),revoked_after_dispatch=not allowed,lease_id=null,lease_until=null,updated_at=now(),error_code=null where id=j.id;
  return jsonb_build_object('ok',true,'state','published');
 end if;
 if not allowed then update live_streams.social_publish_jobs set state=case when dispatch_started or phase='creating' then 'confirmation_required' else 'cancelled' end,lease_id=null,lease_until=null,error_code='CLIP_CHANGED' where id=j.id;return jsonb_build_object('ok',false,'error','CLIP_CHANGED');end if;
 if p_action='check' then
  select * into c from live_streams.clips where id=j.clip_id;
  return jsonb_build_object('ok',true,'id',j.id,'actor_id',j.actor_id,'auth_session_id',j.auth_session_id,'connection_id',j.connection_id,'platform',j.platform,'account_id',j.account_id,'consent',j.consent,
   'phase',j.phase,'progress_ciphertext',j.progress_ciphertext,'reconcile_only',j.reconcile_only,'attempts',j.attempts,'object_path',j.object_path,'clip_id',j.clip_id,'duration_ms',c.end_ms-c.start_ms,'cover_ms',c.cover_ms);
 elsif p_action='pull_grant' then
  if j.platform<>'tiktok' or coalesce(p_payload->>'token_hash','')!~'^[a-f0-9]{64}$' or coalesce(p_payload->>'ciphertext','')!~'^v1[.]' or length(p_payload->>'ciphertext')>2000 then raise exception 'INVALID_REQUEST';end if;
  select (metadata->>'size')::bigint into media_bytes from storage.objects where bucket_id='live-clips' and name=j.object_path and metadata->>'mimetype'='video/mp4';
  if media_bytes is null or media_bytes not between 1 and 134217728 then raise exception 'MEDIA_TOO_LARGE';end if;
  if j.pull_token_hash is null then
   update live_streams.social_publish_jobs set pull_token_hash=p_payload->>'token_hash',pull_ciphertext=p_payload->>'ciphertext',pull_expires_at=now()+interval '70 minutes' where id=j.id returning * into j;
  end if;
  return jsonb_build_object('ciphertext',j.pull_ciphertext,'token_hash',j.pull_token_hash,'expires_at',j.pull_expires_at,'bytes',media_bytes);
 elsif p_action='checkpoint' then
  if coalesce(p_payload->>'phase','') not in ('initial','creating','uploading','processing','prepared','publishing','published') or coalesce(p_payload->>'ciphertext','')!~'^v1[.]' then raise exception 'INVALID_REQUEST';end if;
  if j.reconcile_only and p_payload->>'phase' in ('initial','creating','uploading','prepared','publishing') then raise exception 'PUBLICATION_CONFIRMATION_REQUIRED';end if;
  update live_streams.social_publish_jobs set phase=p_payload->>'phase',dispatch_started=dispatch_started or p_payload->>'phase'='publishing',progress_ciphertext=p_payload->>'ciphertext',lease_until=now()+interval '2 minutes',updated_at=now() where id=j.id;return jsonb_build_object('ok',true);
 elsif p_action='defer' then
  if j.phase in ('creating','publishing') then raise exception 'PUBLICATION_CONFIRMATION_REQUIRED';end if;
  update live_streams.social_publish_jobs set state='pending',next_attempt_at=now()+make_interval(secs=>greatest(15,least(3600,coalesce((p_payload->>'after_seconds')::integer,30)))),lease_id=null,lease_until=null,updated_at=now() where id=j.id;return jsonb_build_object('ok',true);
 elsif p_action='fail' then
  if coalesce(p_payload->>'error','') not in ('PROVIDER_REJECTED','PROVIDER_RATE_LIMITED','PROVIDER_UNAVAILABLE','PROVIDER_RESPONSE_INVALID','RECONNECT_REQUIRED','UNSUPPORTED_FORMAT','PUBLICATION_CONFIRMATION_REQUIRED','MEDIA_TOO_LARGE') then raise exception 'INVALID_REQUEST';end if;
  update live_streams.social_publish_jobs set state=case when dispatch_started or phase='creating' or p_payload->>'error'='PUBLICATION_CONFIRMATION_REQUIRED' then 'confirmation_required' else 'failed' end,
   error_code=p_payload->>'error',lease_id=null,lease_until=null,updated_at=now() where id=j.id;return jsonb_build_object('ok',true);
 end if;raise exception 'INVALID_REQUEST';
end $$;
-- Capability-only provider download: one exact clip rendition, at most 32 HTTP
-- requests, no new post authority, no provider/user credential and no redirect.
-- Resolve twice around Storage headers to catch revocation before first byte.
create function public.live_social_pull_grant(p_id uuid,p_token_hash text,p_consume boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare j live_streams.social_publish_jobs;o storage.objects;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'ACCESS_DENIED';end if;
 if p_consume is null or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$' then return null;end if;
 select * into j from live_streams.social_publish_jobs where id=p_id for update;
 if not found or j.platform<>'tiktok' or j.pull_token_hash is distinct from p_token_hash or j.pull_expires_at<=now() or j.pull_expires_at is null
  or j.state not in ('pending','leased','confirmation_required') or not j.dispatch_started or not live_streams.social_job_allowed(j) then return null;end if;
 if p_consume then
  if j.pull_reads>=32 then return null;end if;
  perform live_streams.take_rate('social_pull',j.id::text,8,60);
  update live_streams.social_publish_jobs set pull_reads=pull_reads+1 where id=j.id;
 end if;
 select * into o from storage.objects where bucket_id='live-clips' and name=j.object_path and metadata->>'mimetype'='video/mp4';
 if not found or o.version is null or coalesce((o.metadata->>'size')::bigint,0) not between 1 and 134217728 then return null;end if;
 return jsonb_build_object('bucket','live-clips','path',j.object_path,'version',o.version::text,'expiresAt',j.pull_expires_at,'bytes',(o.metadata->>'size')::bigint);
end $$;
revoke all on function live_streams.social_job_allowed(live_streams.social_publish_jobs),live_streams.social_job_json(live_streams.social_publish_jobs),public.live_social_command(uuid,text,jsonb,uuid),public.live_social_credentials(uuid,uuid,text),public.live_social_worker(text,uuid,uuid,jsonb),public.live_social_pull_grant(uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.live_social_command(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.live_social_credentials(uuid,uuid,text),public.live_social_worker(text,uuid,uuid,jsonb),public.live_social_pull_grant(uuid,text,boolean) to service_role;
