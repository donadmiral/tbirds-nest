-- 0077 retire the school-era function layer. 0076 dropped the tables; this
-- unbreaks everything that still referenced them.

-- 1. The autofill triggers read profile_institutions on EVERY story/post/job
--    insert. Drop them and their functions first.
do $$
declare r record;
begin
  for r in
    select t.tgname, c.relname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal
      and p.proname in ('autofill_story_institution', 'autofill_institution_from_primary')
  loop
    execute format('drop trigger %I on public.%I', r.tgname, r.relname);
    raise notice 'dropped trigger % on %', r.tgname, r.relname;
  end loop;
end $$;
drop function if exists public.autofill_story_institution();
drop function if exists public.autofill_institution_from_primary();

-- 2. Policy-bound visibility functions, signatures preserved, one-world rules.
create or replace function public.viewer_can_see_story(p_story_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.stories s
    where s.id = p_story_id
      and s.expires_at > now()
      and (
        s.user_id = auth.uid()
        or (
          auth.uid() is not null
          and (
            coalesce(s.audience, 'everyone') = 'everyone'
            or (s.audience = 'followers' and exists (
              select 1 from public.follows f
              where f.following_id = s.user_id and f.follower_id = auth.uid()))
            or (s.audience = 'close_friends' and exists (
              select 1 from public.close_friends cf
              where cf.owner_id = s.user_id and cf.friend_id = auth.uid()))
            or (s.audience = 'only_with' and exists (
              select 1 from public.story_shared_with sw
              where sw.story_id = s.id and sw.user_id = auth.uid()))
            or (s.audience = 'except' and not exists (
              select 1 from public.story_hidden_from hf
              where hf.story_id = s.id and hf.user_id = auth.uid()))
          )
        )
      )
  );
$fn$;

create or replace function public.can_view_story(p_story_id uuid)
returns boolean language sql stable
as $fn$ select public.viewer_can_see_story(p_story_id); $fn$;

