-- 0149: engagement and presence follow the post and profile they belong to.
--
-- 0148 closed the tables whose contents were nobody else's business. This one
-- closes the larger leak: likes, comments, comment reactions, reposts, shares,
-- media and product cards were all world readable, so the engagement on a
-- private account's post, or on a post by someone who blocked you, could be
-- read directly even though the post itself could not. Follower lists and
-- online status had the same shape.
--
-- The rule is not new. can_view_post already encodes the whole post visibility
-- rule (own post, blocks, private accounts, audience) and is security definer.
-- This migration introduces its profile twin and points the engagement tables
-- at both, so visibility is decided in exactly two places instead of nine.
--
-- Read paths that go through get_feed, get_profile, get_post_insights and the
-- other security definer RPCs are unaffected: definer functions bypass RLS, so
-- feeds, counts and insights keep working exactly as they do now. Only direct
-- client reads of these tables are narrowed, and only to rows the reader was
-- never meant to see.

begin;

-- ── the profile twin of can_view_post ───────────────────────────────────────
-- Security definer so a policy on follows can ask about follows without
-- recursing into its own policy.
create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.id = auth.uid() then true
      when exists (
        select 1 from blocked_users b
        where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
           or (b.blocker_id = p.id and b.blocked_id = auth.uid())
      ) then false
      when p.profile_visibility = 'private' then exists (
        select 1 from follows f
        where f.follower_id = auth.uid() and f.following_id = p.id
      )
      else true
    end
    from profiles p
    where p.id = p_profile_id
  ), false);
$$;

comment on function public.can_view_profile(uuid) is
  'Can the caller see this profile''s content: own profile, not blocked either way, and public or already followed if private.';

grant execute on function public.can_view_profile(uuid) to authenticated;

-- ── stage one: drop the open reads on the engagement tables ─────────────────
create temp table _v_targets (tbl text, cmd text) on commit drop;
create temp table _v_dropped (tbl text, cmd text) on commit drop;
insert into _v_targets (tbl, cmd) values
  ('post_likes',       'SELECT'),
  ('post_comments',    'SELECT'),
  ('comment_reactions','SELECT'),
  ('post_reposts',     'SELECT'),
  ('post_shares',      'SELECT'),
  ('post_media',       'SELECT'),
  ('post_products',    'SELECT'),
  ('follows',          'SELECT'),
  ('user_presence',    'SELECT');

do $$
declare g record; r record;
begin
  for g in select tbl, cmd from _v_targets loop
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
      insert into _v_dropped (tbl, cmd) values (g.tbl, g.cmd);
      raise notice 'dropped open policy % on % (SELECT)', r.policyname, g.tbl;
    end loop;
  end loop;
end $$;

-- ── stage two: replace only what was removed ────────────────────────────────
do $$
begin

  -- Likes, reposts and media hang directly off a post.
  if exists (select 1 from _v_dropped where tbl = 'post_likes') then
    drop policy if exists post_likes_select_visible on public.post_likes;
    create policy post_likes_select_visible on public.post_likes
      for select to authenticated using (can_view_post(post_id));
  end if;

  if exists (select 1 from _v_dropped where tbl = 'post_comments') then
    drop policy if exists post_comments_select_visible on public.post_comments;
    create policy post_comments_select_visible on public.post_comments
      for select to authenticated using (can_view_post(post_id));
  end if;

  if exists (select 1 from _v_dropped where tbl = 'post_reposts') then
    drop policy if exists post_reposts_select_visible on public.post_reposts;
    create policy post_reposts_select_visible on public.post_reposts
      for select to authenticated using (can_view_post(post_id));
  end if;

  if exists (select 1 from _v_dropped where tbl = 'post_media') then
    drop policy if exists post_media_select_visible on public.post_media;
    create policy post_media_select_visible on public.post_media
      for select to authenticated using (can_view_post(post_id));
  end if;

  if exists (select 1 from _v_dropped where tbl = 'post_products') then
    drop policy if exists post_products_select_visible on public.post_products;
    create policy post_products_select_visible on public.post_products
      for select to authenticated using (can_view_post(post_id));
  end if;

  -- Shares name the post they came from with a different column.
  if exists (select 1 from _v_dropped where tbl = 'post_shares') then
    drop policy if exists post_shares_select_visible on public.post_shares;
    create policy post_shares_select_visible on public.post_shares
      for select to authenticated
      using (shared_by = auth.uid() or can_view_post(original_post_id));
  end if;

  -- Comment reactions hang off a comment, which hangs off a post.
  if exists (select 1 from _v_dropped where tbl = 'comment_reactions') then
    drop policy if exists comment_reactions_select_visible on public.comment_reactions;
    create policy comment_reactions_select_visible on public.comment_reactions
      for select to authenticated
      using (
        user_id = auth.uid()
        or exists (
          select 1 from public.post_comments pc
          where pc.id = comment_reactions.comment_id
            and can_view_post(pc.post_id)
        )
      );
  end if;

  -- Follower lists. Your own edges are always visible to you, which is what
  -- every "do I follow this person" check reads. Someone else's graph is
  -- visible when their profile is.
  if exists (select 1 from _v_dropped where tbl = 'follows') then
    drop policy if exists follows_select_visible on public.follows;
    create policy follows_select_visible on public.follows
      for select to authenticated
      using (
        follower_id = auth.uid()
        or following_id = auth.uid()
        or can_view_profile(following_id)
      );
  end if;

  -- Online status. Visible to anyone who can see the profile, which means a
  -- private account is only visibly online to the people it has accepted, and
  -- someone who blocked you can never be seen at all.
  if exists (select 1 from _v_dropped where tbl = 'user_presence') then
    drop policy if exists presence_select_visible on public.user_presence;
    create policy presence_select_visible on public.user_presence
      for select to authenticated
      using (user_id = auth.uid() or can_view_profile(user_id));
  end if;

end $$;

-- ── stage three: refuse to commit if anything on the list is still open ─────
do $$
declare n int := 0; leftovers text := ''; g record; r record;
begin
  for g in select tbl, cmd from _v_targets loop
    if to_regclass('public.' || quote_ident(g.tbl)) is null then continue; end if;
    for r in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = g.tbl
        and permissive = 'PERMISSIVE' and cmd in (g.cmd, 'ALL')
        and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
    loop
      n := n + 1;
      leftovers := leftovers || g.tbl || '.' || r.policyname || ' ';
    end loop;
  end loop;
  if n > 0 then
    raise exception 'visibility sweep incomplete, still open: %', leftovers;
  end if;
  raise notice 'visibility sweep verified: engagement and presence now follow the post and the profile';
end $$;

commit;
