-- Additive feed delivery protocol. Disabled until an operator verifies the
-- scheduler/private-channel setup and explicitly enables it. Older clients
-- continue using existing Postgres Changes and existing read contracts.
create schema if not exists feed_live;
revoke all on schema feed_live from public, anon, authenticated;

create table if not exists feed_live.settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  last_drain_at timestamptz,
  drain_failed boolean not null default false,
  recovery_generation bigint not null default 0,
  recovery_required boolean not null default false
);
insert into feed_live.settings(singleton) values(true) on conflict do nothing;
create table if not exists feed_live.pending (
  topic text not null,
  bucket bigint not null,
  subject_id uuid,
  kind text not null check (kind in ('post', 'author', 'viewer', 'head', 'recovery')),
  due_at timestamptz not null,
  queued_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  primary key(topic, bucket)
);
create index if not exists feed_live_pending_due on feed_live.pending(due_at, topic);
create index if not exists feed_live_pending_age on feed_live.pending(queued_at);
alter table feed_live.settings enable row level security;
alter table feed_live.pending enable row level security;
revoke all on all tables in schema feed_live from public, anon, authenticated;

create or replace function public.get_feed_live_capability()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('version', 1, 'max_ids', 24, 'configured', s.enabled,
    'recovery_generation', s.recovery_generation, 'enabled',
    auth.uid() is not null and s.enabled and not s.drain_failed and not s.recovery_required
    and coalesce(s.last_drain_at >= now() - interval '15 seconds', false)
    and not exists(select 1 from feed_live.pending q where q.queued_at < now()-interval '15 seconds'))
  from feed_live.settings s where s.singleton;
$$;
revoke all on function public.get_feed_live_capability() from public, anon;
grant execute on function public.get_feed_live_capability() to authenticated;

-- Authorization runs as the subscriber. Do not make this SECURITY DEFINER:
-- get_feed_visibility intentionally retains posts/profiles/comment RLS.
create or replace function public.can_receive_feed_live(p_topic text)
returns boolean language plpgsql stable security invoker set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null then return false; end if;
  if p_topic in ('feed:head:v1', 'feed:recovery:v1') then return true; end if;
  if p_topic = 'feed:viewer:' || auth.uid()::text then return true; end if;
  if p_topic ~ '^feed:post:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := substring(p_topic from 11)::uuid;
    return exists(select 1 from public.get_feed_visibility(array[v_id]));
  end if;
  if p_topic ~ '^feed:author:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := substring(p_topic from 13)::uuid;
    return exists(select 1 from public.profiles p where p.id = v_id and public.can_view_profile(p.id));
  end if;
  return false;
end;
$$;
revoke all on function public.can_receive_feed_live(text) from public, anon;
grant execute on function public.can_receive_feed_live(text) to authenticated, anon;
drop policy if exists feed_live_receive on realtime.messages;
create policy feed_live_receive on realtime.messages for select to authenticated
  using (extension = 'broadcast' and topic=(select realtime.topic())
    and public.can_receive_feed_live(topic));
-- Other applications may already have permissive Broadcast policies. These
-- guards constrain the feed prefix even when another policy allows all topics.
drop policy if exists feed_live_read_guard on realtime.messages;
create policy feed_live_read_guard on realtime.messages as restrictive for select to public
  using (topic not like 'feed:%' or public.can_receive_feed_live(topic));
drop policy if exists feed_live_write_guard on realtime.messages;
create policy feed_live_write_guard on realtime.messages as restrictive for insert to public
  with check (topic not like 'feed:%');

create index if not exists post_comments_live_preview
  on public.post_comments(post_id, created_at desc, id desc) where parent_comment_id is null;
create or replace function public.get_feed_live_state(p_ids uuid[])
returns table (
  post_id uuid, content text, body text, likes_count integer, comments_count integer,
  reposts_count integer, bookmarks_count integer, shares_count integer, views_count integer,
  viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean,
  comment_id uuid, comment_body text, comment_author text, delivery_healthy boolean
)
language plpgsql stable security invoker set search_path = ''
as $$
declare v_capability jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if coalesce(cardinality(p_ids), 0) > 24 then raise exception 'At most 24 post IDs can be refreshed' using errcode='22023'; end if;
  v_capability := public.get_feed_live_capability();
  if not coalesce((v_capability->>'configured')::boolean, false) then
    raise exception 'Feed live delivery is unavailable' using errcode='55000';
  end if;
  return query
  select p.id, p.content, p.body, coalesce(p.likes_count,0), coalesce(p.comments_count,0), coalesce(p.reposts_count,0),
    coalesce(p.bookmarks_count,0), coalesce(p.shares_count,0), coalesce(p.views_count,0),
    exists(select 1 from public.post_likes x where x.post_id=p.id and x.user_id=(select auth.uid())),
    exists(select 1 from public.post_bookmarks x where x.post_id=p.id and x.user_id=(select auth.uid())),
    exists(select 1 from public.post_reposts x where x.post_id=p.id and x.user_id=(select auth.uid())),
    c.id, c.body, coalesce(nullif(pr.full_name, ''), pr.username, 'User'),
    coalesce((v_capability->>'enabled')::boolean, false)
  from public.get_feed_visibility(coalesce(p_ids, '{}'::uuid[])) visible
  join public.posts p on p.id=visible.post_id
  left join lateral (
    select x.id, x.body, x.user_id from public.post_comments x
    where x.post_id=p.id and x.parent_comment_id is null
    order by x.created_at desc, x.id desc limit 1
  ) c on true
  left join public.profiles pr on pr.id=c.user_id;
