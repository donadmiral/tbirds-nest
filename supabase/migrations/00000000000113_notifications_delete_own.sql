-- 0113 A person may delete their own notifications. The desk issues
-- nothing here; this is purely the member tidying their own feed.

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete to authenticated using (recipient_id = auth.uid());

notify pgrst, 'reload schema';