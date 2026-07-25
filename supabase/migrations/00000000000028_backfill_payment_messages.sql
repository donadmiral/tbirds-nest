-- 0028 superseded by 0029.
--
-- This tried to write media_type 'payment' before the check constraint allowed
-- it, so it rolled back. 0029 widens the constraint and does the backfill.
-- Kept as a no-op rather than deleted, so the migration history stays honest
-- about what was attempted.
select 1;