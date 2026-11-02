begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- One atomic cutover, including canonical reconciliation. NOWAIT aborts if a
-- writer is already active. New writes wait until this bounded transaction
-- completes or rolls back; rehearse and schedule that short cutover explicitly.
lock table public.posts, public.post_likes, public.post_comments,
  public.post_reposts, public.post_bookmarks in share row exclusive mode nowait;

-- Refuse changed trigger bindings instead of guessing which callbacks to drop.
do $$
declare expected record;
begin
  for expected in select * from (values
    ('post_likes', 'trg_sync_post_likes_count_exact', 'sync_post_likes_count_exact'),
    ('post_comments', 'comment_trigger', 'update_comment_count'),
    ('post_comments', 'trg_comments_count', 'update_comments_count'),
    ('post_comments', 'trg_post_comments', 'sync_post_comments_count'),
    ('post_comments', 'trg_sync_post_comment_count_delete', 'sync_post_comment_count'),
    ('post_comments', 'trg_sync_post_comment_count_insert', 'sync_post_comment_count'),
    ('post_comments', 'zz_sync_count_exact', 'sync_post_counter_exact'),
    ('post_reposts', 'trg_post_reposts', 'sync_post_reposts_count'),
    ('post_reposts', 'zz_sync_count_exact', 'sync_post_counter_exact'),
    ('post_bookmarks', 'trg_post_bookmarks', 'sync_post_bookmarks_count'),
    ('post_bookmarks', 'trg_sync_post_bookmark_count_delete', 'sync_post_bookmark_count'),
    ('post_bookmarks', 'trg_sync_post_bookmark_count_insert', 'sync_post_bookmark_count'),
    ('post_bookmarks', 'zz_sync_count_exact', 'sync_post_counter_exact')
  ) as bindings(table_name, trigger_name, function_name)
  loop
    if not exists (
      select 1 from pg_catalog.pg_trigger t
      join pg_catalog.pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = ('public.' || expected.table_name)::regclass
        and t.tgname = expected.trigger_name and not t.tgisinternal
        and p.pronamespace = 'public'::regnamespace and p.proname = expected.function_name
        and t.tgenabled = 'O' and t.tgtype in (5, 9, 13)
    ) then raise exception 'ENGAGEMENT_COUNTER_TRIGGER_DRIFT: %.%', expected.table_name, expected.trigger_name;
    end if;
  end loop;
end $$;

create schema post_counter_internal;
revoke all on schema post_counter_internal from public, anon, authenticated, service_role;

create function post_counter_internal.apply_delta()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  counter_column text;
  change record;
  changes_query text;
begin
  if tg_table_schema <> 'public' or tg_level <> 'STATEMENT' or tg_when <> 'AFTER' then
    raise exception 'INVALID_COUNTER_TRIGGER';
  end if;
  counter_column := case tg_table_name
    when 'post_likes' then 'likes_count'
    when 'post_comments' then 'comments_count'
    when 'post_reposts' then 'reposts_count'
    when 'post_bookmarks' then 'bookmarks_count'
    else null end;
  if counter_column is null then raise exception 'INVALID_COUNTER_TABLE'; end if;

  -- Transition relations contain only rows actually changed by this statement.
  -- Duplicate INSERT ... ON CONFLICT DO NOTHING therefore has zero delta.
  -- UPDATE handles reassignment, while body edits/seen retries do no post write.
  if tg_op = 'INSERT' then
    changes_query := 'select post_id, count(*)::bigint as delta from new_rows where post_id is not null group by post_id order by post_id';
  elsif tg_op = 'DELETE' then
    changes_query := 'select post_id, -count(*)::bigint as delta from old_rows where post_id is not null group by post_id order by post_id';
  elsif tg_op = 'UPDATE' then
    changes_query := 'select post_id, sum(delta)::bigint as delta from (
      select post_id, 1 as delta from new_rows union all select post_id, -1 as delta from old_rows
    ) changed where post_id is not null group by post_id having sum(delta) <> 0 order by post_id';
  else raise exception 'INVALID_COUNTER_OPERATION';
  end if;

  -- Fixed UUID order avoids opposite lock orders within multi-post statements.
  -- The arithmetic is inside the UPDATE, so a waiting writer uses the latest
  -- committed counter. No historical engagement scan or stale read-then-write.
  for change in execute changes_query loop
    execute format('update public.posts set %1$I = coalesce(%1$I, 0)::bigint + $1 where id = $2', counter_column)
      using change.delta, change.post_id;
  end loop;
  return null;
