begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.conversation_members,public.messages,public.notifications in share row exclusive mode nowait;
create schema notification_fanout;
revoke all on schema notification_fanout from public,anon,authenticated,service_role;
create sequence notification_fanout.event_order;
create table notification_fanout.settings(
 singleton boolean primary key default true check(singleton),fanout_enabled boolean not null default false,
 dispatch_enabled boolean not null default false,last_drain_at timestamptz,last_dispatch_at timestamptz
);
insert into notification_fanout.settings(singleton) values(true);

-- Membership intervals retain the transaction snapshot at which a message was
-- sent. A later join must not receive old messages and leaving during a drain
-- must not silently change its original recipient set. Sequence order handles
-- joins/leaves and messages within the SAME transaction, including savepoints.
create table notification_fanout.membership_history(
 id bigint generated always as identity primary key,conversation_id uuid not null,user_id uuid not null,
 shard smallint not null check(shard between 0 and 15),join_xid xid8 not null,join_order bigint not null,
 leave_xid xid8,leave_order bigint,left_at timestamptz,
 check((leave_xid is null)=(leave_order is null))
);
create unique index notification_membership_open on notification_fanout.membership_history(conversation_id,user_id) where leave_xid is null;
create index notification_membership_page on notification_fanout.membership_history(conversation_id,shard,user_id,id);
create index notification_membership_cleanup on notification_fanout.membership_history(left_at) where left_at is not null;
create index notification_membership_erasure on notification_fanout.membership_history(user_id);
insert into notification_fanout.membership_history(conversation_id,user_id,shard,join_xid,join_order)
 select conversation_id,user_id,(get_byte(decode(md5(user_id::text),'hex'),0)%16)::smallint,
 pg_current_xact_id(),nextval('notification_fanout.event_order') from public.conversation_members;
create function notification_fanout.membership_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (old.conversation_id,old.user_id) is not distinct from (new.conversation_id,new.user_id) then return null;end if;
 if tg_op<>'INSERT' then
   update notification_fanout.membership_history set leave_xid=pg_current_xact_id(),
     leave_order=nextval('notification_fanout.event_order'),left_at=clock_timestamp()
   where conversation_id=old.conversation_id and user_id=old.user_id and leave_xid is null;
 end if;
 if tg_op<>'DELETE' then
   insert into notification_fanout.membership_history(conversation_id,user_id,shard,join_xid,join_order)
   values(new.conversation_id,new.user_id,(get_byte(decode(md5(new.user_id::text),'hex'),0)%16)::smallint,
     pg_current_xact_id(),nextval('notification_fanout.event_order'));
 end if;
 return null;
end $$;
create trigger notification_membership_history after insert or update or delete on public.conversation_members
 for each row execute function notification_fanout.membership_changed();

