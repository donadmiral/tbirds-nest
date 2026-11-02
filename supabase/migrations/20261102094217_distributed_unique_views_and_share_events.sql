begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.posts,public.post_seen,public.post_video_views,
 public.post_likes,public.post_comments,public.post_reposts,public.post_bookmarks
 in share row exclusive mode nowait;

-- The old seen trigger recounted unique non-author viewers, while the video
-- writer incremented that same column independently. Their order could count
-- the same viewer twice or erase a qualified video view. One canonical union
-- now owns views_count. Video sessions/durations remain available unchanged.
do $$declare binding record;body text;
begin
 for binding in select * from(values
  ('trg_post_seen_views','bump_post_views',5),
  ('zz_sync_count_exact','sync_post_counter_exact',13)
 ) v(trigger_name,function_name,trigger_type) loop
  if not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
   where t.tgrelid='public.post_seen'::regclass and t.tgname=binding.trigger_name
    and p.pronamespace='public'::regnamespace and p.proname=binding.function_name
    and t.tgtype=binding.trigger_type and t.tgenabled='O' and not t.tgisinternal)
  then raise exception 'VIEW_COUNTER_TRIGGER_REQUIRES_REVIEW: %',binding.trigger_name;end if;
 end loop;
 select replace(prosrc,E'\r','') into body from pg_proc where oid='public.record_video_view(uuid,uuid,text,integer)'::regprocedure;
 if position('on conflict (post_id, session_id)' in body)=0 or position('v_now < 3' in body)=0
  or position('v_first_for_viewer' in body)=0 then raise exception 'VIDEO_VIEW_CONTRACT_REQUIRES_REVIEW';end if;
 select replace(prosrc,E'\r','') into body from pg_proc where oid='public.increment_share_count(uuid)'::regprocedure;
 if btrim(body,E' \n\t\r') <> 'update posts set shares_count = shares_count + 1 where id = p_post_id;'
 then raise exception 'SHARE_COUNTER_CONTRACT_REQUIRES_REVIEW';end if;
end $$;

alter table post_counter_internal.shards
 add column views_count bigint not null default 0 check(views_count>=0),
 add column shares_count bigint not null default 0 check(shares_count>=0);
create table post_counter_internal.viewers(
 post_id uuid not null references public.posts(id) on delete cascade,
 viewer_key text not null check(length(viewer_key)<=1060),
 viewer_id uuid,
 seen_count integer not null default 0 check(seen_count>=0),
 video_count integer not null default 0 check(video_count>=0),
 primary key(post_id,viewer_key)
);
create table post_counter_internal.share_events(
 post_id uuid not null references public.posts(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete cascade,
 event_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,event_id)
);
create index post_share_events_post_idx on post_counter_internal.share_events(post_id);
alter table post_counter_internal.viewers enable row level security;
alter table post_counter_internal.share_events enable row level security;
revoke all on post_counter_internal.viewers,post_counter_internal.share_events from public,anon,authenticated,service_role;

insert into post_counter_internal.viewers(post_id,viewer_key,viewer_id,seen_count,video_count)
select post_id,viewer_key,viewer_id,sum(seen)::integer,sum(video)::integer from(
 select post_id,'u:'||user_id::text viewer_key,user_id viewer_id,1 seen,0 video from public.post_seen
 union all
 select post_id,case when viewer_id is null then 's:'||session_id else 'u:'||viewer_id::text end,
  viewer_id,0,1 from public.post_video_views where duration_sec>=3
) source group by post_id,viewer_key,viewer_id;
insert into post_counter_internal.shards(post_id,shard,views_count)
select post_id,post_counter_internal.shard_for(viewer_id),count(*) from post_counter_internal.viewers
group by post_id,post_counter_internal.shard_for(viewer_id)
on conflict(post_id,shard) do update set views_count=excluded.views_count;
-- Historical share counts had no event ledger. Keep that exact base once;
-- new idempotent events add/subtract independent per-actor shards.
insert into post_counter_internal.shards(post_id,shard,shares_count)
select id,0,greatest(coalesce(shares_count,0),0) from public.posts where coalesce(shares_count,0)>0
on conflict(post_id,shard) do update set shares_count=excluded.shares_count;

