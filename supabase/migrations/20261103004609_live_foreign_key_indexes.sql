-- Hosted review identified these cascade paths before Live admission is enabled.
-- Small new Live tables use short transactional locks; fail rather than wait.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
create index live_clip_approvals_user on live_streams.clip_approvals(user_id,session_id);
create index live_clip_audit_session on live_streams.clip_audit(session_id,created_at desc);
create index live_clip_cleanup_clip on live_streams.clip_cleanup(clip_id);
create index live_commands_session on live_streams.commands(session_id);
create index live_exclusions_user on live_streams.exclusions(user_id);
create index live_gift_intents_session on live_streams.gift_intents(session_id);
create index live_interaction_chapters_actor on live_streams.interaction_chapters(actor_id);
create index live_interaction_poll_votes_option on live_streams.interaction_poll_votes(poll_id,option_id);
create index live_interaction_polls_actor on live_streams.interaction_polls(actor_id);
create index live_notification_receipts_user on live_streams.notification_receipts(user_id);
create index live_provider_events_session on live_streams.provider_events(session_id);
create index live_provider_outbox_session on live_streams.provider_outbox(session_id);
commit;
