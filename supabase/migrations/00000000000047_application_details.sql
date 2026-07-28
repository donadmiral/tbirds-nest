-- 0047: full application details (idempotent superset of 0046)
alter table public.job_applications add column if not exists cv_url text;
alter table public.job_applications add column if not exists cv_name text;
alter table public.job_applications add column if not exists applicant_phone text;
alter table public.job_applications add column if not exists portfolio_url text;