create table notification_fanout.jobs(
 id uuid primary key default gen_random_uuid(),message_id uuid not null references public.messages(id) on delete cascade,
 conversation_id uuid not null,sender_id uuid not null,shard smallint not null check(shard between 0 and 15),
 member_snapshot pg_snapshot not null,event_xid xid8 not null,event_order bigint not null,
 notification_message text not null,body_preview text not null,data jsonb not null,
 cursor_id uuid,state text not null default 'pending' check(state in('pending','done','dead')),
 created_at timestamptz not null default now(),available_at timestamptz not null default clock_timestamp(),
 attempts integer not null default 0,last_error text,finished_at timestamptz,
 unique(message_id,shard)
);
create index notification_fanout_due on notification_fanout.jobs(available_at,created_at,id) where state='pending';
create index notification_fanout_age on notification_fanout.jobs(created_at) where state='pending';
create index notification_fanout_finished on notification_fanout.jobs(finished_at,id) where state='done';
create table notification_fanout.recipients(
 job_id uuid not null references notification_fanout.jobs(id) on delete cascade,user_id uuid not null,
 notification_id uuid not null,primary key(job_id,user_id)
);
create function notification_fanout.enqueue_message(p_message uuid,p_conversation uuid,p_sender uuid,
 p_message_text text,p_preview text,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare snap pg_snapshot:=pg_current_snapshot();event bigint:=nextval('notification_fanout.event_order');
begin
 insert into notification_fanout.jobs(message_id,conversation_id,sender_id,shard,member_snapshot,event_xid,event_order,
   notification_message,body_preview,data)
 select p_message,p_conversation,p_sender,s,snap,pg_current_xact_id(),event,p_message_text,p_preview,p_data
 from generate_series(0,15)s on conflict(message_id,shard) do nothing;
end $$;

-- Retain the exact deployed preview/title/one-to-one behavior. Only the group
-- loop becomes sixteen constant-size durable work units when explicitly enabled.
do $$declare source text;anchor text:='IF conv_is_group = true THEN';addition text;
begin
 source:=pg_get_functiondef('public.notify_on_new_message()'::regprocedure);
 if position(anchor in source)=0 then raise exception 'MESSAGE_NOTIFICATION_DEFINITION_REQUIRES_REVIEW';end if;
 addition:=anchor||E'\n'||$branch$
    if (select fanout_enabled from notification_fanout.settings where singleton) then
      perform notification_fanout.enqueue_message(new.id,new.conversation_id,new.sender_id,
        sender_name||' in '||coalesce(conv_group_name,'group chat'),msg_preview,
        jsonb_build_object('conversation_id',new.conversation_id,'message_id',new.id,
          'is_group',true,'group_name',coalesce(conv_group_name,'Group Chat')));
      return new;
    end if;
$branch$;
 execute replace(source,anchor,addition);
end $$;

create function public.drain_notification_fanout_v1(p_jobs integer default 16,p_page_size integer default 250)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job notification_fanout.jobs%rowtype;users uuid[];last_user uuid;created integer:=0;processed integer:=0;n integer;
begin
 if p_jobs is null or p_jobs<1 or p_jobs>64 or p_page_size is null or p_page_size<1 or p_page_size>500 then raise exception 'INVALID_FANOUT_LIMIT';end if;
 for job in select * from notification_fanout.jobs where state='pending' and available_at<=clock_timestamp()
   order by available_at,created_at,id for update skip locked limit p_jobs
 loop
   begin
     select array_agg(user_id order by user_id),max(user_id::text)::uuid into users,last_user from (
       select distinct h.user_id from notification_fanout.membership_history h
       where h.conversation_id=job.conversation_id and h.shard=job.shard and h.user_id<>job.sender_id
         and (job.cursor_id is null or h.user_id>job.cursor_id)
         and ((h.join_xid=job.event_xid and h.join_order<job.event_order)
           or (h.join_xid<>job.event_xid and pg_visible_in_snapshot(h.join_xid,job.member_snapshot)))
         and not coalesce((h.leave_xid=job.event_xid and h.leave_order<job.event_order)
           or (h.leave_xid<>job.event_xid and pg_visible_in_snapshot(h.leave_xid,job.member_snapshot)),false)
       order by h.user_id limit p_page_size
     ) eligible;
     -- The idempotency marker and notification insert commit together. Existing
     -- notification restriction/stamping triggers still decide delivery exactly
     -- as they do for synchronous notifications. Deleted accounts are omitted.
     with claimed as (
       insert into notification_fanout.recipients(job_id,user_id,notification_id)
       select job.id,u,gen_random_uuid() from unnest(coalesce(users,'{}'::uuid[]))u
       join public.profiles p on p.id=u on conflict do nothing returning user_id,notification_id
     ) insert into public.notifications(id,recipient_id,actor_id,type,message,body_preview,data,created_at)
       select notification_id,user_id,job.sender_id,'message',job.notification_message,job.body_preview,job.data,job.created_at from claimed;
     get diagnostics n=row_count;created:=created+n;processed:=processed+1;
     update notification_fanout.jobs set cursor_id=coalesce(last_user,cursor_id),attempts=0,last_error=null,
       state=case when coalesce(cardinality(users),0)<p_page_size then 'done' else 'pending' end,
       finished_at=case when coalesce(cardinality(users),0)<p_page_size then clock_timestamp() end,
       available_at=clock_timestamp() where id=job.id;
   exception when others then
     -- The inner block rolled back BOTH recipients and its cursor. Store only
     -- SQLSTATE, never message text, provider payloads, or recipient details.
     update notification_fanout.jobs set attempts=attempts+1,last_error=sqlstate,
       state=case when attempts+1>=8 then 'dead' else 'pending' end,
       available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,least(attempts+1,8))::integer)) where id=job.id;
   end;
 end loop;
 update notification_fanout.settings set last_drain_at=clock_timestamp() where singleton;
 return jsonb_build_object('jobs',processed,'notifications',created);
