-- Dispatch remains off until exact QA handler readback and a separately
-- reviewed credential installation. No historical event is replayed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
 if current_user<>'postgres' then raise exception 'NOTIFICATION_POSTGRES_REQUIRED';end if;
 if to_regprocedure('public.call_push_dispatch_allowed(uuid,uuid)') is null
  or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then raise exception 'NOTIFICATION_DISPATCH_PREREQUISITE_REQUIRED';end if;
 if to_regclass('notification_delivery.settings') is not null then raise exception 'NOTIFICATION_DISPATCH_ALREADY_EXISTS';end if;
 if has_table_privilege('anon','vault.decrypted_secrets','select')
  or has_table_privilege('authenticated','vault.decrypted_secrets','select')
  or has_table_privilege('anon','net.http_request_queue','select')
  or has_table_privilege('authenticated','net.http_request_queue','select') then raise exception 'NOTIFICATION_SECRET_PRIVILEGE_REVIEW_REQUIRED';end if;
end $preflight$;
create table notification_delivery.settings(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 project_origin text check(project_origin ~ '^https://[a-z]{20}[.]supabase[.]co$'),
 ordinary_handler_sha256 text check(ordinary_handler_sha256 ~ '^[a-f0-9]{64}$'),
 call_handler_sha256 text check(call_handler_sha256 ~ '^[a-f0-9]{64}$'),
 setup_nonce_digest bytea check(setup_nonce_digest is null or octet_length(setup_nonce_digest)=32),
 setup_armed_at timestamptz,setup_expires_at timestamptz,setup_used_at timestamptz,
 check(setup_expires_at is null or (setup_armed_at is not null and setup_expires_at>setup_armed_at and setup_expires_at<=setup_armed_at+interval '10 minutes'))
);
insert into notification_delivery.settings(singleton) values(true);
create table notification_delivery.outbox(
 id uuid primary key default gen_random_uuid(),
 notification_id uuid unique references public.notifications(id) on delete cascade,
 call_id uuid unique references public.call_sessions(id) on delete cascade,
 state text not null default 'pending' check(state in('pending','queued','failed')),
 request_id bigint,error_code text,created_at timestamptz not null default clock_timestamp(),
 check((notification_id is null)<>(call_id is null))
);
create index notification_outbox_state on notification_delivery.outbox(state,created_at);
alter table notification_delivery.settings enable row level security;
alter table notification_delivery.outbox enable row level security;
revoke all on notification_delivery.settings,notification_delivery.outbox from public,anon,authenticated,service_role;

create function notification_delivery.enqueue(p_notification uuid,p_call uuid)
returns void language plpgsql security definer set search_path='' as $$
declare config notification_delivery.settings%rowtype;job uuid;key_value text;request bigint;target text;payload jsonb;
begin
 select * into config from notification_delivery.settings where singleton;
 if not found or not config.enabled then return;end if;
 if (p_notification is null)=(p_call is null) then raise exception 'INVALID_NOTIFICATION_DISPATCH';end if;
 if p_call is not null and not exists(select 1 from notification_delivery.call_origins where call_id=p_call) then return;end if;
 insert into notification_delivery.outbox(notification_id,call_id) values(p_notification,p_call)
  on conflict do nothing returning id into job;
 if job is null then return;end if;
 begin
  select decrypted_secret into key_value from vault.decrypted_secrets where name='notification_dispatch_service_key';
  if config.project_origin is null or key_value is null or length(key_value)<32 then
   update notification_delivery.outbox set state='failed',error_code='MISSING_DISPATCH_CONFIGURATION' where id=job;return;end if;
  if p_notification is not null then target:='send-push-notification';payload:=jsonb_build_object('record',jsonb_build_object('id',p_notification));
  else target:='send-voip-push';payload:=jsonb_build_object('callId',p_call);end if;
  select net.http_post(url:=config.project_origin||'/functions/v1/'||target,
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||key_value),
   body:=payload,timeout_milliseconds:=10000) into request;
  update notification_delivery.outbox set state='queued',request_id=request where id=job;
 exception when others then
  -- Keep the application event and a non-sensitive operator failure marker;
  -- never log provider headers, credentials or arbitrary exception text.
  update notification_delivery.outbox set state='failed',error_code=sqlstate where id=job;
 end;
end $$;
create function notification_delivery.queue_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.type<>'incoming_call' then perform notification_delivery.enqueue(new.id,null);end if;
 return new;
end $$;
create function notification_delivery.queue_call()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='ringing' then perform notification_delivery.enqueue(null,new.id);end if;
 return new;
end $$;
revoke all on function notification_delivery.enqueue(uuid,uuid),notification_delivery.queue_notification(),notification_delivery.queue_call() from public,anon,authenticated,service_role;
create trigger notification_dispatch_queue after insert on public.notifications for each row execute function notification_delivery.queue_notification();
create trigger notification_call_dispatch_queue after insert on public.call_sessions for each row execute function notification_delivery.queue_call();
notify pgrst,'reload schema';
commit;
