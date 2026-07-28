-- 0046: CV / cover letter file on applications
alter table public.job_applications add column if not exists cv_url text;
alter table public.job_applications add column if not exists cv_name text;