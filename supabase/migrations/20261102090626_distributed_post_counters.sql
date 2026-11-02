begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.posts,public.post_likes,public.post_comments,public.post_reposts,public.post_bookmarks
 in share row exclusive mode nowait;

create table post_counter_internal.settings(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 last_flush_at timestamptz,last_error text,lag_target_ms integer not null default 1000 check(lag_target_ms=1000)
);
insert into post_counter_internal.settings(singleton) values(true);
create table post_counter_internal.shards(
 post_id uuid not null references public.posts(id) on delete cascade,
 shard smallint not null check(shard between 0 and 63),
 likes_count bigint not null default 0,comments_count bigint not null default 0,
 reposts_count bigint not null default 0,bookmarks_count bigint not null default 0,
 primary key(post_id,shard),
 check(likes_count>=0 and comments_count>=0 and reposts_count>=0 and bookmarks_count>=0)
);
create table post_counter_internal.dirty(
 post_id uuid not null references public.posts(id) on delete cascade,
 shard smallint not null check(shard between 0 and 63),
 queued_at timestamptz not null default clock_timestamp(),version bigint not null default 1,
 primary key(post_id,shard)
);
create index post_counter_dirty_age on post_counter_internal.dirty(queued_at,post_id,shard);
alter table post_counter_internal.settings enable row level security;
alter table post_counter_internal.shards enable row level security;
alter table post_counter_internal.dirty enable row level security;
revoke all on all tables in schema post_counter_internal from public,anon,authenticated,service_role;

create function post_counter_internal.shard_for(p_user uuid)
returns smallint language sql immutable parallel safe set search_path=''
as $$select (get_byte(decode(md5(coalesce(p_user::text,'')),'hex'),0)%64)::smallint$$;
revoke all on function post_counter_internal.shard_for(uuid) from public,anon,authenticated,service_role;

insert into post_counter_internal.shards(post_id,shard,likes_count,comments_count,reposts_count,bookmarks_count)
select post_id,shard,sum(likes),sum(comments),sum(reposts),sum(bookmarks) from (
 select post_id,post_counter_internal.shard_for(user_id) shard,1 likes,0 comments,0 reposts,0 bookmarks from public.post_likes
 union all select post_id,post_counter_internal.shard_for(user_id),0,1,0,0 from public.post_comments
 union all select post_id,post_counter_internal.shard_for(user_id),0,0,1,0 from public.post_reposts
 union all select post_id,post_counter_internal.shard_for(user_id),0,0,0,1 from public.post_bookmarks
) c where post_id is not null group by post_id,shard;