create function post_counter_internal.exact_reach(p_id uuid)
returns table(views_count integer,shares_count integer)
language sql stable security definer set search_path='' as $$
 select greatest(coalesce(sum(s.views_count),0)-case when exists(
  select 1 from post_counter_internal.viewers v join public.posts p on p.id=v.post_id
  where v.post_id=p_id and v.viewer_key='u:'||p.user_id::text and v.seen_count+v.video_count>0
 ) then 1 else 0 end,0)::integer,coalesce(sum(s.shares_count),0)::integer
 from post_counter_internal.shards s where s.post_id=p_id
  and auth.uid() is not null and public.can_view_post(p_id)
 having auth.uid() is not null and public.can_view_post(p_id);
$$;
revoke all on function post_counter_internal.exact_reach(uuid) from public,anon,service_role;
grant execute on function post_counter_internal.exact_reach(uuid) to authenticated;

create function post_counter_internal.apply_reach_delta(p_post uuid,p_shard smallint,p_column text,p_delta bigint)
returns void language plpgsql security definer set search_path='' as $$
declare config post_counter_internal.settings%rowtype;touched integer;
begin
 if p_column not in('views_count','shares_count') then raise exception 'INVALID_REACH_COLUMN';end if;
 if p_delta=0 or not exists(select 1 from public.posts where id=p_post) then return;end if;
 select * into strict config from post_counter_internal.settings where singleton;
 if p_delta>0 then
  execute format('insert into post_counter_internal.shards as s(post_id,shard,%1$I) values($1,$2,$3)
   on conflict(post_id,shard) do update set %1$I=s.%1$I+excluded.%1$I',p_column) using p_post,p_shard,p_delta;
 else
  execute format('update post_counter_internal.shards set %1$I=%1$I+$3 where post_id=$1 and shard=$2',p_column)
   using p_post,p_shard,p_delta;
  get diagnostics touched=row_count;
  if touched=0 then raise exception 'MISSING_REACH_SHARD';end if;
 end if;
 if config.enabled then
  insert into post_counter_internal.dirty as q(post_id,shard) values(p_post,p_shard)
  on conflict(post_id,shard) do update set version=q.version+1;
 end if;
 if not config.enabled or coalesce(config.last_flush_at<clock_timestamp()-interval '5 seconds',true) then
  perform 1 from public.posts where id=p_post for no key update;
  update public.posts p set views_count=greatest(c.views-case when exists(
   select 1 from post_counter_internal.viewers v where v.post_id=p.id and v.viewer_key='u:'||p.user_id::text
    and v.seen_count+v.video_count>0) then 1 else 0 end,0)::integer,shares_count=c.shares::integer
  from(select coalesce(sum(views_count),0) views,coalesce(sum(shares_count),0) shares
   from post_counter_internal.shards where post_id=p_post)c where p.id=p_post;
 end if;
end $$;
revoke all on function post_counter_internal.apply_reach_delta(uuid,smallint,text,bigint) from public,anon,authenticated,service_role;

create function post_counter_internal.apply_view_delta()
returns trigger language plpgsql security definer set search_path='' as $$
declare source text;changes text;item record;state post_counter_internal.viewers%rowtype;
 delta bigint;pending jsonb:='[]';previous_count integer;
begin
 if tg_table_schema<>'public' or tg_level<>'STATEMENT' or tg_when<>'AFTER'
  or tg_table_name not in('post_seen','post_video_views') then raise exception 'INVALID_VIEW_TRIGGER';end if;
 if tg_table_name='post_seen' then
  source:='select post_id,''u:''||user_id::text viewer_key,user_id viewer_id,1 seen,0 video from %s';
 else
  source:='select post_id,case when viewer_id is null then ''s:''||session_id else ''u:''||viewer_id::text end viewer_key,
   viewer_id,0 seen,1 video from %s where duration_sec>=3';
 end if;
 if tg_op='INSERT' then changes:='select *,1 multiplier from ('||format(source,'new_rows')||')n';
 elsif tg_op='DELETE' then changes:='select *,-1 multiplier from ('||format(source,'old_rows')||')o';
 elsif tg_op='UPDATE' then changes:='select *,1 multiplier from ('||format(source,'new_rows')||')n union all
  select *,-1 multiplier from ('||format(source,'old_rows')||')o';
 else raise exception 'INVALID_VIEW_OPERATION';end if;
 for item in execute 'select post_id,viewer_key,viewer_id,sum(seen*multiplier)::integer seen,sum(video*multiplier)::integer video
  from ('||changes||') c group by post_id,viewer_key,viewer_id having sum(seen*multiplier)<>0 or sum(video*multiplier)<>0
  order by post_id,viewer_key'
 loop
  if not exists(select 1 from public.posts where id=item.post_id) then continue;end if;
  update post_counter_internal.viewers v set seen_count=v.seen_count+item.seen,video_count=v.video_count+item.video
   where v.post_id=item.post_id and v.viewer_key=item.viewer_key returning v.* into state;
  if not found then
   if item.seen<0 or item.video<0 then raise exception 'MISSING_VIEWER_LEDGER';end if;
   insert into post_counter_internal.viewers as v(post_id,viewer_key,viewer_id,seen_count,video_count)
   values(item.post_id,item.viewer_key,item.viewer_id,item.seen,item.video)
   on conflict(post_id,viewer_key) do update set seen_count=v.seen_count+excluded.seen_count,
    video_count=v.video_count+excluded.video_count returning v.* into state;
  end if;
  previous_count:=state.seen_count+state.video_count-item.seen-item.video;
  delta:=case when state.seen_count+state.video_count>0 then 1 else 0 end-case when previous_count>0 then 1 else 0 end;
  if state.seen_count+state.video_count=0 then
   delete from post_counter_internal.viewers where post_id=item.post_id and viewer_key=item.viewer_key;
  end if;
  if delta<>0 then pending:=pending||jsonb_build_array(jsonb_build_object('post_id',item.post_id,
   'shard',post_counter_internal.shard_for(item.viewer_id),'delta',delta));end if;
 end loop;
 -- Ledger rows lock in viewer order, then shared shard rows in shard order.
 for item in select post_id,shard,sum(d.delta)::bigint delta from jsonb_to_recordset(pending)
  d(post_id uuid,shard smallint,delta bigint) group by post_id,shard having sum(d.delta)<>0 order by post_id,shard
 loop perform post_counter_internal.apply_reach_delta(item.post_id,item.shard,'views_count',item.delta);end loop;
 return null;
end $$;
revoke all on function post_counter_internal.apply_view_delta() from public,anon,authenticated,service_role;
drop trigger trg_post_seen_views on public.post_seen;
drop trigger zz_sync_count_exact on public.post_seen;
do $$declare target text;
begin
 foreach target in array array['post_seen','post_video_views'] loop
  execute format('create trigger post_view_insert after insert on public.%I referencing new table as new_rows for each statement execute function post_counter_internal.apply_view_delta()',target);
  execute format('create trigger post_view_delete after delete on public.%I referencing old table as old_rows for each statement execute function post_counter_internal.apply_view_delta()',target);
  execute format('create trigger post_view_update after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function post_counter_internal.apply_view_delta()',target);
 end loop;
end $$;

create function post_counter_internal.apply_share_delta()
returns trigger language plpgsql security definer set search_path='' as $$
declare changes text;item record;
begin
 if tg_table_schema<>'post_counter_internal' or tg_table_name<>'share_events' or tg_level<>'STATEMENT'
  then raise exception 'INVALID_SHARE_TRIGGER';end if;
 if tg_op='INSERT' then changes:='select post_id,actor_id,1 delta from new_rows';
 elsif tg_op='DELETE' then changes:='select post_id,actor_id,-1 delta from old_rows';
 else raise exception 'INVALID_SHARE_OPERATION';end if;
 for item in execute 'select post_id,post_counter_internal.shard_for(actor_id) shard,sum(delta)::bigint delta from ('||changes||') c
  group by post_id,post_counter_internal.shard_for(actor_id) order by post_id,shard'
 loop perform post_counter_internal.apply_reach_delta(item.post_id,item.shard,'shares_count',item.delta);end loop;
 return null;
end $$;
revoke all on function post_counter_internal.apply_share_delta() from public,anon,authenticated,service_role;
create trigger post_share_insert after insert on post_counter_internal.share_events referencing new table as new_rows
 for each statement execute function post_counter_internal.apply_share_delta();
create trigger post_share_delete after delete on post_counter_internal.share_events referencing old table as old_rows
 for each statement execute function post_counter_internal.apply_share_delta();

create function public.record_post_share_v1(p_post_id uuid,p_event_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid();existing uuid;total integer;
begin
 if viewer is null or not public.can_view_post(p_post_id) then raise exception 'Post unavailable' using errcode='42501';end if;
 if p_event_id is null then raise exception 'A share event identifier is required' using errcode='22023';end if;
 insert into post_counter_internal.share_events(post_id,actor_id,event_id) values(p_post_id,viewer,p_event_id)
 on conflict(actor_id,event_id) do nothing;
 select post_id into existing from post_counter_internal.share_events where actor_id=viewer and event_id=p_event_id;
 if existing is distinct from p_post_id then raise exception 'Share event identifier already used' using errcode='22023';end if;
 select coalesce(sum(shares_count),0)::integer into total from post_counter_internal.shards where post_id=p_post_id;
 return total;
end $$;
revoke all on function public.record_post_share_v1(uuid,uuid) from public,anon,service_role;
grant execute on function public.record_post_share_v1(uuid,uuid) to authenticated;
create or replace function public.increment_share_count(p_post_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin perform public.record_post_share_v1(p_post_id,gen_random_uuid());end $$;
revoke all on function public.increment_share_count(uuid) from public,anon,service_role;
grant execute on function public.increment_share_count(uuid) to authenticated;

create or replace function public.record_video_view(p_post_id uuid,p_viewer_id uuid,p_session text,p_duration integer)
returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid();actual uuid;
begin
 if viewer is null or p_viewer_id is distinct from viewer or not public.can_view_post(p_post_id)
  then raise exception 'Post unavailable' using errcode='42501';end if;
 if p_session is null or length(p_session) not between 1 and 1024 or p_duration is null or p_duration<0 or p_duration>86400
  then raise exception 'Invalid video session' using errcode='22023';end if;
 insert into public.post_video_views(post_id,viewer_id,session_id,duration_sec)
 values(p_post_id,viewer,p_session,p_duration)
 on conflict(post_id,session_id) do update set duration_sec=greatest(post_video_views.duration_sec,excluded.duration_sec),viewed_at=now()
  where post_video_views.viewer_id=viewer returning viewer_id into actual;
 if actual is distinct from viewer then raise exception 'Video session belongs to another viewer' using errcode='42501';end if;
end $$;
revoke all on function public.record_video_view(uuid,uuid,text,integer) from public,anon,service_role;
grant execute on function public.record_video_view(uuid,uuid,text,integer) to authenticated;

-- Expand the existing worker and rollback fence to all six displayed counters.
-- Definitions are local, reviewed preceding migrations, not guessed live SQL.
do $$declare target text;body text;updated text;
begin
 foreach target in array array['public.flush_post_engagement_snapshots_v1(integer)',
  'public.configure_distributed_post_counters_v1(boolean)'] loop
  body:=pg_get_functiondef(target::regprocedure);updated:=body;
  updated:=replace(updated,'public.post_reposts,public.post_bookmarks','public.post_reposts,public.post_bookmarks,public.post_seen,public.post_video_views,post_counter_internal.share_events');
  updated:=replace(updated,'coalesce(sum(s.bookmarks_count),0)::integer bookmarks',
   'coalesce(sum(s.bookmarks_count),0)::integer bookmarks,coalesce(sum(s.shares_count),0)::integer shares,
    greatest(coalesce(sum(s.views_count),0)-case when exists(select 1 from post_counter_internal.viewers v
     where v.post_id=POST_ALIAS.id and v.viewer_key=''u:''||POST_ALIAS.user_id::text and v.seen_count+v.video_count>0)
     then 1 else 0 end,0)::integer views');
  updated:=replace(updated,'POST_ALIAS',case when target like '%configure_%' then 'p2' else 'p' end);
  updated:=replace(updated,'bookmarks_count=t.bookmarks','bookmarks_count=t.bookmarks,views_count=t.views,shares_count=t.shares');
  updated:=replace(updated,'bookmarks_count=c.bookmarks','bookmarks_count=c.bookmarks,views_count=c.views,shares_count=c.shares');
  updated:=replace(updated,'p.reposts_count,p.bookmarks_count)','p.reposts_count,p.bookmarks_count,p.views_count,p.shares_count)');
  updated:=replace(updated,'t.reposts,t.bookmarks)','t.reposts,t.bookmarks,t.views,t.shares)');
  updated:=replace(updated,'c.reposts,c.bookmarks)','c.reposts,c.bookmarks,c.views,c.shares)');
  if updated=body or position('views_count=' in updated)=0 then raise exception 'REACH_WORKER_DEFINITION_REQUIRES_REVIEW';end if;
  execute updated;
 end loop;
 body:=pg_get_functiondef('public.get_post_engagement_counts_v1(uuid[])'::regprocedure);
 updated:=replace(body,'coalesce(p.views_count,0)','reach.views_count');
 updated:=replace(updated,'coalesce(p.shares_count,0)','reach.shares_count');
 updated:=replace(updated,'cross join lateral post_counter_internal.exact(p.id) c',
  'cross join lateral post_counter_internal.exact(p.id) c cross join lateral post_counter_internal.exact_reach(p.id) reach');
 if updated=body or position('reach.views_count' in updated)=0 then raise exception 'REACH_READER_DEFINITION_REQUIRES_REVIEW';end if;
 execute updated;
 foreach target in array array['public.get_feed_rows_by_ids_v1(uuid[])','public.get_feed_live_state(uuid[])'] loop
  if to_regprocedure(target) is null then continue;end if;
  body:=pg_get_functiondef(target::regprocedure);
  updated:=replace(body,'post_counter_internal.exact(p.id) exact_counts',
   'post_counter_internal.exact(p.id) exact_counts cross join lateral post_counter_internal.exact_reach(p.id) exact_reach');
  updated:=replace(updated,'p.views_count','exact_reach.views_count');
  updated:=replace(updated,'p.shares_count','exact_reach.shares_count');
  if updated=body then raise exception 'REACH_CARD_DEFINITION_REQUIRES_REVIEW';end if;
  execute updated;
 end loop;
 body:=pg_get_functiondef('post_counter_internal.protect_client_counters()'::regprocedure);
 updated:=replace(body,'new.bookmarks_count := 0;','new.bookmarks_count := 0;new.views_count:=0;new.shares_count:=0;');
 updated:=replace(updated,'new.bookmarks_count := old.bookmarks_count;',
  'new.bookmarks_count := old.bookmarks_count;new.views_count:=old.views_count;new.shares_count:=old.shares_count;');
 if updated=body then raise exception 'REACH_WRITE_GUARD_REQUIRES_REVIEW';end if;
 execute updated;
end $$;
-- Reconcile current columns without activating distributed writes.
select public.configure_distributed_post_counters_v1((select enabled from post_counter_internal.settings where singleton));
notify pgrst,'reload schema';
commit;