end $$;

-- Ordinary push delivery is separate from notification creation. Calls retain
-- their existing dedicated VoIP path. No historical notifications are replayed.
create table notification_fanout.dispatch_jobs(
 id uuid primary key default gen_random_uuid(),notification_id uuid not null unique references public.notifications(id) on delete cascade,
 state text not null default 'pending' check(state in('pending','leased','delivered','skipped','dead')),
 created_at timestamptz not null default clock_timestamp(),available_at timestamptz not null default clock_timestamp(),
 lease_id uuid,lease_until timestamptz,attempts integer not null default 0,last_error text,
 accepted integer not null default 0,rejected integer not null default 0,unknown integer not null default 0,finished_at timestamptz
);
create index notification_dispatch_due on notification_fanout.dispatch_jobs(available_at,id) where state in('pending','leased');
create index notification_dispatch_age on notification_fanout.dispatch_jobs(created_at) where state in('pending','leased');
create index notification_dispatch_finished on notification_fanout.dispatch_jobs(finished_at,id) where state in('delivered','skipped');
create function notification_fanout.queue_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.type<>'incoming_call' and (select dispatch_enabled from notification_fanout.settings where singleton) then
   insert into notification_fanout.dispatch_jobs(notification_id) values(new.id) on conflict do nothing;
 end if;
 return null;
end $$;
create trigger notification_durable_dispatch after insert on public.notifications for each row execute function notification_fanout.queue_push();

-- The legacy stamping trigger inherited the caller's search_path. Durable
-- workers deliberately use an empty path, so qualify its existing table reads
-- without changing the account-type fallback or notification presentation.
do $$declare source text;
begin
 if to_regprocedure('public.stamp_notification_account_type()') is not null then
   source:=pg_get_functiondef('public.stamp_notification_account_type()'::regprocedure);
   source:=replace(source,'FROM profiles','FROM public.profiles');
   source:=replace(source,'from profiles','from public.profiles');
   execute source;
   alter function public.stamp_notification_account_type() set search_path='';
 end if;
end $$;

-- Suppress installed legacy ordinary triggers only while durable dispatch is
-- enabled. Preserve each installation's original URL, key lookup and payload.
do $$declare signature text;source text;marker text;
begin
 foreach signature in array array['public.notify_push_notification()','notification_delivery.queue_notification()'] loop
   if to_regprocedure(signature) is null then continue;end if;
   source:=pg_get_functiondef(to_regprocedure(signature));
   marker:=substring(source from '(?i)\mbegin\M');
   if marker is null then raise exception 'NOTIFICATION_DISPATCH_DEFINITION_REQUIRES_REVIEW';end if;
   source:=regexp_replace(source,'(?i)\mbegin\M',
     'begin if (select dispatch_enabled from notification_fanout.settings where singleton) then return new;end if;');
   execute source;
 end loop;
end $$;