-- Every delta still commits in the original engagement transaction. A user has
-- a stable shard, so duplicate retries, deletes and user/post reassignment retain
-- exact totals. Independent users of a viral post no longer lock its post row.
create or replace function post_counter_internal.apply_delta()
returns trigger language plpgsql security definer set search_path='' as $$
declare counter_column text; changes text; change record; config post_counter_internal.settings%rowtype; touched integer;
begin
 if tg_table_schema<>'public' or tg_level<>'STATEMENT' or tg_when<>'AFTER' then raise exception 'INVALID_COUNTER_TRIGGER';end if;
 counter_column:=case tg_table_name when 'post_likes' then 'likes_count' when 'post_comments' then 'comments_count'
   when 'post_reposts' then 'reposts_count' when 'post_bookmarks' then 'bookmarks_count' end;
 if counter_column is null then raise exception 'INVALID_COUNTER_TABLE';end if;
 select * into strict config from post_counter_internal.settings where singleton;
 if tg_op='INSERT' then changes:='select post_id,post_counter_internal.shard_for(user_id) shard,1 delta from new_rows';
 elsif tg_op='DELETE' then changes:='select post_id,post_counter_internal.shard_for(user_id) shard,-1 delta from old_rows';
 elsif tg_op='UPDATE' then changes:='select post_id,post_counter_internal.shard_for(user_id) shard,1 delta from new_rows
   union all select post_id,post_counter_internal.shard_for(user_id) shard,-1 delta from old_rows';
 else raise exception 'INVALID_COUNTER_OPERATION';end if;
 for change in execute 'select post_id,shard,sum(delta)::bigint delta from ('||changes||') d
   where post_id is not null group by post_id,shard having sum(delta)<>0 order by post_id,shard'
 loop
   -- Cascading deletion may already have removed the parent and its shards.
   if not exists(select 1 from public.posts where id=change.post_id) then continue;end if;
   if change.delta>0 then
     execute format('insert into post_counter_internal.shards as s(post_id,shard,%1$I) values($1,$2,$3)
       on conflict(post_id,shard) do update set %1$I=s.%1$I+excluded.%1$I',counter_column)
       using change.post_id,change.shard,change.delta;
   else
     execute format('update post_counter_internal.shards set %1$I=%1$I+$3 where post_id=$1 and shard=$2',counter_column)
       using change.post_id,change.shard,change.delta;
     get diagnostics touched=row_count;
     if touched=0 then raise exception 'MISSING_COUNTER_SHARD';end if;
   end if;
   if config.enabled then
     insert into post_counter_internal.dirty as q(post_id,shard) values(change.post_id,change.shard)
     on conflict(post_id,shard) do update set version=q.version+1;
   else
     execute format('update public.posts set %1$I=coalesce(%1$I,0)::bigint+$1 where id=$2',counter_column)
       using change.delta,change.post_id;
   end if;
 end loop;
 -- If the one-second worker is unavailable, preserve legacy freshness by
 -- reverting affected writes to synchronous snapshots after five seconds.
 -- The distributed ledger remains authoritative and recovery can resume safely.
 if config.enabled and coalesce(config.last_flush_at<clock_timestamp()-interval '5 seconds',true) then
   for change in execute 'select distinct post_id from ('||changes||') d where post_id is not null order by post_id' loop
     perform 1 from public.posts where id=change.post_id for no key update;
     update public.posts p set
       likes_count=c.likes::integer,comments_count=c.comments::integer,
       reposts_count=c.reposts::integer,bookmarks_count=c.bookmarks::integer
     from (select coalesce(sum(likes_count),0) likes,coalesce(sum(comments_count),0) comments,
       coalesce(sum(reposts_count),0) reposts,coalesce(sum(bookmarks_count),0) bookmarks
       from post_counter_internal.shards where post_id=change.post_id) c where p.id=change.post_id;
   end loop;
 end if;
 return null;
end $$;

-- Internal exact reader is independently authorization checked. Its schema is
-- not exposed through PostgREST; clients receive only the bounded public RPC.
create function post_counter_internal.exact(p_id uuid)
returns table(likes_count integer,comments_count integer,reposts_count integer,bookmarks_count integer)
language sql stable security definer set search_path='' as $$
 select coalesce(sum(s.likes_count),0)::integer,coalesce(sum(s.comments_count),0)::integer,
   coalesce(sum(s.reposts_count),0)::integer,coalesce(sum(s.bookmarks_count),0)::integer
 from post_counter_internal.shards s
 where s.post_id=p_id and auth.uid() is not null and public.can_view_post(p_id)
 having auth.uid() is not null and public.can_view_post(p_id);
$$;
revoke all on function post_counter_internal.exact(uuid) from public,anon,service_role;
grant usage on schema post_counter_internal to authenticated;
grant execute on function post_counter_internal.exact(uuid) to authenticated;
create function public.get_post_engagement_counts_v1(p_ids uuid[])
returns table(post_id uuid,likes_count integer,comments_count integer,reposts_count integer,
 bookmarks_count integer,views_count integer,shares_count integer,quotes_count integer)
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if coalesce(cardinality(p_ids),0)>100 then raise exception 'At most 100 post IDs can be refreshed' using errcode='22023';end if;
 return query select p.id,c.likes_count,c.comments_count,c.reposts_count,c.bookmarks_count,coalesce(p.views_count,0),
   coalesce(p.shares_count,0),(select count(*)::integer from public.posts quoted where quoted.quoted_post_id=p.id)
 from public.posts p cross join lateral post_counter_internal.exact(p.id) c
 where p.id=any(coalesce(p_ids,'{}'::uuid[])) and public.can_view_post(p.id);
end $$;
revoke all on function public.get_post_engagement_counts_v1(uuid[]) from public,anon;
grant execute on function public.get_post_engagement_counts_v1(uuid[]) to authenticated;
create index if not exists posts_quote_counter_idx on public.posts(quoted_post_id) where quoted_post_id is not null;

-- Keep toggle semantics, but serialize only one viewer's toggle of one post.
-- The confirmed result reads committed shards plus the caller's own delta.
do $$declare body text; patched text;
begin
 select replace(prosrc,E'\r','') into body from pg_proc where oid='public.toggle_post_like(uuid)'::regprocedure;
 patched:=replace(body,'  -- Lock target post so count reconciliation is stable.',
   '  perform pg_advisory_xact_lock(hashtextextended(p_post_id::text||'':''||v_user_id::text,918271));
    if not public.can_view_post(p_post_id) then raise exception ''Post not found'';end if;
    -- Existence is checked without a lock shared by every viewer.');
 patched:=replace(patched,E'  FOR UPDATE;',E'  ;');
 patched:=replace(patched,'SELECT COALESCE(likes_count, 0)', 'SELECT COALESCE(exact.likes_count, 0)');
 patched:=replace(patched,E'FROM public.posts\n    WHERE id = p_post_id;',
   'FROM post_counter_internal.exact(p_post_id) exact;');
 if patched=body or position('FOR UPDATE' in patched)>0
   or position('FROM post_counter_internal.exact(p_post_id)' in patched)=0 then raise exception 'POST_TOGGLE_REQUIRES_REVIEW';end if;
 execute format('create or replace function public.toggle_post_like(p_post_id uuid) returns jsonb
   language plpgsql security definer set search_path=public as $toggle$%s$toggle$;',patched);
end $$;

-- Full history cards also return immediate exact counters. Ranking retains the
-- same formula and its coalesced input snapshots; no weights or limits change.
do $$declare source text; body text;
begin
 source:=pg_get_functiondef('public.get_feed_rows_by_ids_v1(uuid[])'::regprocedure);
 body:=replace(source,'  from posts p',
   '  from posts p cross join lateral post_counter_internal.exact(p.id) exact_counts');
 foreach source in array array['likes_count','comments_count','reposts_count','bookmarks_count'] loop
   body:=replace(body,'p.'||source,'exact_counts.'||source);
 end loop;
 execute body;
 if to_regprocedure('public.get_feed_live_state(uuid[])') is not null then
   source:=pg_get_functiondef('public.get_feed_live_state(uuid[])'::regprocedure);
   body:=replace(source,'join public.posts p on p.id=visible.post_id',
     'join public.posts p on p.id=visible.post_id cross join lateral post_counter_internal.exact(p.id) exact_counts');
   foreach source in array array['likes_count','comments_count','reposts_count','bookmarks_count'] loop
     body:=replace(body,'p.'||source,'exact_counts.'||source);
   end loop;
   execute body;
 end if;
end $$;

create function public.flush_post_engagement_snapshots_v1(p_limit integer default 1000)
returns integer language plpgsql security definer set search_path='' as $$
declare ids uuid[]; n integer; changed integer;
begin
 if p_limit is null or p_limit<1 or p_limit>10000 then raise exception 'INVALID_FLUSH_LIMIT';end if;
 if not pg_try_advisory_xact_lock(7132041,1) then return 0;end if;
 with picked as materialized (
   select q.post_id,q.shard from post_counter_internal.dirty q
   order by q.queued_at,q.post_id,q.shard for update skip locked limit p_limit
 ), removed as (
   delete from post_counter_internal.dirty q using picked p
   where q.post_id=p.post_id and q.shard=p.shard returning q.post_id
 ) select array_agg(distinct post_id),count(*) into ids,n from removed;
 if n>0 then
   -- Hold only snapshot parent locks. Writers need their independent shard and
   -- marker, never a parent row lock while the worker remains healthy.
   perform 1 from public.posts where id=any(ids) order by id for no key update;
   with totals as (
     select p.id,coalesce(sum(s.likes_count),0)::integer likes,coalesce(sum(s.comments_count),0)::integer comments,
       coalesce(sum(s.reposts_count),0)::integer reposts,coalesce(sum(s.bookmarks_count),0)::integer bookmarks
     from public.posts p left join post_counter_internal.shards s on s.post_id=p.id
     where p.id=any(ids) group by p.id
   ) update public.posts p set likes_count=t.likes,comments_count=t.comments,
     reposts_count=t.reposts,bookmarks_count=t.bookmarks from totals t where p.id=t.id
     and (p.likes_count,p.comments_count,p.reposts_count,p.bookmarks_count)
       is distinct from (t.likes,t.comments,t.reposts,t.bookmarks);
   get diagnostics changed=row_count;
 end if;
 update post_counter_internal.settings set last_flush_at=clock_timestamp(),last_error=null where singleton;
 return coalesce(changed,0);
end $$;

create function public.configure_distributed_post_counters_v1(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_enabled is null then raise exception 'INVALID_COUNTER_CONFIGURATION';end if;
 -- Match the worker's advisory-lock-before-parent-lock order. Taking the table
 -- fence first could deadlock a worker between its claim and snapshot UPDATE.
 perform pg_advisory_xact_lock(7132041,1);
 lock table public.posts,public.post_likes,public.post_comments,public.post_reposts,public.post_bookmarks
   in share row exclusive mode nowait;
 -- A bounded initial dataset can cut over atomically. At later scale the same
 -- operation fails within the caller's deadline instead of silently truncating.
 update public.posts p set likes_count=c.likes,comments_count=c.comments,reposts_count=c.reposts,bookmarks_count=c.bookmarks
 from (select p2.id,coalesce(sum(s.likes_count),0)::integer likes,coalesce(sum(s.comments_count),0)::integer comments,
   coalesce(sum(s.reposts_count),0)::integer reposts,coalesce(sum(s.bookmarks_count),0)::integer bookmarks
   from public.posts p2 left join post_counter_internal.shards s on s.post_id=p2.id group by p2.id)c
 where p.id=c.id and (p.likes_count,p.comments_count,p.reposts_count,p.bookmarks_count)
   is distinct from (c.likes,c.comments,c.reposts,c.bookmarks);
 delete from post_counter_internal.dirty;
 update post_counter_internal.settings set enabled=p_enabled,last_flush_at=clock_timestamp(),last_error=null where singleton;
end $$;
create function public.post_counter_status_v1()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'enabled',s.enabled,'shards',64,'lag_target_ms',s.lag_target_ms,
   'last_flush_at',s.last_flush_at,'last_error',s.last_error,
   'synchronous_fallback',s.enabled and coalesce(s.last_flush_at<now()-interval '5 seconds',true),
   'pending', (select count(*) from(select 1 from post_counter_internal.dirty limit 100001)q),
   'pending_capped',(select count(*)>100000 from(select 1 from post_counter_internal.dirty limit 100001)q),
   'oldest_pending_at',(select queued_at from post_counter_internal.dirty order by queued_at limit 1))
 from post_counter_internal.settings s where singleton;
$$;
revoke all on function public.flush_post_engagement_snapshots_v1(integer),
 public.configure_distributed_post_counters_v1(boolean),public.post_counter_status_v1() from public,anon,authenticated;
grant execute on function public.flush_post_engagement_snapshots_v1(integer),
 public.configure_distributed_post_counters_v1(boolean),public.post_counter_status_v1() to service_role;

-- Scheduling is installed only where pg_cron is already available. Activation
-- remains explicit after verifying this worker and its one-second lag metric.
do $$begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
   perform cron.schedule('post-counter-snapshots-v1','1 second','select public.flush_post_engagement_snapshots_v1(4000)');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
