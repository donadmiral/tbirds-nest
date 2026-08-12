-- 0120: delete_user_account was SECURITY DEFINER with no caller check and
-- default PUBLIC execute, so any authenticated user could delete any account
-- by uuid. Guard added, anon revoked. Body otherwise identical to 0077.
create or replace function public.delete_user_account(p_user_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $fn$
begin
  if p_user_id is distinct from auth.uid()
     and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'You can only delete your own account';
  end if;
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
revoke all on function public.delete_user_account(uuid) from public, anon;
grant execute on function public.delete_user_account(uuid) to authenticated, service_role;