create or replace function public.viewer_can_see_post(p_post_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $fn$ select public.can_view_post(p_post_id); $fn$;

create or replace function public.viewer_can_see_job(p_job_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job_id
      and not exists (
        select 1 from public.blocked_users b
        where (b.blocker_id = auth.uid() and b.blocked_id = j.posted_by)
           or (b.blocker_id = j.posted_by and b.blocked_id = auth.uid())
      )
  );
$fn$;

-- 3. get_catchup_feed: scope/institution/affiliation machinery removed,
--    audience + muting kept, signature unchanged (p_mode is now inert).
create or replace function public.get_catchup_feed(p_mode text default 'all', p_limit integer default 30)
returns table(user_id uuid, full_name text, username text, avatar_url text, story_count integer, unseen_count integer, latest_story_at timestamptz, latest_story_id uuid, has_unseen boolean)
language sql stable security definer set search_path to 'public'
as $fn$
  with visible_stories as (
    select s.* from public.stories s
    where s.expires_at > now()
      and not exists (
        select 1 from public.muted_stories m
        where m.user_id = auth.uid() and m.muted_id = s.user_id)
      and (
        s.user_id = auth.uid()
        or (
          auth.uid() is not null
          and (
            coalesce(s.audience, 'everyone') = 'everyone'
            or (s.audience = 'followers' and exists (
              select 1 from public.follows f where f.following_id = s.user_id and f.follower_id = auth.uid()))
            or (s.audience = 'close_friends' and exists (
              select 1 from public.close_friends cf where cf.owner_id = s.user_id and cf.friend_id = auth.uid()))
            or (s.audience = 'only_with' and exists (
              select 1 from public.story_shared_with sw where sw.story_id = s.id and sw.user_id = auth.uid()))
            or (s.audience = 'except' and not exists (
              select 1 from public.story_hidden_from hf where hf.story_id = s.id and hf.user_id = auth.uid()))
          )
        )
      )
  ),
  grouped as (
    select vs.user_id, count(*)::int as story_count,
      count(*) filter (where not exists (
        select 1 from public.story_views sv where sv.story_id = vs.id and sv.user_id = auth.uid()))::int as unseen_count,
      max(vs.created_at) as latest_story_at,
      (array_agg(vs.id order by vs.created_at desc))[1] as latest_story_id
    from visible_stories vs group by vs.user_id
  )
  select g.user_id, p.full_name, p.username, p.avatar_url, g.story_count, g.unseen_count,
         g.latest_story_at, g.latest_story_id, g.unseen_count > 0 as has_unseen
  from grouped g join public.profiles p on p.id = g.user_id
  order by (g.unseen_count > 0) desc, g.latest_story_at desc
  limit greatest(1, least(p_limit, 100));
$fn$;

-- 4. get_message_requests: institution name slot kept in the signature,
--    always null now.
create or replace function public.get_message_requests()
returns table(conversation_id uuid, sender_id uuid, sender_name text, sender_username text, sender_avatar_url text, sender_institution_name text, requested_at timestamptz, last_message_preview text, last_message_time timestamptz, unread_count integer)
language sql stable security definer set search_path to 'public'
as $fn$
  with my_pending as (
    select c.*
    from public.conversations c
    where c.is_group = false
      and c.request_status = 'pending'
      and c.request_sender_id is not null
      and c.request_sender_id <> auth.uid()
      and (c.user_1 = auth.uid() or c.user_2 = auth.uid())
  )
  select
    mp.id as conversation_id,
    mp.request_sender_id as sender_id,
    p.full_name as sender_name,
    p.username as sender_username,
    p.avatar_url as sender_avatar_url,
    null::text as sender_institution_name,
    mp.requested_at,
    mp.last_message as last_message_preview,
    mp.last_message_time,
    (
      select count(*)::int
      from public.messages m
      where m.conversation_id = mp.id
        and m.sender_id = mp.request_sender_id
        and not exists (
          select 1 from public.message_reads mr
          where mr.message_id = m.id and mr.user_id = auth.uid()
        )
    ) as unread_count
  from my_pending mp
  join public.profiles p on p.id = mp.request_sender_id
  order by mp.requested_at desc nulls last;
$fn$;

-- 5. delete_user_account: dropped-table deletes removed, everything else as it was.
create or replace function public.delete_user_account(p_user_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $fn$
begin
  delete from message_deletions where user_id = p_user_id;
  delete from saved_messages where user_id = p_user_id;
  delete from starred_messages where starred_by = p_user_id;
  delete from message_reactions where user_id = p_user_id;
  delete from message_reads where user_id = p_user_id;
  delete from messages where sender_id = p_user_id;
  delete from conversation_typing where user_id = p_user_id;
  delete from conversation_settings where user_id = p_user_id;
  delete from conversation_members where user_id = p_user_id;
  delete from chat_payments where sender_id = p_user_id or recipient_id = p_user_id;
  delete from call_participants where user_id = p_user_id;
  delete from story_views where user_id = p_user_id;
  delete from story_reactions where user_id = p_user_id;
  delete from stories where user_id = p_user_id;
  delete from post_seen where user_id = p_user_id;
  delete from post_bookmarks where user_id = p_user_id;
  delete from post_reposts where user_id = p_user_id;
  delete from post_likes where user_id = p_user_id;
  delete from comment_reactions where user_id = p_user_id;
  delete from post_comments where user_id = p_user_id;
  delete from post_products where post_id in (select id from posts where user_id = p_user_id);
  delete from posts where user_id = p_user_id;
  delete from marketplace_listings where seller_id = p_user_id;
  delete from saved_listings where user_id = p_user_id;
  delete from seller_reviews where seller_id = p_user_id or reviewer_id = p_user_id;
  delete from job_saves where user_id = p_user_id;
  delete from follows where follower_id = p_user_id or following_id = p_user_id;
  delete from follow_requests where requester_id = p_user_id or target_id = p_user_id;
  delete from close_friends where owner_id = p_user_id or friend_id = p_user_id;
  delete from blocked_users where blocker_id = p_user_id or blocked_id = p_user_id;
  delete from user_reports where reporter_id = p_user_id or reported_id = p_user_id;
  delete from notifications where recipient_id = p_user_id;
  delete from club_members where user_id = p_user_id;
  delete from community_members where user_id = p_user_id;
  delete from business_members where member_id = p_user_id or business_id = p_user_id;
  delete from business_reviews where user_id = p_user_id;
  delete from business_posts where owner_id = p_user_id;
  delete from business_profiles where owner_id = p_user_id or profile_id = p_user_id;
  delete from support_tickets where user_id = p_user_id;
  delete from user_app_settings where user_id = p_user_id;
  delete from user_presence where user_id = p_user_id;
  delete from user_push_tokens where user_id = p_user_id;
  delete from profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$fn$;

-- 6. Pure orphans: no trigger, no policy, no app caller. Every overload drops.
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'accept_mentorship_request','approve_join_request','broadcast_moment_notification',
      'bump_affiliation_member_count','claim_institution','create_affiliation_conversation',
      'decline_join_request','get_affiliation_members','get_meeting_by_room','get_mentor_profile',
      'get_pending_join_requests','get_profile_affiliations','get_profile_institutions',
      'get_scoped_feed','get_scoped_jobs','get_scoped_mingle','get_todays_moment',
      'get_user_primary_institution','is_affiliation_admin','is_affiliation_member',
      'join_affiliation','kick_affiliation_member','leave_affiliation','list_mentors',
      'match_email_to_institution','request_mentorship','request_to_join_affiliation',
      'set_affiliation_join_mode','set_affiliation_member_role','set_affiliation_post_mode',
      'set_primary_institution','start_dm','update_connections_count','users_share_institution',
      'viewer_can_see_event','viewer_can_see_institution','viewer_can_see_mingle',
      'viewer_can_see_profile','viewer_shares_institution_with')
  loop
    execute format('drop function public.%I(%s)', r.proname, r.args);
  end loop;
  raise notice 'orphan functions dropped';
end $$;

-- 7. Final check: nothing in public should mention the retired schema now.
do $$
declare r record; found boolean := false;
begin
  for r in
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.prosrc ilike '%mingle_%' or p.prosrc ilike '%affiliation%'
        or p.prosrc ilike '%profile_institutions%' or p.prosrc ilike '%identity_training%'
        or p.prosrc ilike '%from connections%' or p.prosrc ilike '%public.connections%')
  loop
    found := true;
    raise notice 'STILL MENTIONS RETIRED SCHEMA: %', r.proname;
  end loop;
  if not found then raise notice 'Clean: retired schema fully gone from functions.'; end if;
end $$;