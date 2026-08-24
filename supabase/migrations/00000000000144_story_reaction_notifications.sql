-- 0144: applied via SQL editor. story_reactions notification triggers:
-- insert writes a story_reaction notification (liked / reacted-emoji wording,
-- one row per actor per story), delete withdraws it while unread. Push rides
-- the existing notifications insert trigger.
select 1;