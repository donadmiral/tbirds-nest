-- Active-only indexes do not cover cascades through removed members or closed
-- questions. Keep full relationship indexes for erasure and session cleanup.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
create index live_members_user_history on live_streams.members(user_id,session_id);
create index live_interaction_questions_session_history on live_streams.interaction_questions(session_id);
commit;
