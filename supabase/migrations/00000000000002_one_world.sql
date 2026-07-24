-- 0002_one_world.sql
-- Platinum Circles is one network. profiles.account_type stays as a pure
-- identity label (personal | business) and stops acting as a visibility
-- partition. Before this, a business account could not see likes or
-- comments on personal accounts posts, and vice versa.
-- Idempotent: every policy is dropped by both old and new name first.

-- post_likes
drop policy if exists "post_likes_select_authenticated" on public.post_likes;
drop policy if exists "post_likes_select_via_post" on public.post_likes;
create policy post_likes_select_authenticated on public.post_likes
  for select to authenticated using (true);

-- post_comments
drop policy if exists "post_comments_select_authenticated" on public.post_comments;
drop policy if exists "comments_select_via_post" on public.post_comments;
create policy post_comments_select_authenticated on public.post_comments
  for select to authenticated using (true);

-- comment_likes
drop policy if exists "comment_likes_select_authenticated" on public.comment_likes;
drop policy if exists "comment_likes_select_same_world" on public.comment_likes;
create policy comment_likes_select_authenticated on public.comment_likes
  for select to authenticated using (true);

-- notifications: yours are yours, regardless of who acted
drop policy if exists "notifications_select_own" on public.notifications;
drop policy if exists "notifications_select_same_world" on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_id = auth.uid());