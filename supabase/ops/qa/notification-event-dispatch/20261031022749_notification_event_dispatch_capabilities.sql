-- Source-only QA candidate. Dispatch starts disabled. This does not repair,
-- modify or assume privacy of the provider-owned pg_net tables.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
 if current_user<>'postgres' then raise exception 'NOTIFICATION_POSTGRES_REQUIRED';end if;
 if to_regclass('notification_delivery.call_origins') is null
  or to_regprocedure('public.call_push_dispatch_allowed(uuid,uuid)') is null
  or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
  raise exception 'NOTIFICATION_EVENT_PREREQUISITES_REQUIRED';
 end if;
 if to_regclass('notification_delivery.event_settings') is not null then
  raise exception 'NOTIFICATION_EVENT_ALREADY_INSTALLED';
 end if;
end $preflight$;
create table notification_delivery.event_settings(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 project_origin text check(project_origin='https://uaulhuelcfkjwojtymmw.supabase.co'),
 dispatcher_sha256 text check(dispatcher_sha256 ~ '^[a-f0-9]{64}$'),
 ordinary_handler_sha256 text check(ordinary_handler_sha256 ~ '^[a-f0-9]{64}$'),
 call_handler_sha256 text check(call_handler_sha256 ~ '^[a-f0-9]{64}$'),
 check(not enabled or (project_origin is not null and dispatcher_sha256 is not null
  and ordinary_handler_sha256 is not null and call_handler_sha256 is not null))
);
insert into notification_delivery.event_settings(singleton) values(true);
create table notification_delivery.event_jobs(
 id uuid primary key default gen_random_uuid(),
 notification_id uuid unique references public.notifications(id) on delete cascade,
 call_id uuid unique references public.call_sessions(id) on delete cascade,
 token_digest bytea not null check(octet_length(token_digest)=32),
 state text not null default 'pending' check(state in('pending','queued','failed','claimed','accepted','skipped','unknown')),
 claim_id uuid,claimed_at timestamptz,finished_at timestamptz,
 request_id bigint,error_code text,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 check((notification_id is null)<>(call_id is null)),
 check(expires_at>created_at and expires_at<=created_at+interval '2 minutes'),
 check((claim_id is null)=(claimed_at is null))
);
create index notification_event_jobs_state on notification_delivery.event_jobs(state,created_at,id);
create index notification_event_jobs_expiry on notification_delivery.event_jobs(expires_at,id);
alter table notification_delivery.event_settings enable row level security;
alter table notification_delivery.event_jobs enable row level security;
revoke all on notification_delivery.event_settings,notification_delivery.event_jobs from public,anon,authenticated,service_role;

create function notification_delivery.event_mode_allowed()
returns boolean language plpgsql security definer set search_path='' as $$
declare enabled boolean;legacy_enabled boolean;
begin
 select s.enabled into enabled from notification_delivery.event_settings s where singleton;
 if not coalesce(enabled,false) then return false;end if;
 if to_regclass('notification_delivery.settings') is not null then
  execute 'select enabled from notification_delivery.settings where singleton' into legacy_enabled;
  if legacy_enabled then return false;end if;
 end if;
 return true;
end $$;
revoke all on function notification_delivery.event_mode_allowed() from public,anon,authenticated,service_role;

create function notification_delivery.enqueue_event(p_notification uuid,p_call uuid)
returns void language plpgsql security definer set search_path='' as $$
declare config notification_delivery.event_settings%rowtype;job uuid;token text;request bigint;
 created timestamptz:=clock_timestamp();expires timestamptz;
begin
 select * into config from notification_delivery.event_settings where singleton;
 if not found or not notification_delivery.event_mode_allowed() then return;end if;
 -- Both delivery modes must never be active together.
 if (p_notification is null)=(p_call is null) then raise exception 'INVALID_NOTIFICATION_EVENT';end if;
 expires:=created+interval '2 minutes';
 if p_call is not null then
  select least(c.created_at+interval '90 seconds',coalesce(c.expires_at,c.created_at+interval '90 seconds')) into expires
   from public.call_sessions c join notification_delivery.call_origins o on o.call_id=c.id
   where c.id=p_call and c.status='ringing';
  if expires is null or expires<=created then return;end if;
  expires:=least(expires,created+interval '2 minutes');
 elsif not exists(select 1 from public.notifications where id=p_notification
  and type<>'incoming_call' and created_at>=created-interval '2 minutes' and created_at<=created+interval '1 minute') then return;
 end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into notification_delivery.event_jobs(notification_id,call_id,token_digest,created_at,expires_at)
  values(p_notification,p_call,extensions.digest(token,'sha256'),created,expires)
  on conflict do nothing returning id into job;
 if job is null then return;end if;
 begin
  select net.http_post(url:=config.project_origin||'/functions/v1/dispatch-notification-event',
   headers:=jsonb_build_object('Content-Type','application/json'),
   body:=jsonb_build_object('jobId',job,'token',token),timeout_milliseconds:=45000) into request;
  update notification_delivery.event_jobs set state='queued',request_id=request where id=job;
 exception when others then
  update notification_delivery.event_jobs set state='failed',error_code=sqlstate where id=job;
 end;
