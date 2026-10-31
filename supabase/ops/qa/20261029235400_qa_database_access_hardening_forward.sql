-- QA-only exact catalog delta. Apply after the inspected QA admin/media
-- adapters and account-erasure candidates. Preserves the sound-rights wrapper,
-- entitlement helper, every existing account/session/staff/profile/Storage row,
-- bucket setting and provider configuration. Do not apply to production.
-- Derived from supabase/migrations/20261029234214_database_access_hardening.sql.
-- Reviewed against production metadata on 2026-10-29. This is a forward-only,
-- exact-state migration: changed definitions and all changed ACLs are guarded.
-- ACL-only trigger entries validate owner/type/ACL and never replace the body;
-- provider-specific hook configuration remains byte-for-byte unchanged.
-- It changes no user records, sessions, bucket visibility, provider keys, music
-- rights, or financial data. Runtime behavior is covered by the isolated DB gate.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

do $preflight$
declare r record; f oid; current_acl text;
begin
  if exists (select 1 from pg_namespace n where n.nspname in ('public','extensions')
    and (has_schema_privilege('anon',n.oid,'CREATE') or has_schema_privilege('authenticated',n.oid,'CREATE'))) then
    raise exception 'HARDENING_UNTRUSTED_SCHEMA_CREATE';
  end if;
  for r in select * from jsonb_to_recordset($expected$[{"identity":"public.bump_ad_counters()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.bump_post_views()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.bump_story_views_count()","definition_md5":"84608f0f2ce2bd4d53adef4e3324d3b8","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.business_away_reply()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.can_view_story(uuid)","definition_md5":"866b668833f17c8db05b359044b4b9e8","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.channels_member_count_fn()","definition_md5":"789f7629ee7ff5a6866d51d8d4702367","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.check_email_allowed(text)","definition_md5":"69496470c8bded250ddd8759e69b5781","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.cleanup_expired_stories()","definition_md5":"17c42253617f62c95427940cea91d5aa","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.community_member_joins_chat()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.content_media_document(text,uuid)","definition_md5":"70773b480e9de2bd9857ad42c04146f9","acl":"{postgres=X/postgres,service_role=X/postgres}"},{"identity":"public.content_media_manifest(jsonb)","definition_md5":"47b5dff186018f351aa0e188d1e805d2","acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.email_for_username(text)","definition_md5":"665ac0b8a323a8811ddcd1b50eb62f26","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.enforce_comment_policy()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.fn_notify_message_reaction()","definition_md5":"4d5f9f615a314d693038d8d1eefe0471","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.fn_notify_story_reaction()","definition_md5":"69841a560db0ebf7a6a1cee4a2d7d2b2","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.gen_meeting_room_name()","definition_md5":"8e7975ff75a0c679a5be8e4ed1ba4bd2","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_highlight_stories(uuid)","definition_md5":"3c68e23cb8b99b57065ee92347e1af2c","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_moment_feed(uuid)","definition_md5":"e6e8b519c16440e9fda3933eb49007cd","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_my_account_type()","definition_md5":"38b60b26348b37b7ec0401371a856e4c","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_my_story_reactions(uuid)","definition_md5":"b1327cd5392c3130f04769830e75566b","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_my_verified_status()","definition_md5":"9a11887488e748861d52750d145626fb","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_posts_by_hashtag(text,integer,integer)","definition_md5":"889a16a6b85fe15f424c6ab290a74947","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_profile_reach_28d(uuid)","definition_md5":"4d9b5781bdbe76d33171a3c5f594290d","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_recent_likers(uuid[])","definition_md5":"368093e40e6b8e403f5851934b8f886a","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_startup_interest_counts()","definition_md5":"4f8ecc99e897ca5ea5a033dbbe9686fe","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_story_poll_voters(uuid,uuid)","definition_md5":"4684edb6559c634f53b5c2e40b65a0b7","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_story_poll(uuid)","definition_md5":"6831f46e206febd6faf89d97b0f5ef0e","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_story_reactions(uuid)","definition_md5":"e9a64ee3e5a92c3bcc81ef950475d75c","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_trending_topics(integer,integer)","definition_md5":"59c187cc79f3d47479ec8668cac4dd01","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_unread_counts(uuid)","definition_md5":"bf401f619d3846bcd0c68a4d1c83c9a6","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_user_highlights(uuid)","definition_md5":"7e2ddbcd7102b8391a1f35ec1065832e","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.get_user_stories(uuid)","definition_md5":"04d797733ed5979e0ec7dc53871ee826","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.handle_new_user()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.handle_verified_school_status()","definition_md5":"37938635cabcfd6933af67a5312eb5ce","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.is_email_blocked(text)","definition_md5":"ac5a04b732c8c4c8f614733c8cf93d1a","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.is_verified_school_domain(text)","definition_md5":"bf21fd19a51f03555bb543d416805287","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.jobs_search_tsv_fn()","definition_md5":"80eb496b7495ff222a926c0199766bdb","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.listings_search_tsv_fn()","definition_md5":"66ddcfafc627dc13c500b9363bba5289","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.mark_missed_calls()","definition_md5":"db7bb63368d06211dca63bf9542639bb","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_collab_invite()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_connection_request()","definition_md5":"695d9f1ff74cc114905f0d24b80b3f3e","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_market_alerts()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_member_addition()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_member_departure()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_mentions()","definition_md5":"69020281e08fb2bd35221f6c9ce04ee2","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_mentorship()","definition_md5":"c051281deee1faa15e0fbe02d0c36173","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_missed_call()","definition_md5":"ef88757f1ea780e50acce043d762283a","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_business_member()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_comment_like()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_comment_mention()","definition_md5":"65c925da0147b0b2db2ce34f34f1ac72","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_follow_request_accepted()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_follow_request()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_follow()","definition_md5":"9464116f089e4dd91dcbea04c36d03f4","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_job_application()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_like()","definition_md5":"98b462cca0ab8f72a19e57d42700e405","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_new_message()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_payment()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_post_comment()","definition_md5":"1032d5c5dfec733e431113ba923e62aa","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_post_mention()","definition_md5":"6f9b86b16e0aefc97a24b6f56042f0d4","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_on_repost()","definition_md5":"69d25420b2e4cce25295bfc716f4f99d","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_referral()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_story_poll_vote()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_story_reaction_removed()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_story_reaction()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.notify_story_sticker_response()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.post_campus_moment(uuid,uuid)","definition_md5":"935e9334cb5dd77d846aa3b729620d43","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.posts_search_tsv_fn()","definition_md5":"b30805689418237969016a00413dd7f3","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.profiles_search_tsv_fn()","definition_md5":"c06ad6ecda15130319dc3048d6fdf5e8","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.push_token_reassign()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.rebuild_daily_stats(date)","definition_md5":"a6644cc5186d7ea4ea48d230cf2c5889","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.rebuild_trending_snapshot()","definition_md5":"dc721b4c35fa034158c96b8e95050e7c","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.refresh_user_interests()","definition_md5":"4d9459483833e5fb670e03380610ba2f","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.refuse_blocked_content()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.repair_call_record_resolution()","definition_md5":"f649fa9e15eb67567d225c50e01766ee","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.search_people_page(text,integer,integer,timestamp with time zone)","definition_md5":"271f5e1b33385d4cc93de11103dbdb6f","acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.search_people(text,integer)","definition_md5":"d24d8a35437879b340d242861aba1e23","acl":"{postgres=X/postgres,=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.stamp_conversation_account_type()","definition_md5":"068c1055cde4c17f186db15012b81b87","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.stamp_follow_account_type()","definition_md5":"ce2a32c5375d087cd20c30297724f4f6","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.stamp_notification_account_type()","definition_md5":"0843b3e7b1c3a2514c8ff3efa193998b","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.stamp_post_account_type()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.studio_stage(text)","definition_md5":"d8c191c1f6290ae40240fae7895c5812","acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_application_count()","definition_md5":"6365d0a0316e5a9b12be2ccfc5f1ec58","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_club_to_conversation()","definition_md5":"d00a23c580097b52bc5b568d715901c0","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_comment_reaction_counts()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_community_to_conversation()","definition_md5":"b3afae493a9b6b37f94337ca19ef7c56","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_conversation_preview()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_job_application_count()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_mentee_count()","definition_md5":"8ad53525acfd44aeaa39359ce188e2e7","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_message_mentions()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_post_bookmark_count()","definition_md5":"08c345c671b0f75b9b0e3104b68533f0","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_post_bookmarks_count()","definition_md5":"d6aa0a75908ebacfa8eb7ce92074ea47","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_post_counter_exact()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_post_likes_count_exact()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_post_likes_count()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_post_link()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_post_mentions()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.sync_post_reposts_count()","definition_md5":"50697520307d8556275b0dd44bf62647","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.tg_comment_restrict()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.tg_comment_spam()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.tg_community_member_count()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.tg_listing_report_count()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.tg_message_restrict()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.tg_notification_restrict()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.tg_posts_community_guard()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.tg_posts_community_touch()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.toggle_story_reaction(uuid,text)","definition_md5":"53dc56abd8f2e96e6ed1588a13e09b61","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.trg_notify_incoming_call()","definition_md5":"da3ae1e78b07e703a32f80d8214a2d9e","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.update_business_advert_count()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.update_business_rating()","definition_md5":null,"acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.update_comments_count()","definition_md5":"bf494178474dcf4de346fa338cf84d54","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.update_community_count()","definition_md5":"e84fe5f104e9356f5454e0cba18aca05","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.update_event_count()","definition_md5":"b7a6f5ff7796b5b7019f2e59c6977e5f","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.update_posts_count()","definition_md5":"af95024753adf76ea7d153852a316e9d","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.vote_story_poll(uuid,uuid)","definition_md5":"6f5f653f650a8d0bfd05daf014aa0dd8","acl":"{postgres=X/postgres,=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"identity":"public.content_media_manifest_before_sound_rights(jsonb)","definition_md5":"f7c0ddb248a72b69de192c3d8d75b6c5","acl":"{postgres=X/postgres,service_role=X/postgres}"}]$expected$::jsonb)
      as x(identity text,definition_md5 text,acl text)
  loop
    f := to_regprocedure(r.identity);
    if f is null or (r.definition_md5 is not null and (select md5(pg_get_functiondef(f))) is distinct from r.definition_md5)
      or not exists(select 1 from pg_proc p where p.oid=f and pg_get_userbyid(p.proowner)='postgres'
        and (r.definition_md5 is not null or (p.prorettype='trigger'::regtype and p.prosecdef))) then
      raise exception 'HARDENING_FUNCTION_DRIFT: %',r.identity;
    end if;
    select p.proacl::text into current_acl from pg_proc p where p.oid=f;
    if current_acl is distinct from r.acl then raise exception 'HARDENING_ACL_DRIFT: %',r.identity; end if;
  end loop;
  if to_regprocedure('public.notify_push_notification()') is not null
    or to_regprocedure('public.notify_voip_ring_1to1()') is not null
    or to_regprocedure('public.notify_voip_ring_session()') is not null
    or to_regprocedure('public.notify_voip_ring()') is not null then raise exception 'HARDENING_QA_PROVIDER_HOOK_DRIFT'; end if;
  if to_regprocedure('public.can_view_story_highlight(uuid)') is not null
    or to_regprocedure('public.can_view_story_highlight_item(uuid,uuid)') is not null
    or to_regprocedure('public.owns_story_highlight_item(uuid,uuid)') is not null then
    raise exception 'HARDENING_TARGET_ALREADY_EXISTS';
  end if;
  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    where e.extname='pg_trgm' and e.extversion='1.6' and e.extrelocatable and n.nspname='public')
    or to_regprocedure('extensions.similarity(text,text)') is not null then
    raise exception 'HARDENING_TRGM_DRIFT';
  end if;
  for r in select * from jsonb_to_recordset($tables$[{"schema_name":"public","name":"blocked_email_domains","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"blocked_words","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"channel_members","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"channel_message_reactions","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"channels","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"community_announcements","acl":"{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"community_bans","acl":"{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"community_invite_links","acl":"{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"community_invites","acl":"{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"daily_stats","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"health_incidents","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"health_runs","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"profile_views","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"search_events","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"},{"schema_name":"public","name":"users","acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"}]$tables$::jsonb)
      as x(schema_name text,name text,acl text)
  loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname=r.schema_name and c.relname=r.name and c.relkind='r' and c.relrowsecurity
      and c.relacl::text=r.acl and not exists(select 1 from pg_policy p where p.polrelid=c.oid)) then
      raise exception 'HARDENING_CLOSED_TABLE_DRIFT: %.%',r.schema_name,r.name;
    end if;
  end loop;
  if not exists(select 1 from pg_policy where polrelid='public.story_highlights'::regclass and polname='Users can read any highlights' and polcmd='r' and pg_get_expr(polqual,polrelid)='true')
    or not exists(select 1 from pg_policy where polrelid='public.story_highlight_items'::regclass and polname='Users can read highlight items' and polcmd='r' and pg_get_expr(polqual,polrelid)='true') then
    raise exception 'HARDENING_HIGHLIGHT_POLICY_DRIFT';
  end if;
end $preflight$;

-- All relations used by these older functions live in trusted schemas. Listing
-- pg_temp last prevents an attacker-created temporary table from shadowing them.
ALTER FUNCTION public.bump_story_views_count() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.can_view_story(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.channels_member_count_fn() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.check_email_allowed(text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.fn_notify_message_reaction() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.fn_notify_story_reaction() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.gen_meeting_room_name() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_highlight_stories(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_moment_feed(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_my_account_type() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_my_story_reactions(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_my_verified_status() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_posts_by_hashtag(text,integer,integer) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_startup_interest_counts() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_story_poll(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_story_poll_voters(uuid,uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_story_reactions(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_trending_topics(integer,integer) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_user_highlights(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.get_user_stories(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.handle_verified_school_status() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.is_email_blocked(text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.is_verified_school_domain(text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.jobs_search_tsv_fn() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.listings_search_tsv_fn() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.mark_missed_calls() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.notify_connection_request() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.notify_mentions() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.notify_mentorship() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.notify_missed_call() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.notify_on_comment_mention() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.notify_on_follow() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.notify_on_like() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.notify_on_post_comment() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.notify_on_post_mention() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.notify_on_repost() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.post_campus_moment(uuid,uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.posts_search_tsv_fn() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.profiles_search_tsv_fn() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.repair_call_record_resolution() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.stamp_conversation_account_type() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.stamp_follow_account_type() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.stamp_notification_account_type() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.studio_stage(text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.sync_application_count() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.sync_club_to_conversation() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.sync_community_to_conversation() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.sync_mentee_count() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.sync_post_bookmark_count() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.sync_post_bookmarks_count() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.sync_post_reposts_count() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.toggle_story_reaction(uuid,text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.trg_notify_incoming_call() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.update_comments_count() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.update_community_count() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.update_event_count() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.update_posts_count() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.vote_story_poll(uuid,uuid) SET search_path = pg_catalog, public, extensions, pg_temp;

-- Trigger execution does not depend on the invoking role retaining EXECUTE.
-- Keep installed triggers and their owner/service ACLs intact; remove RPC grants.
REVOKE EXECUTE ON FUNCTION public.bump_ad_counters() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_post_views() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.business_away_reply() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.community_member_joins_chat() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_comment_policy() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_notify_message_reaction() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_notify_story_reaction() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_verified_school_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_collab_invite() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_connection_request() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_market_alerts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_member_addition() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_member_departure() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_mentions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_business_member() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_comment_like() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_comment_mention() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_follow() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_follow_request() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_follow_request_accepted() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_job_application() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_like() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_new_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_post_comment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_post_mention() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_repost() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_referral() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_story_poll_vote() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_story_reaction() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_story_reaction_removed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_story_sticker_response() FROM PUBLIC, anon, authenticated;



REVOKE EXECUTE ON FUNCTION public.push_token_reassign() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refuse_blocked_content() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_conversation_account_type() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_follow_account_type() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_notification_account_type() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_post_account_type() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_application_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_club_to_conversation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_comment_reaction_counts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_community_to_conversation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_conversation_preview() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_job_application_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_message_mentions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_post_counter_exact() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_post_likes_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_post_likes_count_exact() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_post_link() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_post_mentions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_comment_restrict() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_comment_spam() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_community_member_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_listing_report_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_message_restrict() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notification_restrict() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_posts_community_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_posts_community_touch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_notify_incoming_call() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_business_advert_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_business_rating() FROM PUBLIC, anon, authenticated;

-- Maintenance jobs run as postgres. Current clients sign in through the already
-- deployed opaque username/password edge function. The old email resolver and
-- orphan campus routines have no current native/web/admin callers.
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_stories() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rebuild_daily_stats(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rebuild_trending_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_user_interests() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_for_username(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_moment_feed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_campus_moment(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_missed_calls() FROM PUBLIC, anon, authenticated;

-- RLS already denies every app read/write on these tables. Remove redundant
-- table privileges (including TRUNCATE, which row security does not cover).
REVOKE ALL ON TABLE public.blocked_email_domains FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.blocked_words FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.channel_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.channel_message_reactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.channels FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.community_announcements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.community_bans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.community_invite_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.community_invites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.daily_stats FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.health_incidents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.health_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.profile_views FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.search_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;

-- Extension relocation preserves its objects/index OIDs. Both people-search
-- functions need the extensions schema in their fixed lookup path afterwards.
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER FUNCTION public.search_people(text,integer) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.search_people_page(text,integer,integer,timestamp with time zone) SET search_path = pg_catalog, public, extensions, pg_temp;

-- A highlight extends a story's lifetime, not its audience. Its stored references
-- are visible only through the owner's current profile and the story's audience.
CREATE FUNCTION public.can_view_story_highlight(p_highlight uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    AND EXISTS (
      SELECT 1 FROM public.story_highlights h
      JOIN public.profiles p ON p.id=h.user_id
      WHERE h.id=p_highlight AND p.deactivated_at IS NULL
        AND public.can_view_profile(h.user_id)
    );
$$;

CREATE FUNCTION public.can_view_story_highlight_item(p_highlight uuid,p_story uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.can_view_story_highlight(p_highlight) AND EXISTS (
    SELECT 1 FROM public.story_highlights h
    JOIN public.stories s ON s.id=p_story AND s.user_id=h.user_id
    WHERE h.id=p_highlight AND s.created_at<=now()
      AND (s.user_id=auth.uid() OR (
        NOT EXISTS (SELECT 1 FROM public.story_hidden_from x
                    WHERE x.story_id=s.id AND x.user_id=auth.uid())
        AND public.content_story_audience_visible(s.id)
      ))
  );
$$;

CREATE FUNCTION public.owns_story_highlight_item(p_highlight uuid,p_story uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.story_highlights h
    JOIN public.stories s ON s.id=p_story AND s.user_id=h.user_id
    WHERE h.id=p_highlight AND h.user_id=auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_story_highlight(uuid),
  public.can_view_story_highlight_item(uuid,uuid),public.owns_story_highlight_item(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_story_highlight(uuid),
  public.can_view_story_highlight_item(uuid,uuid),public.owns_story_highlight_item(uuid,uuid)
  TO authenticated,service_role;

DROP POLICY "Users can read any highlights" ON public.story_highlights;
CREATE POLICY story_highlights_read ON public.story_highlights FOR SELECT TO authenticated
  USING (public.can_view_story_highlight(id));
DROP POLICY "Users can read highlight items" ON public.story_highlight_items;
CREATE POLICY story_highlight_items_read ON public.story_highlight_items FOR SELECT TO authenticated
  USING (public.can_view_story_highlight_item(highlight_id,story_id));
-- Preserve the owner's ability to remove old invalid associations; future writes
-- cannot attach someone else's story to the owner's highlight.
CREATE POLICY story_highlight_items_insert_ownership ON public.story_highlight_items
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.owns_story_highlight_item(highlight_id,story_id));
CREATE POLICY story_highlight_items_update_ownership ON public.story_highlight_items
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true) WITH CHECK (public.owns_story_highlight_item(highlight_id,story_id));

CREATE OR REPLACE FUNCTION public.get_user_highlights(p_user_id uuid)
RETURNS TABLE(id uuid,title text,cover_url text,sort_order integer,story_count bigint,
  latest_story_media_url text,created_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT h.id,h.title,h.cover_url,h.sort_order,
    (SELECT count(*) FROM public.story_highlight_items hi
      WHERE hi.highlight_id=h.id AND public.can_view_story_highlight_item(h.id,hi.story_id)),
    (SELECT s.media_url FROM public.story_highlight_items hi
      JOIN public.stories s ON s.id=hi.story_id AND s.user_id=h.user_id
      WHERE hi.highlight_id=h.id AND public.can_view_story_highlight_item(h.id,s.id)
      ORDER BY hi.sort_order DESC,hi.id DESC LIMIT 1),
    h.created_at
  FROM public.story_highlights h
  WHERE h.user_id=p_user_id AND public.can_view_story_highlight(h.id)
  ORDER BY h.sort_order,h.created_at,h.id;
$$;

CREATE OR REPLACE FUNCTION public.get_highlight_stories(p_highlight_id uuid)
RETURNS TABLE(id uuid,user_id uuid,media_url text,media_type text,thumbnail_url text,
  duration_sec integer,caption text,scope text,views_count integer,
  expires_at timestamp with time zone,created_at timestamp with time zone,
  is_viewed boolean,stickers_json jsonb,text_background jsonb,media_transform jsonb,
  category text,dual_front_url text,dual_layout jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.id,s.user_id,s.media_url,s.media_type::text,s.thumbnail_url,s.duration_sec,
    s.caption,s.scope::text,s.views_count,s.expires_at,s.created_at,
    EXISTS (SELECT 1 FROM public.story_views v WHERE v.story_id=s.id AND v.user_id=auth.uid()),
    s.stickers_json,s.text_background,s.media_transform,s.category,s.dual_front_url,s.dual_layout
  FROM public.story_highlight_items hi
  JOIN public.stories s ON s.id=hi.story_id
  WHERE hi.highlight_id=p_highlight_id
    AND public.can_view_story_highlight_item(hi.highlight_id,hi.story_id)
  ORDER BY hi.sort_order,s.created_at,s.id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_user_highlights(uuid),public.get_highlight_stories(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_user_highlights(uuid),public.get_highlight_stories(uuid)
  TO authenticated,service_role;

-- Apply those same decisions to both the manifest and its nested projection.
-- Whole-function hashes above and exact one-occurrence checks below prevent an
-- accidental broad rewrite if a different version is deployed first.
do $highlight_projection$
declare old_source text; new_source text; old_fragment text; new_fragment text;
begin
  old_source:=pg_get_functiondef('public.content_media_document(text,uuid)'::regprocedure);
  old_fragment:='where hi.highlight_id=h.id and public.content_story_audience_visible(s.id)';
  new_fragment:='where hi.highlight_id=h.id and public.can_view_story_highlight_item(h.id,s.id)';
  if (length(old_source)-length(replace(old_source,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'HARDENING_HIGHLIGHT_DOCUMENT_DRIFT';
  end if;
  new_source:=replace(old_source,old_fragment,new_fragment);
  execute new_source;
  old_source:=pg_get_functiondef('public.content_media_manifest_before_sound_rights(jsonb)'::regprocedure);
  old_fragment:='select h.user_id, true into v_author,v_allowed from public.story_highlights h where h.id=r.id;';
  new_fragment:='select h.user_id, public.can_view_story_highlight(h.id) into v_author,v_allowed from public.story_highlights h where h.id=r.id;';
  if (length(old_source)-length(replace(old_source,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'HARDENING_HIGHLIGHT_MANIFEST_DRIFT';
  end if;
  new_source:=replace(old_source,old_fragment,new_fragment);
  old_fragment:='where hi.highlight_id=r.id and public.content_story_audience_visible(s.id)';
  new_fragment:='where hi.highlight_id=r.id and public.can_view_story_highlight_item(r.id,s.id)';
  if (length(new_source)-length(replace(new_source,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'HARDENING_HIGHLIGHT_BINDING_DRIFT';
  end if;
  execute replace(new_source,old_fragment,new_fragment);
end $highlight_projection$;

-- Keep the installed overload's response while refusing another user's inbox.
CREATE OR REPLACE FUNCTION public.get_unread_counts(p_user_id uuid)
RETURNS TABLE(conversation_id uuid,unread_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.conversation_id,sum(t.unread_count)::bigint
  FROM (
    SELECT m.conversation_id,count(*)::bigint AS unread_count
    FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE auth.uid()=p_user_id AND c.is_group=false
      AND (c.user_1=p_user_id OR c.user_2=p_user_id)
      AND m.receiver_id=p_user_id AND m.sender_id<>p_user_id
      AND m.viewed_at IS NULL AND m.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.message_reads r
        WHERE r.message_id=m.id AND r.user_id=p_user_id)
    GROUP BY m.conversation_id
    UNION ALL
    SELECT m.conversation_id,count(*)::bigint
    FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    JOIN public.conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=p_user_id
    WHERE auth.uid()=p_user_id AND c.is_group=true
      AND m.sender_id<>p_user_id AND m.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.message_reads r
        WHERE r.message_id=m.id AND r.user_id=p_user_id)
    GROUP BY m.conversation_id
  ) t GROUP BY t.conversation_id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_unread_counts(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_unread_counts(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_profile_reach_28d(p_profile_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN public.can_act_as(p_profile_id) THEN (
    SELECT count(DISTINCT x.viewer)::integer FROM (
      SELECT s.user_id AS viewer FROM public.post_seen s
      JOIN public.posts p ON p.id=s.post_id
      WHERE p.user_id=p_profile_id AND s.seen_at>now()-interval '28 days'
        AND s.user_id<>p_profile_id
      UNION
      SELECT v.user_id FROM public.story_views v
      JOIN public.stories s ON s.id=v.story_id
      WHERE s.user_id=p_profile_id AND v.viewed_at>now()-interval '28 days'
        AND v.user_id<>p_profile_id
    ) x
  ) ELSE NULL END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_profile_reach_28d(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_profile_reach_28d(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_recent_likers(post_ids uuid[])
RETURNS TABLE(post_id uuid,liker_names text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
begin
  if cardinality(post_ids)>200 then
    raise exception 'At most 200 post references are allowed' using errcode='22023';
  end if;
  return query
    SELECT p.pid,array_agg(x.name ORDER BY x.liked_at DESC,x.liker_id)
    FROM (SELECT DISTINCT u.pid FROM unnest(post_ids) AS u(pid)) p
    JOIN public.posts post ON post.id=p.pid
    CROSS JOIN LATERAL (
      SELECT coalesce(nullif(pr.full_name,''),pr.username,'Someone') AS name,
        pl.created_at AS liked_at,pr.id AS liker_id
      FROM public.post_likes pl JOIN public.profiles pr ON pr.id=pl.user_id
      WHERE pl.post_id=p.pid AND pr.deactivated_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.blocked_users b
          WHERE (b.blocker_id=auth.uid() AND b.blocked_id=pr.id)
             OR (b.blocker_id=pr.id AND b.blocked_id=auth.uid()))
      ORDER BY pl.created_at DESC,pr.id LIMIT 2
    ) x
    WHERE public.feed_media_access_allowed(p.pid)
    GROUP BY p.pid;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.get_recent_likers(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_recent_likers(uuid[]) TO authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;


