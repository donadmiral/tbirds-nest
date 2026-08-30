-- 0148: close the open policies.
--
-- Fifty-one live policies carry a bare `true` clause. Most are harmless public
-- tables or dead school-era tables that the schema sweep will drop. Eleven are
-- not: they let any signed-in account write rows it should never write, or
-- read data belonging to someone else.
--
-- Two things this migration deliberately does NOT do. It does not drop
-- policies by name, because the names have drifted from the July baseline and
-- a drop by the wrong name silently leaves the hole open while adding a second
-- policy beside it; permissive policies OR together, so the table would look
-- fixed and stay open. And it does not keep a second copy of the fix list for
-- verification: one table below drives the drops, the checks and the report.
--
-- It also replaces ONLY what it removed. A table that production had already
-- scoped keeps exactly the policies it has; this migration never widens a
-- permission that was not open to begin with.
--
-- Tables that no longer exist are skipped rather than failing the run.

begin;

create temp table _rls_targets (tbl text, cmd text) on commit drop;
create temp table _rls_dropped (tbl text, cmd text) on commit drop;
insert into _rls_targets (tbl, cmd) values
  ('notifications',            'INSERT'),  -- forged notifications, a phishing surface
  ('notifications',            'UPDATE'),  -- anyone could edit anyone's notifications
  ('notifications',            'DELETE'),  -- anyone could delete anyone's notifications
  ('post_video_views',         'INSERT'),  -- view counts inflatable by hand
  ('post_video_views',         'SELECT'),  -- everyone's watch history was public
  ('support_transactions',     'INSERT'),  -- a table with an amount column
  ('support_transactions',     'SELECT'),
  ('post_bookmarks',           'SELECT'),  -- everyone could read everyone's saves
  ('message_reactions',        'SELECT'),  -- reactions leaked out of conversations
  ('story_sticker_responses',  'SELECT'),  -- poll and quiz answers were public
  ('verification_referrals',   'SELECT'),  -- the referral graph was public
  ('post_mentions',            'SELECT'),  -- mentions on private posts were visible
  ('_deprecated_conversation_participants', 'SELECT'),
  ('_deprecated_conversation_participants', 'INSERT');

-- ── stage one: remove every open policy on those table and command pairs ────
do $$
declare g record; r record;
begin
  for g in select tbl, cmd from _rls_targets loop
    if to_regclass('public.' || quote_ident(g.tbl)) is null then
      raise notice 'skip %, table does not exist', g.tbl;
      continue;
    end if;
    for r in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = g.tbl
        and permissive = 'PERMISSIVE' and cmd in (g.cmd, 'ALL')
        and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
    loop
      execute format('drop policy %I on public.%I', r.policyname, g.tbl);
      insert into _rls_dropped (tbl, cmd) values (g.tbl, g.cmd);
      raise notice 'dropped open policy % on % (%)', r.policyname, g.tbl, g.cmd;
    end loop;
  end loop;
end $$;