end;
$$;
revoke all on function public.get_feed_live_state(uuid[]) from public, anon;
grant execute on function public.get_feed_live_state(uuid[]) to authenticated;

create or replace function feed_live.enqueue(p_kind text, p_id uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_bucket bigint; v_settings feed_live.settings%rowtype; v_transaction bigint;
begin
  select * into v_settings from feed_live.settings where singleton;
  if not v_settings.enabled then return; end if;
  if p_kind <> 'head' and p_id is null then return; end if;
  if v_settings.recovery_required or v_settings.drain_failed
    or coalesce(v_settings.last_drain_at < clock_timestamp()-interval '15 seconds', true)
    or exists(select 1 from feed_live.pending q where q.queued_at < clock_timestamp()-interval '15 seconds') then
    if current_setting('feed_live.recovery_enqueued', true) = 'on' then return; end if;
    v_transaction := txid_current();
    -- Fixed 1,024 shards bound a stopped worker's outage markers. Keep the
    -- marker row lock until this canonical transaction commits: DO NOTHING
    -- alone could lose a late commit after an earlier marker was drained.
    insert into feed_live.pending as q(topic, bucket, subject_id, kind, due_at)
      values('feed:recovery:' || (v_transaction % 1024)::text, 0, null, 'recovery', clock_timestamp())
      on conflict(topic, bucket) do update set due_at=least(q.due_at, excluded.due_at);
    -- Lock queue before settings, matching the drain's lock order. Reversing
    -- this order can deadlock a late recovery writer with the drainer.
    -- Recheck after a possible marker wait: the drain may have cleared the
    -- earlier snapshot's recovery flag. The predicate writes only transitions.
    update feed_live.settings set recovery_required=true, recovery_generation=recovery_generation+1
      where singleton and not recovery_required;
    perform set_config('feed_live.recovery_enqueued', 'on', true);
    return;
  end if;
  v_bucket := floor(extract(epoch from clock_timestamp()) / 2)::bigint;
  insert into feed_live.pending(topic, bucket, subject_id, kind, due_at)
    values(case when p_kind='head' then 'feed:head:v1' else 'feed:' || p_kind || ':' || p_id::text end,
      v_bucket, p_id, p_kind, to_timestamp((v_bucket+1)*2))
    on conflict(topic, bucket) do nothing;
  -- Current writes use a new bucket while the worker drains expired buckets,
  -- avoiding contention with slow sends/deletes of the old queue row. A late
  -- transaction's bucket becomes visible to a later drain, never overwritten.
end;
$$;
revoke all on function feed_live.enqueue(text, uuid) from public, anon, authenticated;

create or replace function feed_live.post_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op='DELETE' then
    perform feed_live.enqueue('post', old.id);
  else
    perform feed_live.enqueue('post', new.id);
    if tg_op='INSERT' then perform feed_live.enqueue('head'); end if;
  end if;
  return null;
end;
$$;
revoke all on function feed_live.post_changed() from public, anon, authenticated;
drop trigger if exists feed_live_post on public.posts;
create trigger feed_live_post after insert or update or delete on public.posts
  for each row execute function feed_live.post_changed();

create or replace function feed_live.comment_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op='INSERT' then perform feed_live.enqueue('post', new.post_id);
  elsif tg_op='DELETE' then perform feed_live.enqueue('post', old.post_id);
  else
    perform feed_live.enqueue('post', least(old.post_id, new.post_id));
    if old.post_id is distinct from new.post_id then perform feed_live.enqueue('post', greatest(old.post_id, new.post_id)); end if;
  end if;
  return null;
end;
$$;
revoke all on function feed_live.comment_changed() from public, anon, authenticated;
drop trigger if exists feed_live_comment on public.post_comments;
create trigger feed_live_comment after insert or update or delete on public.post_comments
  for each row execute function feed_live.comment_changed();

create or replace function feed_live.visibility_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r jsonb; v_targets jsonb := '[]'::jsonb; v_kind text; v_id uuid;
begin
  if tg_table_name='profiles' and tg_op='UPDATE' then
    if old.profile_visibility is not distinct from new.profile_visibility
      and old.deactivated_at is not distinct from new.deactivated_at
      and old.is_verified is not distinct from new.is_verified
      and old.id is not distinct from new.id then
      -- Compare the actual fields before any JSON conversion: profile
      -- heartbeats must not enqueue work or serialize the entire profile.
      return null;
    end if;
  end if;
  for r in select value from jsonb_array_elements(jsonb_build_array(
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end)) where value <> 'null'::jsonb
  loop
    if tg_table_name='profiles' then
      v_targets := v_targets || jsonb_build_array(jsonb_build_object('kind','author','id',r->>'id'),jsonb_build_object('kind','viewer','id',r->>'id'));
    elsif tg_table_name='blocked_users' then
      v_targets := v_targets || jsonb_build_array(jsonb_build_object('kind','viewer','id',r->>'blocker_id'),jsonb_build_object('kind','viewer','id',r->>'blocked_id'));
    elsif tg_table_name='follows' then
      v_targets := v_targets || jsonb_build_array(jsonb_build_object('kind','viewer','id',r->>'follower_id'));
    elsif tg_table_name='post_mentions' then
      v_targets := v_targets || jsonb_build_array(jsonb_build_object('kind','post','id',r->>'post_id'),jsonb_build_object('kind','viewer','id',r->>'mentioned_user_id'));
    else
      v_targets := v_targets || jsonb_build_array(jsonb_build_object('kind','viewer','id',r->>'user_id'));
    end if;
  end loop;
  -- Reciprocal block/unblock operations acquire shared queue topics in the
  -- same order, rather than locking viewer A/B in opposite orders.
  for v_kind, v_id in select distinct value->>'kind', (value->>'id')::uuid
    from jsonb_array_elements(v_targets) where value->>'id' is not null order by 1, 2
  loop perform feed_live.enqueue(v_kind, v_id); end loop;
  return null;
end;
$$;
revoke all on function feed_live.visibility_changed() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['profiles','blocked_users','follows','hidden_posts','muted_authors','post_mentions','community_members'] loop
    execute format('drop trigger if exists feed_live_visibility on public.%I', t);
    execute format('create trigger feed_live_visibility after insert or update or delete on public.%I for each row execute function feed_live.visibility_changed()', t);
  end loop;
end;
$$;

create or replace function public.drain_feed_live(p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r feed_live.pending%rowtype; v_sent integer := 0; v_failed integer := 0; v_topic text;
  v_topics text[] := '{}'::text[];
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Drain batch must be between 1 and 1000' using errcode='22023';
  end if;
  if exists(select 1 from feed_live.settings where singleton and enabled) then
    for r in select * from feed_live.pending where due_at <= clock_timestamp()
      order by due_at, topic for update skip locked limit p_limit
    loop
      begin
        delete from feed_live.pending where topic=r.topic and bucket=r.bucket;
        v_topic := case when r.kind='recovery' then 'feed:recovery:v1' else r.topic end;
        if not (v_topic = any(v_topics)) then
          perform realtime.send(
            case when r.kind='post' then jsonb_build_object('post_id', r.subject_id) else '{}'::jsonb end,
            case when r.kind='head' then 'new_posts' when r.kind='recovery' then 'resync' else 'invalidate' end, v_topic, true);
          v_topics := array_append(v_topics, v_topic);
          v_sent := v_sent + 1;
        end if;
      exception when others then
        -- This subtransaction restores the deleted row before rescheduling it.
        -- A delivery failure must not lose the final update in a burst.
        update feed_live.pending set attempts=least(attempts+1, 1000000),
          due_at=clock_timestamp()+make_interval(secs=>least(60, power(2, least(attempts+1, 6))::integer))
          where topic=r.topic and bucket=r.bucket;
        v_failed := v_failed + 1;
      end;
    end loop;
  end if;
  update feed_live.settings set last_drain_at=clock_timestamp(), drain_failed=(v_failed > 0),
    recovery_required=case when v_failed=0 and not exists(select 1 from feed_live.pending where kind='recovery') then false else recovery_required end
    where singleton;
  return jsonb_build_object('sent', v_sent, 'failed', v_failed);
end;
$$;
revoke all on function public.drain_feed_live(integer) from public, anon, authenticated;
grant execute on function public.drain_feed_live(integer) to service_role;

create or replace function public.configure_feed_live(p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_enabled and not exists(select 1 from feed_live.settings where singleton
    and last_drain_at >= clock_timestamp()-interval '15 seconds' and not drain_failed) then
    raise exception 'Verify the feed-live-drain scheduler before enabling Broadcast' using errcode='55000';
  end if;
  update feed_live.settings set enabled=coalesce(p_enabled, false) where singleton;
end;
$$;
revoke all on function public.configure_feed_live(boolean) from public, anon, authenticated;
grant execute on function public.configure_feed_live(boolean) to service_role;

-- Installation never starts recurring work. The operator must separately
-- schedule the bounded drain, verify actual private Broadcast delivery and
-- job-log retention, then explicitly enable the capability. See rollout docs.
