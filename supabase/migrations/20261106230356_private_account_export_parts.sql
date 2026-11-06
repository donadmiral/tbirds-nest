-- Large exports are immutable JSON Lines archives. The job's owner is selected
-- from auth.uid(). Only the scheduler reads data on behalf of that stored owner.
begin;
create table account_export.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  state text not null default 'queued' check (state in ('queued','ready','failed')),
  snapshot_at timestamptz,
  part_count integer not null default 0,
  byte_count bigint not null default 0,
  collection_counts jsonb
);
create index account_export_pending on account_export.jobs(requested_at, id) where state = 'queued';
create index account_export_expiry on account_export.jobs(expires_at);
create table account_export.parts (
  job_id uuid not null references account_export.jobs(id) on delete cascade,
  part_number integer not null check (part_number >= 0),
  content text not null check (octet_length(content) between 1 and 262144),
  primary key (job_id, part_number)
);
alter table account_export.jobs enable row level security;
alter table account_export.parts enable row level security;
revoke all on account_export.jobs, account_export.parts from public, anon, authenticated, service_role;

-- A single cursor statement captures account metadata, profile and retained
-- collections together. Use the existing export's field allowlists, never r.*.
create function account_export.archive_rows(p_owner uuid)
returns table (collection text, record_key uuid, payload jsonb)
language sql stable security invoker set search_path = '' as $$
  select 'account', u.id, jsonb_build_object('id',u.id,'email',u.email,'created_at',u.created_at)
    from auth.users u where u.id = p_owner
  union all
  select 'profile', item.id, to_jsonb(item)
    from (select id, email, full_name, username, avatar_url, banner_url, bio,
            headline, location, interests, account_type, profile_visibility,
            degree_program, graduation_year, institution, workplace, school, created_at, updated_at
          from public.profiles where id = p_owner) item
  union all
  select 'posts', item.id, to_jsonb(item)
    from (select r.id, r.user_id, r.body, r.content, r.image_url, r.media_url, r.created_at, r.updated_at, r.scope, r.account_type, r.channel, r.quoted_post_id, r.thread_parent_id, r.article_title, r.read_minutes
      from public.posts r where r.user_id = p_owner) item
  union all
  select 'post_media', item.id, to_jsonb(item)
    from (select r.id, r.post_id, r.url, r.media_type, r.sort_order, r.created_at, r.width, r.height, r.alt_text, r.is_sensitive
      from public.post_media r where exists (select 1 from public.posts owner_post where owner_post.id = r.post_id and owner_post.user_id = p_owner)) item
  union all
  select 'comments', item.id, to_jsonb(item)
    from (select r.id, r.post_id, r.user_id, r.body, r.content, r.parent_comment_id, r.created_at
      from public.post_comments r where r.user_id = p_owner) item
  union all
  select 'likes', item.id, to_jsonb(item)
    from (select r.id, r.post_id, r.created_at
      from public.post_likes r where r.user_id = p_owner) item
  union all
  select 'saved', item.id, to_jsonb(item)
    from (select r.id, r.post_id, r.created_at, r.collection_id
      from public.post_bookmarks r where r.user_id = p_owner) item
  union all
  select 'reposts', item.id, to_jsonb(item)
    from (select r.id, r.post_id, r.created_at
      from public.post_reposts r where r.user_id = p_owner) item
  union all
  select 'following', item.id, to_jsonb(item)
    from (select r.id, r.following_id, r.created_at
      from public.follows r where r.follower_id = p_owner) item
  union all
  select 'followers', item.id, to_jsonb(item)
    from (select r.id, r.follower_id, r.created_at
      from public.follows r where r.following_id = p_owner) item
  union all
  select 'stories', item.id, to_jsonb(item)
    from (select r.id, r.user_id, r.media_url, r.media_type, r.thumbnail_url, r.duration_sec, r.caption, r.expires_at, r.created_at, r.stickers_json, r.text_background, r.media_transform, r.category, r.dual_front_url, r.dual_layout, r.allow_replies, r.allow_reactions, r.allow_sharing, r.audience, r.reach
      from public.stories r where r.user_id = p_owner) item
  union all
  select 'story_views_given', item.story_id, to_jsonb(item)
    from (select r.story_id, r.viewed_at
      from public.story_views r where r.user_id = p_owner) item
  union all
  select 'messages_sent', item.id, to_jsonb(item)
    from (select r.id, r.conversation_id, r.text, r.media_url, r.created_at
      from public.messages r where r.sender_id = p_owner) item
  union all
  select 'listings', item.id, to_jsonb(item)
    from (select r.id, r.seller_id, r.title, r.description, r.price, r.currency, r.category, r.condition, r.location_city, r.images, r.status, r.created_at, r.updated_at, r.delivery_available, r.delivery_fee, r.delivery_note
      from public.marketplace_listings r where r.seller_id = p_owner) item
  union all
  select 'job_applications', item.id, to_jsonb(item)
    from (select r.id, r.job_id, r.applicant_id, r.status, r.cover_note, r.cover_letter, r.applied_at, r.updated_at, r.interview_at, r.interview_location
      from public.job_applications r where r.applicant_id = p_owner) item
  union all
  select 'support_tickets', item.id, to_jsonb(item)
    from (select r.id, r.user_id, r.subject, r.message, r.body, r.kind, r.status, r.created_at, r.updated_at, r.resolution_note, r.resolved_at
      from public.support_tickets r where r.user_id = p_owner) item
  union all
  select 'blocked', item.blocked_id, to_jsonb(item)
    from (select r.blocked_id, r.created_at
      from public.blocked_users r where r.blocker_id = p_owner) item
  union all
  select 'push_devices', item.id, to_jsonb(item)
    from (select r.id, r.device_name, r.platform, r.created_at
      from public.user_push_tokens r where r.user_id = p_owner) item
