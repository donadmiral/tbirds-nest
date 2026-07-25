-- 0033_fix_account_deletion.sql
-- delete_user_account still referenced two objects our own migrations changed:
-- comment_likes (renamed to comment_reactions in 0007, its compatibility view
-- dropped in 0014) and birds_business_posts (dropped in 0013). Account deletion
-- has been throwing since then.
--
-- Also adds the tables built since it was last written, so deleting an account
-- does not leave orphans behind.

create or replace function public.delete_user_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
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
  delete from meeting_participants where user_id = p_user_id;
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
  delete from mingle_post_attendees where user_id = p_user_id;
  delete from mingle_post_shares where user_id = p_user_id;
  delete from mingle_post_updates where user_id = p_user_id;
  delete from mingle_comments where user_id = p_user_id;
  delete from event_attendees where user_id = p_user_id;
  delete from events where created_by = p_user_id;
  delete from job_saves where user_id = p_user_id;
  delete from connection_requests where sender_id = p_user_id;
  delete from connections where requester_id = p_user_id or recipient_id = p_user_id;
  delete from follows where follower_id = p_user_id or following_id = p_user_id;
  delete from follow_requests where requester_id = p_user_id or target_id = p_user_id;
  delete from close_friends where owner_id = p_user_id or friend_id = p_user_id;
  delete from blocked_users where blocker_id = p_user_id or blocked_id = p_user_id;
  delete from user_reports where reporter_id = p_user_id or reported_id = p_user_id;
  delete from notifications where recipient_id = p_user_id;
  delete from affiliation_join_requests where user_id = p_user_id;
  delete from club_members where user_id = p_user_id;
  delete from community_members where user_id = p_user_id;
  delete from founder_profiles where user_id = p_user_id;
  delete from investor_profiles where user_id = p_user_id;
  delete from business_members where member_id = p_user_id or business_id = p_user_id;
  delete from business_reviews where user_id = p_user_id;
  delete from business_posts where owner_id = p_user_id;
  delete from business_profiles where owner_id = p_user_id or profile_id = p_user_id;
  delete from mentorship_goals where created_by = p_user_id;
  delete from mentorship_meetings where created_by = p_user_id;
  delete from support_tickets where user_id = p_user_id;
  delete from user_app_settings where user_id = p_user_id;
  delete from user_presence where user_id = p_user_id;
  delete from user_push_tokens where user_id = p_user_id;
  delete from participants where user_id = p_user_id;
  delete from _deprecated_conversation_participants where user_id = p_user_id;
  delete from profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$fn$;