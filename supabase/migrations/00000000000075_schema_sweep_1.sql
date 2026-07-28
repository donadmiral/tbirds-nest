-- 0075: schema sweep stage one. Twenty-six school-era tables with ZERO code
-- references (verified by mechanical scan 2026-07-27). Stage two (mingle,
-- clubs, affiliations, institutions, connections, communities, identity-AI)
-- waits until their referencing code is retired.

drop table if exists campus_moment_posts cascade;
drop table if exists campus_moment_prompts cascade;
drop table if exists mingle_comments cascade;
drop table if exists mingle_post_shares cascade;
drop table if exists mingle_post_updates cascade;
drop table if exists mentee_requests cascade;
drop table if exists mentorship_goals cascade;
drop table if exists mentorship_meetings cascade;
drop table if exists mentorship_requests cascade;
drop table if exists mentorships cascade;
drop table if exists mentor_profiles cascade;
drop table if exists startup_interest cascade;
drop table if exists startup_posts cascade;
drop table if exists startups cascade;
drop table if exists founder_profiles cascade;
drop table if exists investor_profiles cascade;
drop table if exists affiliation_join_requests cascade;
drop table if exists institution_domains cascade;
drop table if exists meeting_participants cascade;
drop table if exists meetings cascade;
drop table if exists connection_requests cascade;
drop table if exists _deprecated_calls cascade;
drop table if exists _deprecated_conversation_participants cascade;
drop table if exists participants cascade;
drop table if exists event_attendees cascade;
drop table if exists events cascade;