end;
$$;
revoke all on function post_counter_internal.apply_delta() from public, anon, authenticated, service_role;

-- A stale whole-post save must not overwrite derived values after moving from
-- recounts to deltas. Keep normal author edits working; ignore client-supplied
-- counters. CURRENT_USER (not the request JWT role) lets the SECURITY DEFINER
-- delta above write while the authenticated request retains its original JWT.
create function post_counter_internal.protect_client_counters()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.likes_count := 0;
      new.comments_count := 0;
      new.reposts_count := 0;
      new.bookmarks_count := 0;
    else
      new.likes_count := old.likes_count;
      new.comments_count := old.comments_count;
      new.reposts_count := old.reposts_count;
      new.bookmarks_count := old.bookmarks_count;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function post_counter_internal.protect_client_counters() from public, anon, authenticated, service_role;
create trigger protect_post_engagement_counts
  before insert or update on public.posts
  for each row execute function post_counter_internal.protect_client_counters();

drop trigger trg_sync_post_likes_count_exact on public.post_likes;
drop trigger comment_trigger on public.post_comments;
drop trigger trg_comments_count on public.post_comments;
drop trigger trg_post_comments on public.post_comments;
drop trigger trg_sync_post_comment_count_delete on public.post_comments;
drop trigger trg_sync_post_comment_count_insert on public.post_comments;
drop trigger zz_sync_count_exact on public.post_comments;
drop trigger trg_post_reposts on public.post_reposts;
drop trigger zz_sync_count_exact on public.post_reposts;
drop trigger trg_post_bookmarks on public.post_bookmarks;
drop trigger trg_sync_post_bookmark_count_delete on public.post_bookmarks;
drop trigger trg_sync_post_bookmark_count_insert on public.post_bookmarks;
drop trigger zz_sync_count_exact on public.post_bookmarks;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where t.tgrelid in ('public.post_likes'::regclass, 'public.post_comments'::regclass,
      'public.post_reposts'::regclass, 'public.post_bookmarks'::regclass)
      and not t.tgisinternal and p.pronamespace = 'public'::regnamespace
      and p.proname in ('sync_post_likes_count', 'sync_post_likes_count_exact',
        'update_comment_count', 'update_comments_count', 'sync_post_comment_count',
        'sync_post_comments_count', 'sync_post_reposts_count', 'sync_post_bookmark_count',
        'sync_post_bookmarks_count', 'sync_post_counter_exact')
  ) then raise exception 'ENGAGEMENT_COUNTER_UNEXPECTED_CALLBACK'; end if;
end $$;

do $$
declare target text;
begin
  foreach target in array array['post_likes', 'post_comments', 'post_reposts', 'post_bookmarks'] loop
    execute format('create trigger post_counter_insert after insert on public.%I referencing new table as new_rows for each statement execute function post_counter_internal.apply_delta()', target);
    execute format('create trigger post_counter_delete after delete on public.%I referencing old table as old_rows for each statement execute function post_counter_internal.apply_delta()', target);
    execute format('create trigger post_counter_update after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function post_counter_internal.apply_delta()', target);
  end loop;
end $$;

-- Exactly the old final trigger's counts: comments include replies, hidden and
-- spam rows. Moderation, notifications, ownership and existing RLS stay intact.
with likes as (select post_id, count(*) as n from public.post_likes group by post_id),
  comments as (select post_id, count(*) as n from public.post_comments group by post_id),
  reposts as (select post_id, count(*) as n from public.post_reposts group by post_id),
  bookmarks as (select post_id, count(*) as n from public.post_bookmarks group by post_id),
  canonical as (
    select p.id, coalesce(l.n, 0) as likes, coalesce(c.n, 0) as comments,
      coalesce(r.n, 0) as reposts, coalesce(b.n, 0) as bookmarks
    from public.posts p left join likes l on l.post_id = p.id
    left join comments c on c.post_id = p.id left join reposts r on r.post_id = p.id
    left join bookmarks b on b.post_id = p.id
  )
update public.posts p set likes_count = c.likes, comments_count = c.comments,
  reposts_count = c.reposts, bookmarks_count = c.bookmarks
from canonical c where p.id = c.id and
  (p.likes_count, p.comments_count, p.reposts_count, p.bookmarks_count)
  is distinct from (c.likes, c.comments, c.reposts, c.bookmarks);

-- Views deliberately keep their existing post_seen/record_video_view contract.
-- A separate decision is needed before merging those two different definitions.
-- Trusted imports/maintenance that explicitly override these four derived
-- columns must also reconcile them against their canonical engagement tables.
commit;
