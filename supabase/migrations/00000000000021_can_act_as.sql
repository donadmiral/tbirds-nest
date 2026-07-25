-- 0021_can_act_as.sql
-- One rule, applied everywhere: a business never signs in, so its team acts for
-- it. Every policy keyed to auth.uid() = owner gets a sibling keyed to
-- can_act_as(owner).
--
-- These policies are ADDITIVE. Permissive policies are OR'd, so a person still
-- passes through their existing policy unchanged and nothing about personal
-- behaviour is altered. Reversible by dropping the *_as_business policies.
--
-- SECURITY DEFINER so it never re-enters RLS on business_members.

create or replace function public.can_act_as(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select auth.uid() is not null
     and (auth.uid() = p_target or is_business_member(p_target));
$fn$;

grant execute on function public.can_act_as(uuid) to authenticated;

-- ── stories ────────────────────────────────────────────────────────────────
drop policy if exists stories_write_as_business on public.stories;
create policy stories_write_as_business on public.stories
  for all to authenticated
  using (can_act_as(user_id)) with check (can_act_as(user_id));

-- ── jobs ───────────────────────────────────────────────────────────────────
drop policy if exists jobs_write_as_business on public.jobs;
create policy jobs_write_as_business on public.jobs
  for all to authenticated
  using (can_act_as(posted_by)) with check (can_act_as(posted_by));

-- ── market listings ────────────────────────────────────────────────────────
drop policy if exists listings_write_as_business on public.marketplace_listings;
create policy listings_write_as_business on public.marketplace_listings
  for all to authenticated
  using (can_act_as(seller_id)) with check (can_act_as(seller_id));

-- ── conversations: a team must be able to read the business inbox ──────────
drop policy if exists conversations_select_as_business on public.conversations;
create policy conversations_select_as_business on public.conversations
  for select to authenticated
  using (
    (user_1 is not null and can_act_as(user_1))
    or (user_2 is not null and can_act_as(user_2))
    or exists (select 1 from conversation_members m
               where m.conversation_id = conversations.id and can_act_as(m.user_id))
  );

drop policy if exists conversations_update_as_business on public.conversations;
create policy conversations_update_as_business on public.conversations
  for update to authenticated
  using (
    (user_1 is not null and can_act_as(user_1))
    or (user_2 is not null and can_act_as(user_2))
  )
  with check (
    (user_1 is not null and can_act_as(user_1))
    or (user_2 is not null and can_act_as(user_2))
  );

-- ── messages: read what the business received, send as the business ────────
drop policy if exists messages_select_as_business on public.messages;
create policy messages_select_as_business on public.messages
  for select to authenticated
  using (exists (
    select 1 from conversations c
    where c.id = messages.conversation_id
      and ((c.user_1 is not null and can_act_as(c.user_1))
        or (c.user_2 is not null and can_act_as(c.user_2))
        or exists (select 1 from conversation_members m
                   where m.conversation_id = c.id and can_act_as(m.user_id)))
  ));

-- The sender must be an actor the caller may use, and that actor must actually
-- be in the conversation. Both halves matter: without the second, a member
-- could post into any conversation as their business.
drop policy if exists messages_insert_as_business on public.messages;
create policy messages_insert_as_business on public.messages
  for insert to authenticated
  with check (
    sender_id is not null
    and can_act_as(sender_id)
    and exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and (c.user_1 = messages.sender_id
          or c.user_2 = messages.sender_id
          or exists (select 1 from conversation_members m
                     where m.conversation_id = c.id and m.user_id = messages.sender_id))
    )
  );

-- ── notifications: a team sees what the business was told ──────────────────
drop policy if exists notifications_select_as_business on public.notifications;
create policy notifications_select_as_business on public.notifications
  for select to authenticated
  using (can_act_as(recipient_id));

drop policy if exists notifications_update_as_business on public.notifications;
create policy notifications_update_as_business on public.notifications
  for update to authenticated
  using (can_act_as(recipient_id)) with check (can_act_as(recipient_id));

-- ── follows: a business can follow and be unfollowed by its team ───────────
drop policy if exists follows_write_as_business on public.follows;
create policy follows_write_as_business on public.follows
  for all to authenticated
  using (can_act_as(follower_id)) with check (can_act_as(follower_id));

-- ── engagement as the business ─────────────────────────────────────────────
drop policy if exists post_comments_write_as_business on public.post_comments;
create policy post_comments_write_as_business on public.post_comments
  for all to authenticated
  using (can_act_as(user_id)) with check (can_act_as(user_id));

drop policy if exists post_likes_write_as_business on public.post_likes;
create policy post_likes_write_as_business on public.post_likes
  for all to authenticated
  using (can_act_as(user_id)) with check (can_act_as(user_id));

drop policy if exists post_reposts_write_as_business on public.post_reposts;
create policy post_reposts_write_as_business on public.post_reposts
  for all to authenticated
  using (can_act_as(user_id)) with check (can_act_as(user_id));

drop policy if exists post_bookmarks_write_as_business on public.post_bookmarks;
create policy post_bookmarks_write_as_business on public.post_bookmarks
  for all to authenticated
  using (can_act_as(user_id)) with check (can_act_as(user_id));

drop policy if exists comment_reactions_write_as_business on public.comment_reactions;
create policy comment_reactions_write_as_business on public.comment_reactions
  for all to authenticated
  using (can_act_as(user_id)) with check (can_act_as(user_id));

-- ── story_views and story_reactions, so a business can watch and react ────
drop policy if exists story_views_write_as_business on public.story_views;
create policy story_views_write_as_business on public.story_views
  for all to authenticated
  using (can_act_as(user_id)) with check (can_act_as(user_id));

drop policy if exists story_reactions_write_as_business on public.story_reactions;
create policy story_reactions_write_as_business on public.story_reactions
  for all to authenticated
  using (can_act_as(user_id)) with check (can_act_as(user_id));