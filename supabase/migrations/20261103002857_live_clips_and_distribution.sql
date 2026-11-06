-- Live clips v1. Additive to the portable Live control plane.
-- No provider credential is stored in a client-readable schema or queue.
begin;
create table live_streams.clip_settings (
 session_id uuid primary key references live_streams.sessions(id) on delete cascade,
 viewer_clipping boolean not null default false,review_required boolean not null default true,
 watermark_required boolean not null default true,brand_text text not null default 'Platinum Circles' check(length(brand_text)<=80),
 copyright_policy text not null default 'standard' check(copyright_policy in ('standard','owner_only','disabled')),
 updated_at timestamptz not null default now()
);
create table live_streams.clip_approvals (
 session_id uuid not null references live_streams.sessions(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,primary key(session_id,user_id)
);
create table live_streams.clips (
 id uuid primary key default gen_random_uuid(),session_id uuid not null references live_streams.sessions(id) on delete cascade,
 creator_id uuid not null references public.profiles(id) on delete cascade,owner_id uuid not null references public.profiles(id) on delete cascade,
 auth_session_id uuid not null,title text not null check(length(title) between 1 and 120),caption text not null default '' check(length(caption)<=2200),
 tags jsonb not null default '[]' check(jsonb_typeof(tags)='array' and jsonb_array_length(tags)<=20),
 start_ms bigint not null check(start_ms>=0),end_ms bigint not null,cover_ms integer not null,
 formats jsonb not null,watermark boolean not null,brand_text text not null check(length(brand_text)<=80),burn_captions boolean not null,
 subtitles jsonb not null default '[]',state text not null default 'queued' check(state in ('queued','processing','ready','failed','deleted')),
 moderation_state text not null default 'pending' check(moderation_state in ('pending','approved','rejected')),
 copyright_state text not null default 'cleared' check(copyright_state in ('cleared','blocked')),
 current_lease uuid,output_prefix text,manifest jsonb,error_code text,render_revision integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(end_ms-start_ms between 1000 and 600000),check(cover_ms>=0 and cover_ms<end_ms-start_ms)
);
create index live_clips_creator on live_streams.clips(creator_id,created_at desc,id desc);
create index live_clips_owner on live_streams.clips(owner_id,created_at desc,id desc);
create index live_clips_pending_creator on live_streams.clips(creator_id,id) where state in ('queued','processing');
create index live_clips_session on live_streams.clips(session_id,created_at desc,id desc);
create index live_clips_review on live_streams.clips(moderation_state,created_at desc,id desc) where state<>'deleted';
create table live_streams.clip_jobs (
 id uuid primary key default gen_random_uuid(),clip_id uuid not null references live_streams.clips(id) on delete cascade,
 revision integer not null,state text not null default 'pending' check(state in ('pending','leased','done','dead')),
 attempts integer not null default 0,available_at timestamptz not null default now(),lease_id uuid,lease_until timestamptz,
 last_error text,created_at timestamptz not null default now(),unique(clip_id,revision)
);
create index live_clip_jobs_leased on live_streams.clip_jobs(lease_until,id) where state='leased';
create index live_clip_jobs_due on live_streams.clip_jobs(available_at,id) where state in ('pending','leased');
create table live_streams.clip_runtime (
 singleton boolean primary key default true check(singleton),max_active integer not null default 2 check(max_active between 1 and 100),
 max_pending_per_creator integer not null default 10 check(max_pending_per_creator between 1 and 100),
 project_origin text,enabled boolean not null default false
);
insert into live_streams.clip_runtime(singleton) values(true);
create table live_streams.clip_publications (
 id uuid primary key default gen_random_uuid(),clip_id uuid not null references live_streams.clips(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete cascade,auth_session_id uuid not null,
 destination text not null check(destination in ('feed','story','channel','community','highlight','x','facebook','instagram','youtube','tiktok')),
 target_id uuid,format text not null check(format in ('horizontal','vertical')),
 state text not null check(state in ('scheduled','pending','published','failed','revoked','export_required')),
 scheduled_at timestamptz,published_at timestamptz,published_id uuid,attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),error_code text,external_url text,created_at timestamptz not null default now()
);
create index live_clip_publications_clip on live_streams.clip_publications(clip_id,created_at desc,id desc);
create index live_clip_publications_actor on live_streams.clip_publications(actor_id,created_at desc,id desc);
create index live_clip_publications_due on live_streams.clip_publications(next_attempt_at,id) where state in ('pending','scheduled');
create unique index live_clip_publication_provenance on live_streams.clip_publications(destination,published_id) where published_id is not null;
create table live_streams.clip_audit (
 id uuid primary key default gen_random_uuid(),clip_id uuid references live_streams.clips(id) on delete cascade,
 session_id uuid not null references live_streams.sessions(id) on delete cascade,actor_id uuid not null,action text not null,reason text,
 created_at timestamptz not null default now()
);
create index live_clip_audit_page on live_streams.clip_audit(clip_id,created_at desc,id desc);
create table live_streams.clip_cleanup (
 id uuid primary key default gen_random_uuid(),clip_id uuid references live_streams.clips(id) on delete set null,
 bucket text not null default 'live-clips' check(bucket='live-clips'),object_path text not null unique,
 state text not null default 'pending' check(state in ('pending','leased','done','dead')),
 lease_id uuid,lease_until timestamptz,attempts integer not null default 0,available_at timestamptz not null default now(),last_error text
);
create index live_clip_cleanup_due on live_streams.clip_cleanup(available_at,id) where state in ('pending','leased');
-- Measured aggregate counters are ingested in batches by trusted telemetry.
-- Viewers never update a global clip row or use a per-viewer heartbeat RPC.
create table live_streams.clip_metrics (
 clip_id uuid primary key references live_streams.clips(id) on delete cascade,
 views bigint not null default 0 check(views>=0),shares bigint not null default 0 check(shares>=0),updated_at timestamptz not null default now()
);
create index live_clip_metrics_views on live_streams.clip_metrics(views desc,clip_id desc);
create index live_clip_metrics_shares on live_streams.clip_metrics(shares desc,clip_id desc);
do $$ declare t text;begin
 foreach t in array array['clip_settings','clip_approvals','clips','clip_jobs','clip_runtime','clip_publications','clip_audit','clip_cleanup','clip_metrics'] loop
 execute format('alter table live_streams.%I enable row level security',t);
 execute format('revoke all on live_streams.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create function live_streams.clip_job_json(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',j.id,'lease_id',j.lease_id,'clip_id',c.id,'session_id',c.session_id,'owner_id',c.owner_id,
 'source_path',case when s.state='ended' then coalesce(ps.replay_path,ps.playback_path) else ps.playback_path end,
 'start_ms',c.start_ms,'end_ms',c.end_ms,'cover_ms',c.cover_ms,'formats',c.formats,'watermark',c.watermark,'brand_text',c.brand_text,
 'burn_captions',c.burn_captions,'subtitles',c.subtitles,'output_prefix',c.owner_id::text||'/'||c.session_id::text||'/'||c.id::text||'/'||j.lease_id::text||'/')
 from live_streams.clip_jobs j join live_streams.clips c on c.id=j.clip_id join live_streams.sessions s on s.id=c.session_id
 join live_streams.provider_sessions ps on ps.session_id=s.id where j.id=p_id;
$$;
create function live_streams.clip_check_job(p_id uuid,p_lease_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j live_streams.clip_jobs;c live_streams.clips;job jsonb;allowed boolean;
begin
 select * into j from live_streams.clip_jobs where id=p_id;
 select * into c from live_streams.clips where id=j.clip_id;
 allowed:=(select enabled from live_streams.clip_runtime where singleton) and j.state='leased' and j.lease_id=p_lease_id and j.lease_until>clock_timestamp() and c.current_lease=p_lease_id
 and c.state='processing' and c.render_revision=j.revision and c.copyright_state='cleared'
 and live_streams.active_user(c.creator_id,c.auth_session_id) and live_streams.clip_can_create(c.session_id,c.creator_id);
 if not coalesce(allowed,false) then return jsonb_build_object('ok',false);end if;
 job:=live_streams.clip_job_json(j.id);
 if job->>'source_path' is null or job->>'source_path' !~ ('^live/'||c.session_id::text||'/[a-f0-9-]{36}/master[.]m3u8$') then return jsonb_build_object('ok',false);end if;
 return jsonb_build_object('ok',true,'source_path',job->>'source_path','job',job);
end $$;
create function live_streams.clip_claim_jobs(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg live_streams.clip_runtime;slots integer;j live_streams.clip_jobs;c live_streams.clips;lease uuid;items jsonb:='[]';oldprefix text;
begin
 -- One short admission lock bounds total encoders across the fleet.
 select * into cfg from live_streams.clip_runtime where singleton for update;
 if not cfg.enabled then return jsonb_build_object('items',items);end if;
 select greatest(0,cfg.max_active-count(*)) into slots from live_streams.clip_jobs where state='leased' and lease_until>clock_timestamp();
 slots:=least(slots,greatest(0,least(coalesce(p_limit,1),2)));
 for j in select * from live_streams.clip_jobs where (state='pending' and available_at<=clock_timestamp()) or(state='leased' and lease_until<clock_timestamp()) order by available_at,id for update skip locked limit slots loop
  select * into c from live_streams.clips where id=j.clip_id for update;
  if c.state='deleted' or c.render_revision<>j.revision or j.attempts>=5 or c.copyright_state<>'cleared'
   or not live_streams.active_user(c.creator_id,c.auth_session_id) or not live_streams.clip_can_create(c.session_id,c.creator_id) then
   update live_streams.clip_jobs set state='dead',last_error='authority_or_attempts_exhausted' where id=j.id;
   update live_streams.clips set state='failed',error_code='authority_or_attempts_exhausted' where id=c.id and state<>'deleted';continue;
  end if;
  if j.lease_id is not null then perform live_streams.clip_queue_cleanup(c.id,c.owner_id::text||'/'||c.session_id::text||'/'||c.id::text||'/'||j.lease_id::text||'/');end if;
  lease:=gen_random_uuid();
  update live_streams.clip_jobs set state='leased',lease_id=lease,lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1 where id=j.id;
  update live_streams.clips set state='processing',current_lease=lease,updated_at=now(),error_code=null where id=c.id;
  items:=items||jsonb_build_array(live_streams.clip_job_json(j.id));
 end loop;
 return jsonb_build_object('items',items);
end $$;
create function live_streams.clip_finish_job(p_id uuid,p_lease_id uuid,p_ok boolean,p_manifest jsonb,p_error text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j live_streams.clip_jobs;c live_streams.clips;a jsonb;obj storage.objects;prefix text;name text;total bigint:=0;expected integer;seen text[]:=array[]::text[];allowed boolean;
begin
 select * into j from live_streams.clip_jobs where id=p_id for update;
 if not found or j.lease_id is distinct from p_lease_id then return jsonb_build_object('ok',false,'state','lease_lost');end if;
 select * into c from live_streams.clips where id=j.clip_id for update;
 if j.state='done' and c.current_lease=p_lease_id and c.state='ready' then return jsonb_build_object('ok',true,'state','ready','duplicate',true);end if;
 if j.state<>'leased' or j.lease_until<=clock_timestamp() then return jsonb_build_object('ok',false,'state','lease_lost');end if;
 prefix:=c.owner_id::text||'/'||c.session_id::text||'/'||c.id::text||'/'||p_lease_id::text||'/';
 allowed:=coalesce((live_streams.clip_check_job(p_id,p_lease_id)->>'ok')::boolean,false);
 if not p_ok or not allowed then
  perform live_streams.clip_queue_cleanup(c.id,prefix);
  update live_streams.clip_jobs set state=case when attempts>=5 or not allowed then 'dead' else 'pending' end,
   available_at=clock_timestamp()+make_interval(secs=>least(1800,30*(2^least(attempts,5))::integer)),lease_until=null,last_error=left(coalesce(p_error,'authority_revoked'),80) where id=j.id;
  update live_streams.clips set state=case when j.attempts>=5 or not allowed then 'failed' else 'queued' end,error_code=left(coalesce(p_error,'authority_revoked'),80),current_lease=null,updated_at=now() where id=c.id and state<>'deleted';
  return jsonb_build_object('ok',true,'state',case when j.attempts>=5 or not allowed then 'failed' else 'queued' end);
 end if;
 if jsonb_typeof(p_manifest)<>'object' or jsonb_typeof(p_manifest->'assets')<>'array' or jsonb_array_length(p_manifest->'assets') not between 2 and 4
  or abs((p_manifest->>'duration_ms')::bigint-(c.end_ms-c.start_ms))>150 then raise exception 'INVALID_CLIP_MANIFEST';end if;
 expected:=jsonb_array_length(c.formats)+1+case when jsonb_array_length(c.subtitles)>0 then 1 else 0 end;
 if jsonb_array_length(p_manifest->'assets')<>expected then raise exception 'INVALID_CLIP_MANIFEST';end if;
 for a in select * from jsonb_array_elements(p_manifest->'assets') loop
  name:=a->>'name';
  if name=any(seen) or name not in ('horizontal.mp4','vertical.mp4','thumbnail.jpg','captions.vtt') or coalesce(a->>'sha256','')!~'^[a-f0-9]{64}$'
   or coalesce(a->>'bytes','')!~'^[0-9]{1,10}$' or (a->>'bytes')::bigint not between 1 and 536870912 then raise exception 'INVALID_CLIP_ASSET';end if;
  seen:=array_append(seen,name);total:=total+(a->>'bytes')::bigint;
  if name like '%.mp4' and (not(c.formats ? replace(name,'.mp4','')) or abs((a->>'duration_ms')::bigint-(c.end_ms-c.start_ms))>150
   or (name='horizontal.mp4' and ((a->>'width')::integer<>1280 or (a->>'height')::integer<>720))
   or (name='vertical.mp4' and ((a->>'width')::integer<>720 or (a->>'height')::integer<>1280))) then raise exception 'INVALID_CLIP_ASSET';end if;
  select * into obj from storage.objects where bucket_id='live-clips' and storage.objects.name=prefix||(a->>'name');
  if not found or obj.user_metadata->>'live_clip_id' is distinct from c.id::text or obj.user_metadata->>'live_clip_job_id' is distinct from j.id::text
   or obj.user_metadata->>'live_clip_lease_id' is distinct from p_lease_id::text or obj.user_metadata->>'sha256' is distinct from a->>'sha256'
   or coalesce(obj.metadata->>'size','0')::bigint<>(a->>'bytes')::bigint
   or split_part(coalesce(obj.metadata->>'mimetype',''),';',1)<>(case when name like '%.mp4' then 'video/mp4' when name='thumbnail.jpg' then 'image/jpeg' else 'text/vtt' end) then raise exception 'CLIP_STORAGE_NOT_VERIFIED';end if;
 end loop;
 if total>536870912 or not('thumbnail.jpg'=any(seen)) or exists(select 1 from jsonb_array_elements_text(c.formats) f where not(f||'.mp4'=any(seen)))
 or (jsonb_array_length(c.subtitles)>0 and not('captions.vtt'=any(seen))) then raise exception 'INVALID_CLIP_MANIFEST';end if;
 if c.output_prefix is not null and c.output_prefix<>prefix then perform live_streams.clip_queue_cleanup(c.id,c.output_prefix);end if;
 update live_streams.clips set state='ready',output_prefix=prefix,manifest=p_manifest,error_code=null,updated_at=now() where id=c.id;
 update live_streams.clip_jobs set state='done',lease_until=null where id=j.id;
 return jsonb_build_object('ok',true,'state','ready','clip_id',c.id);
end $$;
create function live_streams.clip_claim_cleanup(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare j live_streams.clip_cleanup;lease uuid;items jsonb:='[]';
begin
 for j in select * from live_streams.clip_cleanup where (state='pending' and available_at<=clock_timestamp()) or(state='leased' and lease_until<clock_timestamp()) order by available_at,id for update skip locked limit greatest(0,least(coalesce(p_limit,4),20)) loop
  if exists(select 1 from live_streams.clips c where c.id=j.clip_id and c.state in ('processing','ready') and (j.object_path like c.output_prefix||'%'
   or j.object_path like c.owner_id::text||'/'||c.session_id::text||'/'||c.id::text||'/'||c.current_lease::text||'/%')) then continue;end if;
  if j.attempts>=10 then update live_streams.clip_cleanup set state='dead' where id=j.id;continue;end if;
  lease:=gen_random_uuid();update live_streams.clip_cleanup set state='leased',lease_id=lease,lease_until=clock_timestamp()+interval '1 minute',attempts=attempts+1 where id=j.id;
  items:=items||jsonb_build_array(jsonb_build_object('id',j.id,'lease_id',lease,'bucket',j.bucket,'object_path',j.object_path));
 end loop;
 return jsonb_build_object('items',items);
end $$;
create function live_streams.clip_finish_cleanup(p_id uuid,p_lease_id uuid,p_ok boolean,p_error text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j live_streams.clip_cleanup;
begin
 select * into j from live_streams.clip_cleanup where id=p_id for update;
 if not found or j.state<>'leased' or j.lease_id<>p_lease_id or j.lease_until<clock_timestamp() then return jsonb_build_object('ok',false);end if;
 if p_ok and exists(select 1 from storage.objects where bucket_id=j.bucket and name=j.object_path) then raise exception 'CLIP_ERASURE_NOT_VERIFIED';end if;
 update live_streams.clip_cleanup set state=case when p_ok then 'done' when attempts>=10 then 'dead' else 'pending' end,
  lease_until=null,available_at=clock_timestamp()+interval '5 minutes',last_error=left(p_error,80) where id=j.id;
 return jsonb_build_object('ok',true);
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('live-clips','live-clips',false,536870912,array['video/mp4','image/jpeg','text/vtt'])
 on conflict(id) do update set public=false,file_size_limit=536870912,allowed_mime_types=excluded.allowed_mime_types;

create function live_streams.clip_manage(p_session uuid,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select live_streams.can_view(p_session,p_actor) and live_streams.role_for(p_session,p_actor) in ('host','producer','moderator');
$$;
create function live_streams.clip_can_create(p_session uuid,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from live_streams.sessions s left join live_streams.clip_settings c on c.session_id=s.id
 where s.id=p_session and s.recording_enabled and s.state in ('live','reconnecting','ending','ended')
 and live_streams.can_view(s.id,p_actor) and coalesce(c.copyright_policy,'standard')<>'disabled'
 and (s.host_id=p_actor or (coalesce(c.copyright_policy,'standard')<>'owner_only' and (
 live_streams.role_for(s.id,p_actor) in ('producer','moderator','guest') or coalesce(c.viewer_clipping,false)
 or exists(select 1 from live_streams.clip_approvals a where a.session_id=s.id and a.user_id=p_actor)))));
$$;
create function live_streams.clip_can_read(p_clip uuid,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from live_streams.clips c where c.id=p_clip and c.state<>'deleted' and live_streams.can_view(c.session_id,p_actor) and live_streams.clip_can_create(c.session_id,c.creator_id)
 and (c.creator_id=p_actor or live_streams.clip_manage(c.session_id,p_actor) or
 (c.state='ready' and c.moderation_state='approved' and c.copyright_state='cleared' and exists(select 1 from live_streams.clip_publications p where p.clip_id=c.id and p.state='published'))));
$$;
create function live_streams.clip_settings_json(p_session uuid,p_actor uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('viewer_clipping',coalesce(c.viewer_clipping,false),'review_required',coalesce(c.review_required,true),
 'watermark_required',coalesce(c.watermark_required,true),'watermark',coalesce(c.watermark_required,true),'brand_text',coalesce(c.brand_text,'Platinum Circles'),
 'copyright_policy',coalesce(c.copyright_policy,'standard'),'can_manage',live_streams.clip_manage(s.id,p_actor),
 'approved_user_ids',case when live_streams.clip_manage(s.id,p_actor) then coalesce((select jsonb_agg(a.user_id order by a.user_id) from live_streams.clip_approvals a where a.session_id=s.id),'[]') else '[]'::jsonb end)
 from live_streams.sessions s left join live_streams.clip_settings c on c.session_id=s.id where s.id=p_session;
$$;
create function live_streams.clip_context(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=live_streams.require_user();s live_streams.sessions;path text;ending bigint;available boolean;
begin
 if not live_streams.can_view(p_session,uid) then raise exception 'LIVE_NOT_AVAILABLE' using errcode='42501';end if;
 select * into s from live_streams.sessions where id=p_session;
 select case when s.state='ended' then coalesce(replay_path,playback_path) else playback_path end into path from live_streams.provider_sessions where session_id=p_session;
 available:=s.recording_enabled and s.started_at is not null and path is not null and s.state in ('live','reconnecting','ending','ended');
 ending:=greatest(0,floor(extract(epoch from(coalesce(s.ended_at,now())-s.started_at))*1000)::bigint-case when s.ended_at is null then 5000 else 0 end);
 return jsonb_build_object('session_id',s.id,'can_clip',available and (select enabled from live_streams.clip_runtime where singleton) and live_streams.clip_can_create(s.id,uid),'can_manage',live_streams.clip_manage(s.id,uid),
 'available_start_ms',0,'available_end_ms',coalesce(ending,0),'max_duration_ms',600000,'recording_available',available,
 'viewer_clipping',coalesce((select viewer_clipping from live_streams.clip_settings where session_id=s.id),false),'settings',live_streams.clip_settings_json(s.id,uid));
end $$;
create function live_streams.clip_json(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'session_id',c.session_id,'creator_id',c.creator_id,'title',c.title,'caption',c.caption,'tags',c.tags,
 'state',case when c.state='ready' and c.copyright_state='blocked' then 'blocked' when c.state='ready' and c.moderation_state<>'approved' then 'review' else c.state end,
 'start_ms',c.start_ms,'end_ms',c.end_ms,'cover_ms',c.cover_ms,'formats',c.formats,'watermark',c.watermark,'brand_text',c.brand_text,
 'burn_captions',c.burn_captions,'subtitles',c.subtitles,'moderation_state',c.moderation_state,'copyright_state',c.copyright_state,
 'created_at',c.created_at,'updated_at',c.updated_at,'share_count',m.shares,'view_count',m.views,'thumbnail_url',null,'error',c.error_code)
 from live_streams.clips c left join live_streams.clip_metrics m on m.clip_id=c.id where c.id=p_id;
$$;
create function live_streams.clip_validate_spec(p_payload jsonb,p_context jsonb) returns void language plpgsql set search_path='' as $$
declare a jsonb;prev bigint:=-1;v bigint;duration bigint;
begin
 if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>320000 or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(array['title','caption','tags','start_ms','end_ms','cover_ms','formats','watermark','brand_text','burn_captions','subtitles'])) then raise exception 'INVALID_CLIP_FIELDS';end if;
 if jsonb_typeof(p_payload->'title')<>'string' or length(trim(p_payload->>'title')) not between 1 and 120 or length(coalesce(p_payload->>'caption',''))>2200 then raise exception 'INVALID_CLIP_TITLE';end if;
 if not(coalesce(p_payload->>'start_ms','')~'^[0-9]{1,13}$' and coalesce(p_payload->>'end_ms','')~'^[0-9]{1,13}$' and coalesce(p_payload->>'cover_ms','')~'^[0-9]{1,8}$') then raise exception 'INVALID_CLIP_RANGE';end if;
 duration:=(p_payload->>'end_ms')::bigint-(p_payload->>'start_ms')::bigint;
 if duration not between 1000 and 600000 or (p_payload->>'end_ms')::bigint>(p_context->>'available_end_ms')::bigint or (p_payload->>'cover_ms')::bigint>=duration then raise exception 'INVALID_CLIP_RANGE';end if;
 if jsonb_typeof(p_payload->'formats')<>'array' or jsonb_array_length(p_payload->'formats') not between 1 and 2
 or exists(select 1 from jsonb_array_elements_text(p_payload->'formats') f where f not in ('horizontal','vertical'))
 or (select count(distinct f) from jsonb_array_elements_text(p_payload->'formats') f)<>jsonb_array_length(p_payload->'formats') then raise exception 'INVALID_CLIP_FORMAT';end if;
 if jsonb_typeof(p_payload->'watermark')<>'boolean' or jsonb_typeof(p_payload->'burn_captions')<>'boolean' or length(coalesce(p_payload->>'brand_text',''))>80 then raise exception 'INVALID_CLIP_BRAND';end if;
 if jsonb_typeof(p_payload->'tags')<>'array' or jsonb_array_length(p_payload->'tags')>20 or exists(select 1 from jsonb_array_elements(p_payload->'tags') t where jsonb_typeof(t)<>'string' or length(trim(t#>>'{}')) not between 1 and 50) then raise exception 'INVALID_CLIP_TAGS';end if;
 if jsonb_typeof(p_payload->'subtitles')<>'array' or jsonb_array_length(p_payload->'subtitles')>500 then raise exception 'INVALID_CAPTIONS';end if;
 for a in select * from jsonb_array_elements(p_payload->'subtitles') loop
  if jsonb_typeof(a)<>'object' or not(coalesce(a->>'start_ms','')~'^[0-9]{1,8}$' and coalesce(a->>'end_ms','')~'^[0-9]{1,8}$') then raise exception 'INVALID_CAPTIONS';end if;
  v:=(a->>'start_ms')::bigint;
  if v<prev or (a->>'end_ms')::bigint<=v or (a->>'end_ms')::bigint>duration or jsonb_typeof(a->'text')<>'string' or length(trim(a->>'text')) not between 1 and 500 then raise exception 'INVALID_CAPTIONS';end if;
  prev:=v;
 end loop;
end $$;
create function live_streams.clip_queue_cleanup(p_clip uuid,p_prefix text) returns void language plpgsql security definer set search_path='' as $$
declare asset text;
begin
 if p_prefix is null then return;end if;
 if p_prefix!~'^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/$' then raise exception 'INVALID_CLIP_PREFIX';end if;
 foreach asset in array array['horizontal.mp4','vertical.mp4','thumbnail.jpg','captions.vtt'] loop
 insert into live_streams.clip_cleanup(clip_id,object_path,available_at) values(p_clip,p_prefix||asset,clock_timestamp()+interval '2 hours 10 minutes') on conflict(object_path) do nothing;
 end loop;
end $$;

create function live_streams.clip_publish_one(p_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare p live_streams.clip_publications;c live_streams.clips;s live_streams.sessions;origin text;url text;thumbnail text;published uuid;w integer;h integer;
 old_sub text:=coalesce(current_setting('request.jwt.claim.sub',true),'');old_role text:=coalesce(current_setting('request.jwt.claim.role',true),'');old_claims text:=coalesce(current_setting('request.jwt.claims',true),'');
begin
 select * into p from live_streams.clip_publications where id=p_id for update;
 if not found then raise exception 'PUBLICATION_NOT_FOUND';end if;
 if p.state='published' then return jsonb_build_object('ok',true,'post_id',p.published_id,'state','published');end if;
 select * into c from live_streams.clips where id=p.clip_id for share;
 select * into s from live_streams.sessions where id=c.session_id;
 if c.state<>'ready' or c.moderation_state<>'approved' or c.copyright_state<>'cleared'
 or not live_streams.active_user(p.actor_id,p.auth_session_id) or not live_streams.publisher_allowed(p.actor_id,p.auth_session_id)
 or not live_streams.clip_can_create(c.session_id,c.creator_id) or not live_streams.can_view(c.session_id,p.actor_id)
 or not(c.creator_id=p.actor_id or live_streams.clip_manage(c.session_id,p.actor_id)) then raise exception 'CLIP_PUBLICATION_ACCESS_DENIED' using errcode='42501';end if;
 if not(c.formats ? p.format) then raise exception 'INVALID_CLIP_FORMAT';end if;
 -- An invitation-only or followers-only source cannot accidentally become a
 -- public feed item with visible metadata. Keep those clips in the source library.
 if s.audience<>'public' and p.destination<>'highlight' then raise exception 'PRIVATE_STREAM_EXPORT_RESTRICTED';end if;
 if p.destination in ('x','facebook','instagram','youtube','tiktok') then
 update live_streams.clip_publications set state='export_required',error_code='direct_publishing_not_connected' where id=p.id;
 return jsonb_build_object('ok',true,'state','export_required','publication_id',p.id);end if;
 if p.scheduled_at>clock_timestamp() then return jsonb_build_object('ok',true,'state','scheduled','publication_id',p.id);end if;
 select project_origin into origin from live_streams.clip_runtime where singleton;
 if origin is null then select project_origin into origin from live_streams.worker_settings where singleton;end if;
 if p.destination<>'highlight' and (origin is null or origin!~'^https://[a-z0-9.-]+$') then raise exception 'CLIP_PUBLICATION_ORIGIN_NOT_READY';end if;
 url:=origin||'/storage/v1/object/public/live-clips/'||c.output_prefix||p.format||'.mp4';
 thumbnail:=origin||'/storage/v1/object/public/live-clips/'||c.output_prefix||'thumbnail.jpg';
 w:=case when p.format='vertical' then 720 else 1280 end;h:=case when p.format='vertical' then 1280 else 720 end;
 perform set_config('request.jwt.claim.sub',p.actor_id::text,true),set_config('request.jwt.claim.role','authenticated',true),
 set_config('request.jwt.claims',jsonb_build_object('sub',p.actor_id,'role','authenticated','session_id',p.auth_session_id,'is_anonymous',false)::text,true);
 if p.destination in ('feed','community') then
  if p.destination='community' and not exists(select 1 from public.communities co join public.community_members m on m.community_id=co.id
   where co.id=p.target_id and co.status='active' and m.user_id=p.actor_id and m.status='active'
   and not exists(select 1 from public.community_bans b where b.community_id=co.id and b.user_id=p.actor_id)) then raise exception 'COMMUNITY_POST_ACCESS_DENIED';end if;
  published:=gen_random_uuid();
  update live_streams.clip_publications set published_id=published,state='published',published_at=now() where id=p.id;
  insert into public.posts(id,user_id,content,body,audience,scope,media_url,community_id)
   values(published,p.actor_id,c.title||case when c.caption<>'' then E'\n\n'||c.caption else '' end,null,'everyone','global',url,case when p.destination='community' then p.target_id else null end);
  insert into public.post_media(post_id,url,media_type,sort_order,width,height,edit)
   values(published,url,'video',0,w,h,jsonb_build_object('liveClipId',c.id,'thumbnail',thumbnail,'duration',round((c.end_ms-c.start_ms)/1000.0,3)));
 elsif p.destination='story' then
  if c.end_ms-c.start_ms>90000 then raise exception 'STORY_CLIP_MAX_90_SECONDS';end if;
  published:=gen_random_uuid();
  update live_streams.clip_publications set published_id=published,state='published',published_at=now() where id=p.id;
  insert into public.stories(id,user_id,media_url,media_type,thumbnail_url,duration_sec,caption,scope,audience,reach,allow_sharing)
   values(published,p.actor_id,url,'video',thumbnail,ceil((c.end_ms-c.start_ms)/1000.0)::integer,c.title,'global','everyone','everyone',true);
 elsif p.destination='channel' then
  if not exists(select 1 from public.channels ch join public.channel_members m on m.channel_id=ch.id where ch.id=p.target_id and ch.status='active'
   and m.user_id=p.actor_id and m.role in ('owner','collaborator')) then raise exception 'CHANNEL_POST_ACCESS_DENIED';end if;
  published:=gen_random_uuid();
  update live_streams.clip_publications set published_id=published,state='published',published_at=now() where id=p.id;
  insert into public.channel_messages(id,channel_id,sender_id,content,media_url,media_type)
   values(published,p.target_id,p.actor_id,c.title||case when c.caption<>'' then E'\n\n'||c.caption else '' end,url,'video');
 else published:=c.id;update live_streams.clip_publications set state='published',published_at=now() where id=p.id;
 end if;
 perform set_config('request.jwt.claim.sub',old_sub,true),set_config('request.jwt.claim.role',old_role,true),set_config('request.jwt.claims',old_claims,true);
 return jsonb_build_object('ok',true,'state','published','post_id',published,'story_id',case when p.destination='story' then published else null end,'publication_id',p.id);
exception when others then
 perform set_config('request.jwt.claim.sub',old_sub,true),set_config('request.jwt.claim.role',old_role,true),set_config('request.jwt.claims',old_claims,true);raise;
end $$;
create function live_streams.clip_command(p_session_id uuid,p_clip_id uuid,p_action text,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid;sid uuid;s live_streams.sessions;c live_streams.clips;prior live_streams.commands;ctx jsonb;settings jsonb;result jsonb;cid uuid;p live_streams.clip_publications;staff boolean:=false;v text;scheduled timestamptz;
begin
 if p_action in ('admin_review','copyright','retry','retry_post') and live_streams.staff_role(auth.uid()) is not null then perform live_streams.require_admin(true);uid:=auth.uid();staff:=true;
 else uid:=live_streams.require_user();end if;
 sid:=(auth.jwt()->>'session_id')::uuid;
 if p_request_id is null or p_session_id is null or p_action not in ('create','edit','retry','delete','publish','schedule','share','retry_post','settings','review','admin_review','copyright')
  or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>320000 then raise exception 'INVALID_CLIP_COMMAND';end if;
 perform pg_advisory_xact_lock(hashtextextended('live-clip-command:'||uid::text||':'||p_request_id::text,0));
 select * into prior from live_streams.commands where actor_id=uid and request_id=p_request_id;
 if found then
  if prior.action<>'clip:'||p_action or prior.session_id<>p_session_id or prior.payload<>jsonb_build_object('clip_id',p_clip_id,'payload',p_payload) then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return prior.result||jsonb_build_object('duplicate',true);
 end if;
 select * into s from live_streams.sessions where id=p_session_id;
 if not found or(not staff and not live_streams.can_view(s.id,uid)) then raise exception 'LIVE_NOT_AVAILABLE' using errcode='42501';end if;
 perform live_streams.take_rate('clip_command',uid::text,30,60);
 if p_action='settings' then
  if not live_streams.clip_manage(s.id,uid) then raise exception 'CLIP_MANAGE_ACCESS_DENIED' using errcode='42501';end if;
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(array['viewer_clipping','review_required','watermark_required','watermark','brand_text','approved_user_ids','copyright_policy'])) then raise exception 'INVALID_CLIP_SETTINGS';end if;
  settings:=live_streams.clip_settings_json(s.id,uid)||p_payload;
  if jsonb_typeof(settings->'viewer_clipping')<>'boolean' or jsonb_typeof(settings->'review_required')<>'boolean'
   or jsonb_typeof(coalesce(p_payload->'watermark_required',p_payload->'watermark',settings->'watermark_required'))<>'boolean'
   or length(settings->>'brand_text')>80 or settings->>'copyright_policy' not in ('standard','owner_only','disabled') then raise exception 'INVALID_CLIP_SETTINGS';end if;
  if p_payload ? 'approved_user_ids' and (jsonb_typeof(p_payload->'approved_user_ids')<>'array' or jsonb_array_length(p_payload->'approved_user_ids')>50) then raise exception 'INVALID_CLIP_SETTINGS';end if;
  insert into live_streams.clip_settings(session_id,viewer_clipping,review_required,watermark_required,brand_text,copyright_policy)
  values(s.id,(settings->>'viewer_clipping')::boolean,(settings->>'review_required')::boolean,coalesce((p_payload->>'watermark_required')::boolean,(p_payload->>'watermark')::boolean,(settings->>'watermark_required')::boolean),settings->>'brand_text',settings->>'copyright_policy')
  on conflict(session_id) do update set viewer_clipping=excluded.viewer_clipping,review_required=excluded.review_required,watermark_required=excluded.watermark_required,brand_text=excluded.brand_text,copyright_policy=excluded.copyright_policy,updated_at=now();
  if p_payload ? 'approved_user_ids' then
   delete from live_streams.clip_approvals where session_id=s.id;
   for v in select distinct jsonb_array_elements_text(p_payload->'approved_user_ids') loop
    if not exists(select 1 from public.profiles where id=v::uuid) then raise exception 'INVALID_CLIP_APPROVAL';end if;
    insert into live_streams.clip_approvals(session_id,user_id) values(s.id,v::uuid);
   end loop;
  end if;
  result:=jsonb_build_object('ok',true,'settings',live_streams.clip_settings_json(s.id,uid));
 elsif p_action='create' then
  if not(select enabled from live_streams.clip_runtime where singleton) then raise exception 'CLIP_PROCESSOR_NOT_READY';end if;
  if not live_streams.publisher_allowed(uid,sid) or not live_streams.clip_can_create(s.id,uid) then raise exception 'CLIP_ACCESS_DENIED' using errcode='42501';end if;
  ctx:=live_streams.clip_context(s.id);if not(ctx->>'recording_available')::boolean then raise exception 'RECORDING_NOT_AVAILABLE';end if;
  perform live_streams.clip_validate_spec(p_payload,ctx);
  perform pg_advisory_xact_lock(hashtextextended('live-clip-admission:'||uid::text,0));
  if (select count(*) from live_streams.clips where creator_id=uid and state in ('queued','processing'))>=(select max_pending_per_creator from live_streams.clip_runtime where singleton) then raise exception 'CLIP_QUEUE_CAPACITY_REACHED';end if;
  settings:=live_streams.clip_settings_json(s.id,uid);
  cid:=gen_random_uuid();
  insert into live_streams.clips(id,session_id,creator_id,owner_id,auth_session_id,title,caption,tags,start_ms,end_ms,cover_ms,formats,watermark,brand_text,burn_captions,subtitles,moderation_state)
  values(cid,s.id,uid,s.host_id,sid,trim(p_payload->>'title'),coalesce(p_payload->>'caption',''),p_payload->'tags',(p_payload->>'start_ms')::bigint,(p_payload->>'end_ms')::bigint,(p_payload->>'cover_ms')::integer,
   p_payload->'formats',(settings->>'watermark_required')::boolean or(p_payload->>'watermark')::boolean,case when(settings->>'watermark_required')::boolean then settings->>'brand_text' else p_payload->>'brand_text' end,
   (p_payload->>'burn_captions')::boolean,p_payload->'subtitles',case when live_streams.clip_manage(s.id,uid) or not(settings->>'review_required')::boolean then 'approved' else 'pending' end);
  insert into live_streams.clip_jobs(clip_id,revision) values(cid,1);
  result:=jsonb_build_object('ok',true,'clip_id',cid,'state','queued');
 else
  select * into c from live_streams.clips where id=p_clip_id and session_id=s.id for update;
  if not found or c.state='deleted' then raise exception 'CLIP_NOT_AVAILABLE';end if;
  if not staff and not(c.creator_id=uid or live_streams.clip_manage(s.id,uid)) then raise exception 'CLIP_ACCESS_DENIED' using errcode='42501';end if;
  cid:=c.id;
  if p_action in ('review','admin_review') then
   if p_action='admin_review' and not staff then perform live_streams.require_admin(true);end if;
   if p_action='review' and not live_streams.clip_manage(s.id,uid) then raise exception 'CLIP_MANAGE_ACCESS_DENIED';end if;
   if p_payload->>'decision' not in ('approved','rejected') or length(trim(coalesce(p_payload->>'reason',''))) not between 1 and 1000 then raise exception 'INVALID_CLIP_REVIEW';end if;
   update live_streams.clips set moderation_state=p_payload->>'decision',updated_at=now() where id=c.id;
   if p_payload->>'decision'='rejected' then update live_streams.clip_publications set state='revoked' where clip_id=c.id and state in ('published','scheduled','pending');end if;
   result:=jsonb_build_object('ok',true,'clip_id',c.id,'state',c.state);
  elsif p_action='copyright' then
   if not staff and not live_streams.clip_manage(s.id,uid) then raise exception 'CLIP_MANAGE_ACCESS_DENIED';end if;
   if p_payload->>'status' not in ('cleared','blocked') or length(trim(coalesce(p_payload->>'reason',''))) not between 1 and 1000 then raise exception 'INVALID_COPYRIGHT_REVIEW';end if;
   update live_streams.clips set copyright_state=p_payload->>'status',updated_at=now() where id=c.id;
   if p_payload->>'status'='blocked' then update live_streams.clip_publications set state='revoked' where clip_id=c.id and state in ('published','scheduled','pending');end if;
   result:=jsonb_build_object('ok',true,'clip_id',c.id);
  elsif p_action='delete' then
   update live_streams.clips set state='deleted',updated_at=now() where id=c.id;
   update live_streams.clip_publications set state='revoked' where clip_id=c.id;
   update live_streams.clip_jobs set state='dead',lease_until=null where clip_id=c.id and state in ('pending','leased');
   perform live_streams.clip_queue_cleanup(c.id,c.output_prefix);
   if c.current_lease is not null then perform live_streams.clip_queue_cleanup(c.id,c.owner_id::text||'/'||c.session_id::text||'/'||c.id::text||'/'||c.current_lease::text||'/');end if;
   result:=jsonb_build_object('ok',true,'clip_id',c.id,'state','deleted');
  elsif p_action in ('edit','retry') then
   if not(select enabled from live_streams.clip_runtime where singleton) then raise exception 'CLIP_PROCESSOR_NOT_READY';end if;
   if c.state='processing' then raise exception 'CLIP_PROCESSING_CONFLICT';end if;
   if exists(select 1 from live_streams.clip_publications where clip_id=c.id and state='published') then raise exception 'PUBLISHED_CLIP_IMMUTABLE';end if;
   if not live_streams.clip_can_create(s.id,c.creator_id) then raise exception 'CLIP_ACCESS_DENIED';end if;
   if p_action='edit' then
    ctx:=live_streams.clip_context(s.id);perform live_streams.clip_validate_spec(p_payload,ctx);settings:=live_streams.clip_settings_json(s.id,uid);
    update live_streams.clips set title=trim(p_payload->>'title'),caption=coalesce(p_payload->>'caption',''),tags=p_payload->'tags',start_ms=(p_payload->>'start_ms')::bigint,end_ms=(p_payload->>'end_ms')::bigint,
     cover_ms=(p_payload->>'cover_ms')::integer,formats=p_payload->'formats',watermark=(settings->>'watermark_required')::boolean or(p_payload->>'watermark')::boolean,
     brand_text=case when(settings->>'watermark_required')::boolean then settings->>'brand_text' else p_payload->>'brand_text' end,burn_captions=(p_payload->>'burn_captions')::boolean,subtitles=p_payload->'subtitles',
     moderation_state=case when live_streams.clip_manage(s.id,uid) then 'approved' else 'pending' end where id=c.id;
   end if;
   if c.output_prefix is not null then perform live_streams.clip_queue_cleanup(c.id,c.output_prefix);end if;
   update live_streams.clips set state='queued',render_revision=render_revision+1,current_lease=null,output_prefix=null,manifest=null,error_code=null,updated_at=now(),auth_session_id=case when creator_id=uid then sid else auth_session_id end where id=c.id;
   insert into live_streams.clip_jobs(clip_id,revision) values(c.id,c.render_revision+1);
   result:=jsonb_build_object('ok',true,'clip_id',c.id,'state','queued');
  elsif p_action='retry_post' then
   select * into p from live_streams.clip_publications where id=(p_payload->>'post_id')::uuid and clip_id=c.id for update;
   if not found or p.state<>'failed' or (not staff and p.actor_id<>uid) then raise exception 'INVALID_PUBLICATION_RETRY';end if;
   update live_streams.clip_publications set state='pending',attempts=0,next_attempt_at=now(),error_code=null,auth_session_id=case when actor_id=uid then sid else auth_session_id end where id=p.id;
   result:=live_streams.clip_publish_one(p.id);
  else
   if c.state<>'ready' or c.moderation_state<>'approved' or c.copyright_state<>'cleared' then raise exception 'CLIP_NOT_READY';end if;
   if p_payload->>'destination' not in ('feed','story','channel','community','highlight','x','facebook','instagram','youtube','tiktok') or p_payload->>'format' not in ('horizontal','vertical') then raise exception 'INVALID_CLIP_DESTINATION';end if;
   scheduled:=nullif(p_payload->>'scheduled_at','')::timestamptz;
   if scheduled is not null and (scheduled<now() or scheduled>now()+interval '365 days') then raise exception 'INVALID_SCHEDULE';end if;
   insert into live_streams.clip_publications(clip_id,actor_id,auth_session_id,destination,target_id,format,state,scheduled_at,next_attempt_at)
   values(c.id,uid,sid,p_payload->>'destination',nullif(p_payload->>'target_id','')::uuid,p_payload->>'format',case when scheduled>now() then 'scheduled' else 'pending' end,scheduled,coalesce(scheduled,now())) returning * into p;
   result:=live_streams.clip_publish_one(p.id);
  end if;
 end if;
 insert into live_streams.clip_audit(clip_id,session_id,actor_id,action,reason) values(cid,s.id,uid,p_action,left(p_payload->>'reason',1000));
 insert into live_streams.commands(actor_id,request_id,session_id,action,payload,result) values(uid,p_request_id,s.id,'clip:'||p_action,jsonb_build_object('clip_id',p_clip_id,'payload',p_payload),result);
 return result;
end $$;

create function live_streams.clip_publication_json(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'clip_id',p.clip_id,'destination',p.destination,'platform',p.destination,'target_id',p.target_id,'format',p.format,'state',p.state,
 'created_at',p.created_at,'scheduled_at',p.scheduled_at,'published_at',p.published_at,'published_id',p.published_id,'attempts',p.attempts,
 'next_attempt_at',p.next_attempt_at,'external_url',p.external_url,'error_code',p.error_code,'error',p.error_code,'retryable',p.state='failed')
 from live_streams.clip_publications p where p.id=p_id;
$$;
create function live_streams.clip_library(p_session_id uuid,p_cursor jsonb,p_limit integer,p_sort text,p_admin boolean default false,p_state text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid;ct timestamptz;ci uuid;cursor_score bigint;lim integer:=greatest(1,least(coalesce(p_limit,24),24));items jsonb;next_cursor jsonb;
begin
 if p_admin then perform live_streams.require_admin(false);uid:=auth.uid();else uid:=live_streams.require_user();end if;
 if p_sort not in ('newest','top','shared') then raise exception 'INVALID_CLIP_SORT';end if;
 if p_cursor is not null then ct:=(p_cursor->>'created_at')::timestamptz;ci:=(p_cursor->>'id')::uuid;cursor_score:=coalesce((p_cursor->>'score')::bigint,0);if ct is null or ci is null then raise exception 'INVALID_CURSOR';end if;end if;
 with indexed_sources as materialized (
 (select c.id,c.created_at,case p_sort when 'top' then coalesce(m.views,0) when 'shared' then coalesce(m.shares,0) else 0 end as score from live_streams.clips c left join live_streams.clip_metrics m on m.clip_id=c.id
 where p_session_id is not null and c.session_id=p_session_id and c.state<>'deleted' and(p_state is null or c.state=p_state or c.moderation_state=p_state or c.copyright_state=p_state)
 and(p_admin or live_streams.clip_can_read(c.id,uid)) and(ct is null or(case p_sort when 'top' then coalesce(m.views,0) when 'shared' then coalesce(m.shares,0) else 0 end,c.created_at,c.id)<(cursor_score,ct,ci))
 order by score desc,c.created_at desc,c.id desc limit lim+1)
 union all
 (select c.id,c.created_at,case p_sort when 'top' then coalesce(m.views,0) when 'shared' then coalesce(m.shares,0) else 0 end as score from live_streams.clips c left join live_streams.clip_metrics m on m.clip_id=c.id
 where p_admin and p_session_id is null and c.state<>'deleted' and(p_state is null or c.state=p_state or c.moderation_state=p_state or c.copyright_state=p_state)
 and(true) and(ct is null or(case p_sort when 'top' then coalesce(m.views,0) when 'shared' then coalesce(m.shares,0) else 0 end,c.created_at,c.id)<(cursor_score,ct,ci))
 order by score desc,c.created_at desc,c.id desc limit lim+1)
 union all
 (select c.id,c.created_at,case p_sort when 'top' then coalesce(m.views,0) when 'shared' then coalesce(m.shares,0) else 0 end as score from live_streams.clips c left join live_streams.clip_metrics m on m.clip_id=c.id
 where not p_admin and p_session_id is null and c.creator_id=uid and c.state<>'deleted' and(p_state is null or c.state=p_state or c.moderation_state=p_state or c.copyright_state=p_state)
 and(live_streams.clip_can_read(c.id,uid)) and(ct is null or(case p_sort when 'top' then coalesce(m.views,0) when 'shared' then coalesce(m.shares,0) else 0 end,c.created_at,c.id)<(cursor_score,ct,ci))
 order by score desc,c.created_at desc,c.id desc limit lim+1)
 union all
 (select c.id,c.created_at,case p_sort when 'top' then coalesce(m.views,0) when 'shared' then coalesce(m.shares,0) else 0 end as score from live_streams.clips c left join live_streams.clip_metrics m on m.clip_id=c.id
 where not p_admin and p_session_id is null and c.owner_id=uid and c.creator_id<>uid and c.state<>'deleted' and(p_state is null or c.state=p_state or c.moderation_state=p_state or c.copyright_state=p_state)
 and(live_streams.clip_can_read(c.id,uid)) and(ct is null or(case p_sort when 'top' then coalesce(m.views,0) when 'shared' then coalesce(m.shares,0) else 0 end,c.created_at,c.id)<(cursor_score,ct,ci))
 order by score desc,c.created_at desc,c.id desc limit lim+1)
 union all
 (select c.id,c.created_at,case p_sort when 'top' then coalesce(m.views,0) when 'shared' then coalesce(m.shares,0) else 0 end as score from live_streams.clips c left join live_streams.clip_metrics m on m.clip_id=c.id
 where not p_admin and p_session_id is null and c.creator_id<>uid and c.owner_id<>uid and c.session_id in(select session_id from live_streams.members where user_id=uid and status='accepted' and role in ('producer','moderator')) and c.state<>'deleted' and(p_state is null or c.state=p_state or c.moderation_state=p_state or c.copyright_state=p_state)
 and(live_streams.clip_can_read(c.id,uid)) and(ct is null or(case p_sort when 'top' then coalesce(m.views,0) when 'shared' then coalesce(m.shares,0) else 0 end,c.created_at,c.id)<(cursor_score,ct,ci))
 order by score desc,c.created_at desc,c.id desc limit lim+1)
 ), candidates as materialized (select * from indexed_sources order by score desc,created_at desc,id desc limit lim+1 ), page as(select * from candidates order by score desc,created_at desc,id desc limit lim)
 select coalesce((select jsonb_agg(live_streams.clip_json(id) order by score desc,created_at desc,id desc) from page),'[]'),
 case when(select count(*) from candidates)>lim then(select jsonb_build_object('created_at',created_at,'id',id,'score',score) from page order by score,created_at,id limit 1)else null end into items,next_cursor;
 return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
create function live_streams.clip_link_public(p_clip uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from live_streams.clips c join live_streams.sessions s on s.id=c.session_id where c.id=p_clip and s.audience='public'
 and c.state='ready' and c.moderation_state='approved' and c.copyright_state='cleared' and live_streams.clip_can_create(s.id,c.creator_id)
 and exists(select 1 from live_streams.clip_publications cp where cp.clip_id=c.id and cp.state='published' and(cp.destination='highlight'
 or(cp.destination='feed' and exists(select 1 from public.posts po join public.profiles pr on pr.id=po.user_id where po.id=cp.published_id
 and po.archived_at is null and po.audience='everyone' and po.community_id is null and coalesce(pr.profile_visibility,'public')<>'private')))));
$$;
create function live_streams.clip_get(p_clip uuid,p_admin boolean default false,p_cursor jsonb default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid;can_manage boolean;c live_streams.clips;ct timestamptz;ci uuid;items jsonb;nc jsonb;audit jsonb;posts jsonb;metrics jsonb;
begin
 if p_admin then perform live_streams.require_admin(false);uid:=auth.uid();else uid:=live_streams.require_user();end if;
 select * into c from live_streams.clips where id=p_clip;
 if not found or(not p_admin and not live_streams.clip_can_read(c.id,uid)) then raise exception 'CLIP_NOT_AVAILABLE' using errcode='42501';end if;
 can_manage:=p_admin or c.creator_id=uid or live_streams.clip_manage(c.session_id,uid);
 if p_cursor is not null then ct:=(p_cursor->>'created_at')::timestamptz;ci:=(p_cursor->>'id')::uuid;if ct is null or ci is null then raise exception 'INVALID_CURSOR';end if;end if;
 with candidates as materialized(select id,created_at from live_streams.clip_publications where clip_id=c.id and can_manage and(ct is null or(created_at,id)<(ct,ci)) order by created_at desc,id desc limit 26),
 page as(select * from candidates order by created_at desc,id desc limit 25)
 select coalesce((select jsonb_agg(live_streams.clip_publication_json(id) order by created_at desc,id desc) from page),'[]'),
 case when(select count(*) from candidates)>25 then(select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)else null end into items,nc;
 posts:=jsonb_build_object('items',items,'next_cursor',nc);
 with candidates as materialized(select * from live_streams.clip_audit where clip_id=c.id and can_manage and(ct is null or(created_at,id)<(ct,ci)) order by created_at desc,id desc limit 26),
 page as(select * from candidates order by created_at desc,id desc limit 25)
 select coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'),
 case when(select count(*) from candidates)>25 then(select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)else null end into items,nc;
 audit:=jsonb_build_object('items',items,'next_cursor',nc);
 select jsonb_build_object('views',m.views,'shares',m.shares,'updated_at',m.updated_at) into metrics from live_streams.clip_metrics m where clip_id=c.id;
 return jsonb_build_object('clip',live_streams.clip_json(c.id),'can_manage',can_manage,
 'permissions',jsonb_build_object('can_share_link',live_streams.clip_link_public(c.id),'can_manage',can_manage,'can_publish',can_manage and c.state='ready' and c.moderation_state='approved' and c.copyright_state='cleared',
 'can_review',p_admin or live_streams.clip_manage(c.session_id,uid),'moderate',p_admin and live_streams.staff_role(uid) in ('super_admin','platform_admin','trust_safety'),
 'configure',p_admin and live_streams.staff_role(uid) in ('super_admin','platform_admin'),'retry',can_manage),
 'publication_history',posts,'posts',posts,'audit',audit,'connections',jsonb_build_object('items','[]'::jsonb,'next_cursor',null),'analytics',coalesce(metrics,'{}'));
end $$;
create function live_streams.clip_asset_access(p_clip uuid,p_format text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid;c live_streams.clips;name text;path text;staff boolean:=false;
begin
 if live_streams.staff_role(auth.uid()) is not null then perform live_streams.require_admin(true);uid:=auth.uid();staff:=true;else uid:=live_streams.require_user();end if;
 select * into c from live_streams.clips where id=p_clip;
 if not found or c.state<>'ready' or(not staff and(c.copyright_state<>'cleared' or not live_streams.clip_can_read(c.id,uid) or not live_streams.clip_can_create(c.session_id,c.creator_id))) then raise exception 'CLIP_ASSET_ACCESS_DENIED' using errcode='42501';end if;
 name:=case when p_format in ('vertical','horizontal') then p_format||'.mp4' when p_format in ('thumbnail','cover') then 'thumbnail.jpg' when p_format in ('subtitles','captions') then 'captions.vtt' else null end;
 if name is null or not exists(select 1 from jsonb_array_elements(c.manifest->'assets') a where a->>'name'=name) then raise exception 'CLIP_ASSET_NOT_AVAILABLE';end if;
 path:=c.output_prefix||name;
 if not exists(select 1 from storage.objects where bucket_id='live-clips' and storage.objects.name=path and user_metadata->>'live_clip_id'=c.id::text and user_metadata->>'live_clip_lease_id'=c.current_lease::text) then raise exception 'CLIP_ASSET_NOT_AVAILABLE';end if;
 if staff then insert into live_streams.clip_audit(clip_id,session_id,actor_id,action,reason) values(c.id,c.session_id,uid,'admin_preview','Authorized moderation media review');end if;
 return jsonb_build_object('bucket','live-clips','object_path',path,'filename','platinum-live-'||c.id::text||'-'||name);
end $$;
create function live_streams.clip_reference_access(p_bucket text,p_path text,p_kind text,p_content_id uuid,p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c live_streams.clips;p live_streams.clip_publications;cid uuid;allowed boolean:=false;name text;author uuid;
begin
 if p_bucket<>'live-clips' or p_actor_id is null or p_actor_id is distinct from auth.uid() or p_path!~'^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/(horizontal.mp4|vertical.mp4|thumbnail.jpg|captions.vtt)$' then return jsonb_build_object('allowed',false);end if;
 begin cid:=split_part(p_path,'/',3)::uuid;exception when invalid_text_representation then return jsonb_build_object('allowed',false);end;
 select * into c from live_streams.clips where id=cid;
 name:=split_part(p_path,'/',5);
 if not found or c.state<>'ready' or c.moderation_state<>'approved' or c.copyright_state<>'cleared' or c.output_prefix||name<>p_path
 or not live_streams.can_view(c.session_id,p_actor_id) or not live_streams.clip_can_create(c.session_id,c.creator_id)
 or not exists(select 1 from jsonb_array_elements(c.manifest->'assets') a where a->>'name'=name) then return jsonb_build_object('allowed',false);end if;
 select * into p from live_streams.clip_publications where clip_id=c.id and published_id=p_content_id and state='published'
 and ((p_kind='post' and destination in ('feed','community')) or(p_kind='story' and destination='story') or(p_kind in ('channel','channel_message') and destination='channel')) limit 1;
 if not found then return jsonb_build_object('allowed',false);end if;
 if name like '%.mp4' and name<>p.format||'.mp4' then return jsonb_build_object('allowed',false);end if;
 if p_kind='post' then
  select po.user_id,public.can_view_post(po.id) and(po.archived_at is null or po.user_id=p_actor_id)
  and(po.user_id=p_actor_id or coalesce(po.audience,'everyone')='everyone'
   or(po.audience='followers' and exists(select 1 from public.follows f where f.follower_id=p_actor_id and f.following_id=po.user_id))
   or(po.audience='mentioned' and exists(select 1 from public.post_mentions m where m.post_id=po.id and m.mentioned_user_id=p_actor_id))
   or(po.audience='verified' and exists(select 1 from public.profiles v where v.id=p_actor_id and v.is_verified)))
  into author,allowed from public.posts po where po.id=p_content_id;
 elsif p_kind='story' then select st.user_id,(st.user_id=p_actor_id or public.viewer_can_see_story(st.id)) into author,allowed from public.stories st where st.id=p_content_id;
 else select m.sender_id,public.social_can_read_channel(m.channel_id) into author,allowed from public.channel_messages m where m.id=p_content_id and m.channel_id=p.target_id;end if;
 if author is null or exists(select 1 from public.blocked_users b where(b.blocker_id=p_actor_id and b.blocked_id=author)or(b.blocker_id=author and b.blocked_id=p_actor_id))
 or(author<>p_actor_id and exists(select 1 from public.profiles pr where pr.id=author and pr.profile_visibility='private')
 and not exists(select 1 from public.follows f where f.follower_id=p_actor_id and f.following_id=author)) then allowed:=false;end if;
 return jsonb_build_object('allowed',coalesce(allowed,false),'clip_id',c.id,'session_id',c.session_id,'lease_id',c.current_lease);
end $$;
-- Direct clip reads inherit the actual publication audience. A private
-- channel publication or deleted feed post never makes a clip globally readable.
create or replace function live_streams.clip_can_read(p_clip uuid,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from live_streams.clips c where c.id=p_clip and c.state<>'deleted' and live_streams.can_view(c.session_id,p_actor)
 and live_streams.clip_can_create(c.session_id,c.creator_id) and(c.creator_id=p_actor or live_streams.clip_manage(c.session_id,p_actor)
 or(c.state='ready' and c.moderation_state='approved' and c.copyright_state='cleared' and exists(select 1 from live_streams.clip_publications pub where pub.clip_id=c.id and pub.state='published'
 and(pub.destination='highlight' or coalesce((live_streams.clip_reference_access('live-clips',c.output_prefix||pub.format||'.mp4',case pub.destination when 'story' then 'story' when 'channel' then 'channel' else 'post' end,pub.published_id,p_actor)->>'allowed')::boolean,false))))));
$$;
create function live_streams.clip_process_publications(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare p live_streams.clip_publications;ok integer:=0;failed integer:=0;result jsonb;err text;
begin
 for p in select * from live_streams.clip_publications where state in ('pending','scheduled') and next_attempt_at<=clock_timestamp() order by next_attempt_at,id for update skip locked limit greatest(0,least(coalesce(p_limit,20),20)) loop
  begin
   result:=live_streams.clip_publish_one(p.id);ok:=ok+1;
  exception when others then
   err:=case when sqlerrm~'^[A-Z_]{1,80}$' then lower(sqlerrm) else 'publication_failed' end;
   update live_streams.clip_publications set state=case when attempts>=4 then 'failed' else 'pending' end,attempts=attempts+1,error_code=err,
   next_attempt_at=clock_timestamp()+make_interval(secs=>least(1800,30*(2^least(attempts,5))::integer)) where id=p.id;failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('ok',true,'published',ok,'failed',failed);
end $$;
create function live_streams.clip_platform_connections(p_cursor jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=live_streams.require_user();ct timestamptz;ci uuid;items jsonb;nc jsonb;
begin
 if p_cursor is not null then ct:=(p_cursor->>'created_at')::timestamptz;ci:=(p_cursor->>'id')::uuid;if ct is null or ci is null then raise exception 'INVALID_CURSOR';end if;end if;
 with candidates as materialized(select id,created_at from live_streams.clip_publications where actor_id=uid and destination in ('x','facebook','instagram','youtube','tiktok')
 and(ct is null or(created_at,id)<(ct,ci)) order by created_at desc,id desc limit 26),page as(select * from candidates order by created_at desc,id desc limit 25)
 select coalesce((select jsonb_agg(live_streams.clip_publication_json(id) order by created_at desc,id desc) from page),'[]'),
 case when(select count(*) from candidates)>25 then(select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)else null end into items,nc;
 -- Direct platform posting requires an independently verified OAuth connector.
 -- Export requests are history, never evidence that another platform published.
 return jsonb_build_object('items','[]'::jsonb,'history',items,'next_cursor',nc,'direct_publishing',false);
end $$;

create function live_streams.clip_bind_storage_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare c live_streams.clips;j live_streams.clip_jobs;clip uuid;job uuid;lease uuid;asset text;
begin
 if new.bucket_id<>'live-clips' then
  if tg_op='UPDATE' and old.bucket_id='live-clips' then raise exception 'CLIP_OBJECT_IMMUTABLE';end if;return new;
 end if;
 if new.name!~'^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/(horizontal.mp4|vertical.mp4|thumbnail.jpg|captions.vtt)$' then raise exception 'INVALID_CLIP_OBJECT';end if;
 begin clip:=(new.user_metadata->>'live_clip_id')::uuid;job:=(new.user_metadata->>'live_clip_job_id')::uuid;lease:=(new.user_metadata->>'live_clip_lease_id')::uuid;
 exception when invalid_text_representation then raise exception 'INVALID_CLIP_OBJECT';end;
 if clip is null or job is null or lease is null or coalesce(new.user_metadata->>'sha256','')!~'^[a-f0-9]{64}$' then raise exception 'INVALID_CLIP_OBJECT';end if;
 select * into c from live_streams.clips where id=clip;
 select * into j from live_streams.clip_jobs where id=job and clip_id=clip;
 if not coalesce((live_streams.clip_check_job(job,lease)->>'ok')::boolean,false)
  or new.name<>c.owner_id::text||'/'||c.session_id::text||'/'||c.id::text||'/'||lease::text||'/'||split_part(new.name,'/',5)
  or(tg_op='UPDATE' and(old.bucket_id<>new.bucket_id or old.name<>new.name)) then raise exception 'CLIP_LEASE_LOST';end if;
 asset:=split_part(new.name,'/',5);
 if(asset like '%.mp4' and not(c.formats ? replace(asset,'.mp4',''))) or(asset='captions.vtt' and jsonb_array_length(c.subtitles)=0) then raise exception 'INVALID_CLIP_OBJECT';end if;
 new.owner:=c.creator_id;new.owner_id:=c.creator_id::text;
 return new;
end $$;
create trigger live_clip_storage_provenance before insert or update on storage.objects for each row execute function live_streams.clip_bind_storage_owner();
create function live_streams.clip_before_delete() returns trigger language plpgsql security definer set search_path='' as $$
declare j record;
begin
 perform live_streams.clip_queue_cleanup(old.id,old.output_prefix);
 if old.current_lease is not null then perform live_streams.clip_queue_cleanup(old.id,old.owner_id::text||'/'||old.session_id::text||'/'||old.id::text||'/'||old.current_lease::text||'/');end if;
 for j in select lease_id from live_streams.clip_jobs where clip_id=old.id and lease_id is not null loop
 perform live_streams.clip_queue_cleanup(old.id,old.owner_id::text||'/'||old.session_id::text||'/'||old.id::text||'/'||j.lease_id::text||'/');end loop;
 return old;
end $$;
create trigger live_clip_before_delete before delete on live_streams.clips for each row execute function live_streams.clip_before_delete();
create function public.live_clip_configure(p_origin text,p_enabled boolean,p_max_active integer default 2) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_origin is null or p_origin!~'^https://[a-z0-9]{20}[.]supabase[.]co$' or p_enabled is null or p_max_active not between 1 and 100 then raise exception 'INVALID_CLIP_CONFIGURATION';end if;
 update live_streams.clip_runtime set project_origin=p_origin,enabled=p_enabled,max_active=p_max_active where singleton;
 return jsonb_build_object('ok',true,'origin',p_origin,'enabled',p_enabled,'max_active',p_max_active);
end $$;
create function public.live_clip_context(p_session_id uuid) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_context(p_session_id)$$;
create function public.live_clip_settings(p_session_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare uid uuid:=live_streams.require_user();begin if not live_streams.can_view(p_session_id,uid) then raise exception 'LIVE_NOT_AVAILABLE';end if;return live_streams.clip_settings_json(p_session_id,uid);end$$;
create function public.live_clip_library(p_session_id uuid default null,p_cursor jsonb default null,p_limit integer default 24,p_sort text default 'newest') returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_library(p_session_id,p_cursor,p_limit,p_sort)$$;
create function public.live_clip_get(p_clip_id uuid) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_get(p_clip_id)$$;
create function public.live_clip_history(p_clip_id uuid,p_cursor jsonb default null) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_get(p_clip_id,false,p_cursor)->'publication_history'$$;
create function public.live_clip_command(p_session_id uuid,p_clip_id uuid,p_action text,p_payload jsonb,p_request_id uuid) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_command(p_session_id,p_clip_id,p_action,p_payload,p_request_id)$$;
create function public.live_admin_clips(p_session_id uuid default null,p_state text default null,p_cursor jsonb default null,p_limit integer default 24) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_library(p_session_id,p_cursor,p_limit,'newest',true,p_state)$$;
create function public.live_admin_clip(p_clip_id uuid,p_cursor jsonb default null) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_get(p_clip_id,true,p_cursor)$$;
create function public.live_platform_connections(p_cursor jsonb default null) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_platform_connections(p_cursor)$$;
create function public.live_clip_asset_access(p_clip_id uuid,p_format text) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_asset_access(p_clip_id,p_format)$$;
create function public.live_claim_clip_jobs(p_limit integer default 1) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_claim_jobs(p_limit)$$;
create function public.live_check_clip_job(p_id uuid,p_lease_id uuid) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_check_job(p_id,p_lease_id)$$;
create function public.live_finish_clip_job(p_id uuid,p_lease_id uuid,p_ok boolean,p_manifest jsonb default null,p_error text default null) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_finish_job(p_id,p_lease_id,p_ok,p_manifest,p_error)$$;
create function public.live_claim_clip_cleanup(p_limit integer default 4) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_claim_cleanup(p_limit)$$;
create function public.live_finish_clip_cleanup(p_id uuid,p_lease_id uuid,p_ok boolean,p_error text default null) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_finish_cleanup(p_id,p_lease_id,p_ok,p_error)$$;
create function public.live_process_clip_publications(p_limit integer default 20) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_process_publications(p_limit)$$;
create function public.live_clip_reference_access(p_bucket text,p_path text,p_kind text,p_content_id uuid,p_actor_id uuid) returns jsonb language sql security definer set search_path='' as $$select live_streams.clip_reference_access(p_bucket,p_path,p_kind,p_content_id,p_actor_id)$$;
create function public.live_clip_metrics_batch(p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>200 then raise exception 'INVALID_METRICS_BATCH';end if;
 for r in select * from jsonb_array_elements(p_items) loop
 if coalesce(r->>'views','')!~'^[0-9]{1,15}$' or coalesce(r->>'shares','')!~'^[0-9]{1,15}$' then raise exception 'INVALID_METRICS';end if;
 insert into live_streams.clip_metrics(clip_id,views,shares,updated_at) values((r->>'clip_id')::uuid,(r->>'views')::bigint,(r->>'shares')::bigint,(r->>'updated_at')::timestamptz)
 on conflict(clip_id) do update set views=greatest(live_streams.clip_metrics.views,excluded.views),shares=greatest(live_streams.clip_metrics.shares,excluded.shares),updated_at=excluded.updated_at
 where live_streams.clip_metrics.updated_at<excluded.updated_at;
 end loop;
 return jsonb_build_object('ok',true,'count',jsonb_array_length(p_items));
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure as sig,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where(n.nspname='live_streams' and p.proname like 'clip_%') or(n.nspname='public' and(p.proname like 'live_clip_%' or p.proname like 'live_admin_clip%' or p.proname in('live_claim_clip_jobs','live_check_clip_job','live_finish_clip_job','live_claim_clip_cleanup','live_finish_clip_cleanup','live_process_clip_publications','live_platform_connections'))) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 if f.nspname='public' then
  if f.proname in('live_claim_clip_jobs','live_check_clip_job','live_finish_clip_job','live_claim_clip_cleanup','live_finish_clip_cleanup','live_process_clip_publications','live_clip_reference_access','live_clip_metrics_batch','live_clip_configure') then execute format('grant execute on function %s to service_role',f.sig);
  else execute format('grant execute on function %s to authenticated',f.sig);end if;
 end if;
 end loop;
end$$;
alter table live_streams.sessions drop constraint if exists sessions_topic_check;
alter table live_streams.sessions add constraint sessions_topic_check check(topic in ('irl','gaming','news','politics','business','music','concerts','education','sports','events','communities','other'));
create or replace function live_streams.directory(p_filter text,p_topic text,p_state text,p_cursor jsonb,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=live_streams.require_user();lim integer:=greatest(1,least(coalesce(p_limit,24),24));items jsonb;next_cursor jsonb;ct timestamptz;ci uuid;
begin
 if p_filter not in ('for_you','following','followers','mine','celebrities') or p_state not in ('live','scheduled','replay') then raise exception 'INVALID_FILTER';end if;
 if p_cursor is not null then ct:=(p_cursor->>'created_at')::timestamptz;ci:=(p_cursor->>'id')::uuid;if ct is null or ci is null then raise exception 'INVALID_CURSOR';end if;end if;
 with candidates as materialized (
  select s.id,s.created_at from live_streams.sessions s where
   (p_filter='mine' and (s.host_id=uid or exists(select 1 from live_streams.members m where m.session_id=s.id and m.user_id=uid and m.status in ('invited','accepted'))) or p_filter<>'mine' and (case p_state when 'live' then s.state in ('live','reconnecting') when 'scheduled' then s.state='scheduled' else s.state='ended' and s.replay_available end))
   and (p_topic is null or s.topic=p_topic) and (ct is null or (s.created_at,s.id)<(ct,ci))
   and (p_filter not in ('following','followers') or exists(select 1 from public.follows f where
    (p_filter='following' and f.follower_id=uid and f.following_id=s.host_id) or (p_filter='followers' and f.following_id=uid and f.follower_id=s.host_id)))
   and (p_filter<>'celebrities' or exists(select 1 from public.profiles vp where vp.id=s.host_id and vp.is_verified)) and live_streams.can_view(s.id,uid) order by s.created_at desc,s.id desc limit lim+1
 ), page as(select * from candidates order by created_at desc,id desc limit lim)
 select coalesce((select jsonb_agg(live_streams.session_json(id)||jsonb_build_object('my_role',case when exists(select 1 from live_streams.sessions s where s.id=page.id and s.host_id=uid) then 'host' else coalesce((select m.role from live_streams.members m where m.session_id=page.id and m.user_id=uid and m.status<>'removed'),'viewer') end,
  'invitation_status',(select m.status from live_streams.members m where m.session_id=page.id and m.user_id=uid and m.status<>'removed')) order by created_at desc,id desc) from page),'[]'),
 case when (select count(*) from candidates)>lim then (select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1) else null end
 into items,next_cursor;
 return jsonb_build_object('items',items,'next_cursor',next_cursor,'capabilities',live_streams.capabilities());
end $$;
commit;