end $$;
create function notification_delivery.queue_notification_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.type<>'incoming_call' then perform notification_delivery.enqueue_event(new.id,null);end if;
 return new;
end $$;
create function notification_delivery.queue_call_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='ringing' then perform notification_delivery.enqueue_event(null,new.id);end if;
 return new;
end $$;
revoke all on function notification_delivery.enqueue_event(uuid,uuid),notification_delivery.queue_notification_event(),notification_delivery.queue_call_event() from public,anon,authenticated,service_role;
create trigger notification_event_dispatch_queue after insert on public.notifications for each row execute function notification_delivery.queue_notification_event();
create trigger notification_call_event_dispatch_queue after insert on public.call_sessions for each row execute function notification_delivery.queue_call_event();

create function public.claim_notification_event_dispatch(p_job_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job notification_delivery.event_jobs%rowtype;lease uuid:=gen_random_uuid();
begin
 if auth.jwt()->>'role' is distinct from 'service_role'
  or p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null;end if;
 update notification_delivery.event_jobs j set state='claimed',claim_id=lease,claimed_at=clock_timestamp()
 where j.id=p_job_id and j.token_digest=extensions.digest(p_token,'sha256')
  and j.state='queued' and j.expires_at>clock_timestamp()
  and notification_delivery.event_mode_allowed()
  and (j.notification_id is not null and exists(select 1 from public.notifications n
    join public.profiles p on p.id=n.recipient_id
    where n.id=j.notification_id and n.type<>'incoming_call' and p.deactivated_at is null
     and n.created_at>=clock_timestamp()-interval '2 minutes')
   or j.call_id is not null and exists(select 1 from public.call_sessions c
    join notification_delivery.call_origins o on o.call_id=c.id
    join auth.sessions s on s.id=o.session_id and s.user_id=o.user_id
    join public.profiles p on p.id=o.user_id
    where c.id=j.call_id and c.status='ringing' and p.deactivated_at is null
     and (s.not_after is null or s.not_after>clock_timestamp())
     and least(c.created_at+interval '90 seconds',coalesce(c.expires_at,c.created_at+interval '90 seconds'))>clock_timestamp()))
 returning j.* into job;
 if not found then return null;end if;
 return jsonb_build_object('claimId',lease,'kind',case when job.notification_id is null then 'call' else 'notification' end,
  'eventId',coalesce(job.notification_id,job.call_id));
end $$;
create function public.notification_event_dispatch_allowed(p_job_id uuid,p_claim_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then return false;end if;
 return notification_delivery.event_mode_allowed() and exists(select 1 from notification_delivery.event_jobs
  where id=p_job_id and claim_id=p_claim_id and state='claimed' and expires_at>clock_timestamp());
end $$;
create function public.finish_notification_event_dispatch(p_job_id uuid,p_claim_id uuid,p_outcome text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role'
  or p_outcome is null or p_outcome not in('accepted','skipped','failed','unknown') then return false;end if;
 update notification_delivery.event_jobs set state=p_outcome,finished_at=clock_timestamp()
  where id=p_job_id and claim_id=p_claim_id and state='claimed';
 return found;
end $$;
revoke all on function public.claim_notification_event_dispatch(uuid,text),public.notification_event_dispatch_allowed(uuid,uuid),public.finish_notification_event_dispatch(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_notification_event_dispatch(uuid,text),public.notification_event_dispatch_allowed(uuid,uuid),public.finish_notification_event_dispatch(uuid,uuid,text) to service_role;
-- Explicit operator-only bounded retention. This DELETE remains visible to the
-- provider's normal SQL confirmation classification and must not be rewritten
-- to avoid that classification. Canonical events are never deleted here.
create function notification_delivery.cleanup_event_jobs(p_limit integer default 500)
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'EVENT_RETENTION_LIMIT';end if;
 delete from notification_delivery.event_jobs where id in (
  select id from notification_delivery.event_jobs where expires_at<clock_timestamp()-interval '7 days'
   order by expires_at,id for update skip locked limit p_limit
 );
 get diagnostics removed=row_count;
 return removed;
end $$;
revoke all on function notification_delivery.cleanup_event_jobs(integer) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
