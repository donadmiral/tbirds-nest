-- 0093 What the role offers: free-line benefits on jobs, rendered as a
-- checked list on the job page. One line per benefit.

alter table public.jobs add column if not exists benefits text;