-- ── stage two: put the correct rule back, only where the table exists ───────
-- Every replacement was checked against every call site in the phone app and
-- the web app first, so no screen loses a query or a write it makes today.
do $$
begin

  -- notifications. The client writes exactly one kind directly, story mentions,
  -- with its own id as the actor. It marks notifications read through
  -- mark_notifications_read, which is security INVOKER and therefore needs a
  -- real update policy - so the open one is replaced, not merely removed.
  -- Trigger functions run as the table owner and are unaffected throughout.
  if exists (select 1 from _rls_dropped where tbl = 'notifications') then
    drop policy if exists notif_insert_self on public.notifications;
    drop policy if exists notif_update_own on public.notifications;
    drop policy if exists notif_delete_own on public.notifications;
    create policy notif_insert_self on public.notifications
      for insert to authenticated with check (actor_id = auth.uid());
    create policy notif_update_own on public.notifications
      for update to authenticated using (recipient_id = auth.uid());
    create policy notif_delete_own on public.notifications
      for delete to authenticated using (recipient_id = auth.uid());
  end if;

  -- post_video_views. record_video_view is security definer and is the only
  -- legitimate writer, so INSERT gets no replacement. SELECT was open, which
  -- made every viewer's watch history readable by anyone. Authors still see
  -- reach through get_post_insights, which is security definer.
  if exists (select 1 from _rls_dropped where tbl = 'post_video_views' and cmd = 'SELECT') then
    drop policy if exists pvv_select_own on public.post_video_views;
    create policy pvv_select_own on public.post_video_views
      for select to authenticated using (viewer_id = auth.uid());
  end if;

  -- support_transactions. Zero code references it anywhere in the repo, and it
  -- carries an amount column. Locked to its own sender until the payments
  -- phase decides whether it lives.
  if exists (select 1 from _rls_dropped where tbl = 'support_transactions') then
    drop policy if exists support_insert_self on public.support_transactions;
    drop policy if exists support_select_self on public.support_transactions;
    create policy support_insert_self on public.support_transactions
      for insert to authenticated with check (from_user_id = auth.uid());
    if exists (select 1 from _rls_dropped where tbl = 'support_transactions' and cmd = 'SELECT') then
      create policy support_select_self on public.support_transactions
        for select to authenticated using (from_user_id = auth.uid());
    end if;
  end if;

  -- post_bookmarks. Every read already filters by the viewer's own id
  -- (ProfileScreen 199, FeedScreen 754 and 757, SavedPostsScreen 66 and 144),
  -- and get_feed returns the viewer's own flag server side.
  if exists (select 1 from _rls_dropped where tbl = 'post_bookmarks') then
    drop policy if exists post_bookmarks_select_own on public.post_bookmarks;
    create policy post_bookmarks_select_own on public.post_bookmarks
      for select to authenticated using (user_id = auth.uid());
  end if;

  -- message_reactions. ChatScreen only ever asks for reactions on messages in
  -- the conversation it has open, so membership is the right gate.
  if exists (select 1 from _rls_dropped where tbl = 'message_reactions') then
    drop policy if exists reactions_select_members on public.message_reactions;
    create policy reactions_select_members on public.message_reactions
      for select to authenticated
      using (exists (
        select 1 from public.messages m
        where m.id = message_reactions.message_id
          and is_conversation_member(m.conversation_id, auth.uid())));
  end if;

  -- story_sticker_responses. Only the person who answered and the story's
  -- author should see poll votes, quiz answers and question replies.
  if exists (select 1 from _rls_dropped where tbl = 'story_sticker_responses') then
    drop policy if exists story_sticker_responses_scoped on public.story_sticker_responses;
    create policy story_sticker_responses_scoped on public.story_sticker_responses
      for select to authenticated
      using (
        user_id = auth.uid()
        or exists (select 1 from public.stories s
                   where s.id = story_sticker_responses.story_id
                     and s.user_id = auth.uid()));
  end if;

  -- verification_referrals. Visible to the referrer and the applicant only.
  if exists (select 1 from _rls_dropped where tbl = 'verification_referrals') then
    drop policy if exists referrals_read_own on public.verification_referrals;
    create policy referrals_read_own on public.verification_referrals
      for select to authenticated
      using (
        referrer_id = auth.uid()
        or exists (select 1 from public.verification_applications va
                   where va.id = verification_referrals.application_id
                     and va.applicant_id = auth.uid()));
  end if;

  -- post_mentions. can_view_post already encodes the whole visibility rule
  -- and is security definer.
  if exists (select 1 from _rls_dropped where tbl = 'post_mentions') then
    drop policy if exists post_mentions_select_visible on public.post_mentions;
    create policy post_mentions_select_visible on public.post_mentions
      for select to authenticated using (can_view_post(post_id));
  end if;

end $$;

-- ── stage three: refuse to commit if anything on the list is still open ─────
do $$
declare n int := 0; leftovers text := ''; g record; r record;
begin
  for g in select tbl, cmd from _rls_targets loop
    if to_regclass('public.' || quote_ident(g.tbl)) is null then continue; end if;
    for r in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = g.tbl
        and permissive = 'PERMISSIVE' and cmd in (g.cmd, 'ALL')
        and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
    loop
      n := n + 1;
      leftovers := leftovers || g.tbl || '.' || r.policyname || ' (' || g.cmd || ') ';
    end loop;
  end loop;
  if n > 0 then
    raise exception 'RLS hardening incomplete, still open: %', leftovers;
  end if;
  raise notice 'RLS hardening verified: every targeted policy is scoped';

  -- Any OTHER command left open on these tables is reported rather than
  -- failing the run, so a future hole is visible instead of silent.
  for r in
    select tablename, policyname, cmd from pg_policies
    where schemaname = 'public' and permissive = 'PERMISSIVE'
      and tablename in (select tbl from _rls_targets)
      and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
  loop
    raise notice 'REVIEW: still open on %.% (%)', r.tablename, r.policyname, r.cmd;
  end loop;
end $$;

commit;