create function public.claim_notification_dispatch_v1(p_limit integer default 1,p_lease_seconds integer default 90)
returns table(id uuid,notification_id uuid,lease_id uuid,attempts integer,lease_until timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit<1 or p_limit>100 or p_lease_seconds is null or p_lease_seconds<30 or p_lease_seconds>120 then raise exception 'INVALID_DISPATCH_CLAIM';end if;
 update notification_fanout.settings set last_dispatch_at=clock_timestamp() where singleton;
 -- Disabling dispatch stops NEW enqueueing. Already durable work still drains
 -- so a compatibility rollback cannot strand notifications written beforehand.
 with expired as(select q.id from notification_fanout.dispatch_jobs q
   where q.state='leased' and q.lease_until<=clock_timestamp() and q.attempts>=8
   order by q.lease_until,q.id for update skip locked limit 1000)
 update notification_fanout.dispatch_jobs q set state='dead',last_error='LEASE_RETRIES_EXHAUSTED',finished_at=clock_timestamp()
 from expired e where q.id=e.id;
 return query with picked as (
   select q.id from notification_fanout.dispatch_jobs q
   where (q.state='pending' and q.available_at<=clock_timestamp()) or (q.state='leased' and q.lease_until<=clock_timestamp())
   order by q.available_at,q.id for update skip locked limit p_limit
 )update notification_fanout.dispatch_jobs q set state='leased',lease_id=gen_random_uuid(),
   lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempts=q.attempts+1
 from picked p where q.id=p.id returning q.id,q.notification_id,q.lease_id,q.attempts,q.lease_until;
end $$;
create function public.complete_notification_dispatch_v1(p_id uuid,p_lease_id uuid,p_outcome text,
 p_error_code text default null,p_accepted integer default 0,p_rejected integer default 0,p_unknown integer default 0)
returns boolean language plpgsql security definer set search_path='' as $$
declare updated integer;
begin
 if p_outcome is null or p_outcome not in('delivered','skipped','retry','dead')
   or (p_error_code is not null and p_error_code!~'^[A-Z0-9_]{1,64}$')
   or least(p_accepted,p_rejected,p_unknown)<0 or p_accepted is null or p_rejected is null or p_unknown is null then raise exception 'INVALID_DISPATCH_OUTCOME';end if;
 update notification_fanout.dispatch_jobs q set
   state=case when p_outcome='retry' and q.attempts>=8 then 'dead' when p_outcome='retry' then 'pending' else p_outcome end,
   available_at=case when p_outcome='retry' then clock_timestamp()+make_interval(secs=>least(300,power(2,least(q.attempts,8))::integer)) else q.available_at end,
   last_error=p_error_code,accepted=q.accepted+p_accepted,rejected=q.rejected+p_rejected,unknown=q.unknown+p_unknown,
   finished_at=case when p_outcome<>'retry' or q.attempts>=8 then clock_timestamp() end,lease_until=null
 where q.id=p_id and q.lease_id=p_lease_id and q.state='leased' and q.lease_until>clock_timestamp();
 get diagnostics updated=row_count;return updated=1;
end $$;
create function public.configure_notification_fanout_v1(p_fanout boolean,p_dispatch boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_fanout is null or p_dispatch is null then raise exception 'INVALID_NOTIFICATION_CONFIGURATION';end if;
 if p_dispatch and not exists(select 1 from notification_fanout.settings where last_dispatch_at>=clock_timestamp()-interval '60 seconds') then
   raise exception 'DISPATCH_WORKER_HEARTBEAT_REQUIRED';end if;
 update notification_fanout.settings set fanout_enabled=p_fanout,dispatch_enabled=p_dispatch where singleton;
end $$;
create function public.notification_fanout_status_v1()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'fanout_enabled',s.fanout_enabled,'dispatch_enabled',s.dispatch_enabled,
   'last_drain_at',s.last_drain_at,'last_dispatch_at',s.last_dispatch_at,
   'fanout_pending',(select count(*) from(select 1 from notification_fanout.jobs where state='pending' limit 100001)q),
   'fanout_dead',(select count(*) from(select 1 from notification_fanout.jobs where state='dead' limit 100001)q),
   'oldest_fanout_at',(select created_at from notification_fanout.jobs where state='pending' order by created_at limit 1),
   'dispatch_pending',(select count(*) from(select 1 from notification_fanout.dispatch_jobs where state in('pending','leased') limit 100001)q),
   'dispatch_dead',(select count(*) from(select 1 from notification_fanout.dispatch_jobs where state='dead' limit 100001)q),
   'oldest_dispatch_at',(select created_at from notification_fanout.dispatch_jobs where state in('pending','leased') order by created_at limit 1),
   'count_cap',100001)
 from notification_fanout.settings s where singleton;
$$;
create function public.retry_notification_dead_letter_v1(p_id uuid,p_kind text)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_kind='fanout' then update notification_fanout.jobs set state='pending',attempts=0,last_error=null,available_at=clock_timestamp(),finished_at=null where id=p_id and state='dead';
 elsif p_kind='dispatch' then update notification_fanout.dispatch_jobs set state='pending',attempts=0,last_error=null,available_at=clock_timestamp(),finished_at=null,lease_id=null,lease_until=null where id=p_id and state='dead';
 else raise exception 'INVALID_DEAD_LETTER_KIND';end if;
 get diagnostics n=row_count;return n=1;
end $$;

create function public.prune_notification_work_v1(p_limit integer default 1000)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;total integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>10000 then raise exception 'INVALID_NOTIFICATION_PRUNE_LIMIT';end if;
 with picked as(select id from notification_fanout.jobs where state='done' and finished_at<now()-interval '7 days'
   order by finished_at,id for update skip locked limit p_limit)
 delete from notification_fanout.jobs j using picked p where j.id=p.id;
 get diagnostics n=row_count;total:=total+n;
 with picked as(select id from notification_fanout.dispatch_jobs where state in('delivered','skipped') and finished_at<now()-interval '7 days'
   order by finished_at,id for update skip locked limit p_limit)
 delete from notification_fanout.dispatch_jobs j using picked p where j.id=p.id;
 get diagnostics n=row_count;total:=total+n;
 with picked as(select h.id from notification_fanout.membership_history h
   where h.left_at<now()-interval '7 days'
     and not exists(select 1 from notification_fanout.jobs j where j.conversation_id=h.conversation_id
       and j.state in('pending','dead') and j.created_at<=h.left_at)
   order by h.left_at,h.id for update skip locked limit p_limit)
 delete from notification_fanout.membership_history h using picked p where h.id=p.id;
 get diagnostics n=row_count;return total+n;
end $$;
create function notification_fanout.erase_member_history()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from notification_fanout.membership_history where user_id=old.id;
 return null;
end $$;
create trigger notification_membership_erasure after delete on public.profiles
 for each row execute function notification_fanout.erase_member_history();

do $$declare t text;f regprocedure;
begin
 foreach t in array array['settings','membership_history','jobs','recipients','dispatch_jobs'] loop
   execute format('alter table notification_fanout.%I enable row level security',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p where p.pronamespace='public'::regnamespace
   and p.proname in('drain_notification_fanout_v1','claim_notification_dispatch_v1','complete_notification_dispatch_v1',
     'configure_notification_fanout_v1','notification_fanout_status_v1','retry_notification_dead_letter_v1','prune_notification_work_v1') loop
   execute format('revoke all on function %s from public,anon,authenticated',f);
   execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
revoke all on all tables in schema notification_fanout from public,anon,authenticated,service_role;
revoke all on all sequences in schema notification_fanout from public,anon,authenticated,service_role;
revoke all on all functions in schema notification_fanout from public,anon,authenticated,service_role;
do $$begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
   perform cron.schedule('notification-fanout-v1','1 second','select public.drain_notification_fanout_v1(32,250)');
   perform cron.schedule('notification-work-prune-v1','*/10 * * * *','select public.prune_notification_work_v1(1000)');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