$$;

create function account_export.request_archive()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  result uuid;
begin
  if caller is null or not exists (select from auth.users where id = caller) then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  delete from account_export.jobs where owner_id = caller and expires_at <= now();
  insert into account_export.jobs(owner_id) values (caller)
    on conflict (owner_id) do nothing;
  select id into strict result from account_export.jobs where owner_id = caller;
  return result;
end;
$$;

-- Atomically publish all parts once. A concurrent worker skips the reserved job.
-- The cursor can spill to disk. The concatenation buffer holds at most 64 Ki
-- Unicode characters (256 KiB UTF-8), even if a single record spans parts.
create function account_export.work_one()
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  job account_export.jobs;
  item record;
  line text;
  len integer;
  pos integer;
  take_chars integer;
  buf text := '';
  buf_len integer := 0;
  n integer := 0;
  bytes bigint := 0;
  snapshot_time timestamptz;
  counts jsonb := '{"posts":0,"post_media":0,"comments":0,"likes":0,"saved":0,"reposts":0,"following":0,"followers":0,"stories":0,"story_views_given":0,"messages_sent":0,"listings":0,"job_applications":0,"support_tickets":0,"blocked":0,"push_devices":0}';
begin
  delete from account_export.jobs where id in (
    select id from account_export.jobs where expires_at <= now()
    order by expires_at limit 10 for update skip locked
  );
  select * into job from account_export.jobs
    where state = 'queued' and expires_at > now()
    order by requested_at, id limit 1 for update skip locked;
  if not found then return false; end if;
  begin
    for item in
      select a.*, statement_timestamp() as snapshot_at
      from account_export.archive_rows(job.owner_id) a order by collection collate "C", record_key
    loop
      snapshot_time := item.snapshot_at;
      if counts ? item.collection then
        counts := jsonb_set(counts, array[item.collection], to_jsonb((counts->>item.collection)::bigint + 1));
      end if;
      line := jsonb_build_object('collection',item.collection,'record',item.payload)::text || chr(10);
      len := char_length(line);
      pos := 1;
      while pos <= len loop
        take_chars := least(65536 - buf_len, len - pos + 1);
        buf := buf || substr(line, pos, take_chars);
        pos := pos + take_chars;
        buf_len := buf_len + take_chars;
        if buf_len = 65536 then
          insert into account_export.parts values (job.id, n, buf);
          bytes := bytes + octet_length(buf);
          n := n + 1;
          buf := '';
          buf_len := 0;
        end if;
      end loop;
    end loop;
    if buf_len > 0 then
      insert into account_export.parts values (job.id, n, buf);
      bytes := bytes + octet_length(buf);
      n := n + 1;
    end if;
    if n = 0 then raise exception 'EMPTY_ARCHIVE'; end if;
    update account_export.jobs set state = 'ready', snapshot_at = snapshot_time,
      part_count = n, byte_count = bytes, collection_counts = counts,
      expires_at = clock_timestamp() + interval '24 hours' where id = job.id;
  exception when others or query_canceled then
    -- This subtransaction rolls back every part before marking the job failed.
    -- Only an SQLSTATE goes into the server log, never exported content.
    raise log 'account export worker failure, SQLSTATE %', sqlstate;
    update account_export.jobs set state = 'failed', expires_at = now() + interval '5 minutes' where id = job.id;
  end;
  return true;
end;
$$;

-- A null part reads just the manifest. Every part can be fetched again by
-- number after an interrupted transfer. No public object or signed URL exists.
create function account_export.read_archive(p_job uuid, p_part integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  job account_export.jobs;
  caller uuid := auth.uid();
  part_content text;
begin
  if caller is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into job from account_export.jobs
    where id = p_job and owner_id = caller and expires_at > statement_timestamp();
  if not found then raise exception 'ARCHIVE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_part is null then
    return jsonb_build_object('id',job.id,'owner_id',caller,'status',job.state,
      'format','jsonl-v1','expires_at',job.expires_at,'snapshot_at',job.snapshot_at,
      'part_count',job.part_count,'byte_count',job.byte_count,'collection_counts',job.collection_counts,
      'next_part',case when job.state='ready' then 0 end);
  end if;
  if job.state <> 'ready' or p_part < 0 or p_part >= job.part_count then
    raise exception 'PART_UNAVAILABLE' using errcode = '22023';
  end if;
  select content into strict part_content from account_export.parts where job_id = p_job and part_number = p_part;
  return jsonb_build_object('id',job.id,'owner_id',caller,'part_number',p_part,'content',part_content,
    'next_part',case when p_part+1 < job.part_count then p_part+1 end);
end;
$$;

create function public.request_account_archive()
returns uuid language sql security invoker set search_path = '' as $$ select account_export.request_archive() $$;
create function public.read_account_archive(p_job uuid, p_part integer default null)
returns jsonb language sql stable security invoker set search_path = '' as $$ select account_export.read_archive(p_job, p_part) $$;

revoke all on function account_export.archive_rows(uuid), account_export.work_one(),
  account_export.request_archive(), account_export.read_archive(uuid,integer),
  public.request_account_archive(), public.read_account_archive(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function account_export.request_archive(), account_export.read_archive(uuid,integer),
  public.request_account_archive(), public.read_account_archive(uuid,integer) to authenticated;

-- Fail installation if the required scheduler is unavailable.
select cron.schedule('platinum-account-export', '* * * * *',
  'set statement_timeout = ''4min''; select account_export.work_one();');
notify pgrst, 'reload schema';
commit;
