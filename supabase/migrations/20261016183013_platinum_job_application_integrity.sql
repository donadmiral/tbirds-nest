-- REVIEWED CANDIDATE. Do not run until root authorizes deployment.
-- Atomic guard installation, short timeouts and drift checks under write locks.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $installer$
BEGIN
 IF current_user <> 'postgres' THEN
  RAISE EXCEPTION 'Installation must run as postgres';
 END IF;
END;
$installer$;
LOCK TABLE public.jobs, public.job_applications IN SHARE ROW EXCLUSIVE MODE;
-- Metadata-only drift check. Does not inspect application content.
DO $pre$
DECLARE actual text;
BEGIN
  IF to_regnamespace('platinum_internal') IS NOT NULL THEN
    RAISE EXCEPTION 'Private schema already exists. Review before installation';
  END IF;
  SELECT (select md5(string_agg(concat_ws('|',table_name,column_name,data_type,is_nullable,column_default),E'\n' order by table_name,ordinal_position)) from information_schema.columns where table_schema='public' and table_name in ('jobs','job_applications')) INTO actual;
  IF actual IS DISTINCT FROM '7de63ee1bb637cf161c5186de8c73459' THEN RAISE EXCEPTION 'Live columns changed since review'; END IF;
  SELECT (select md5(string_agg(c.conrelid::regclass::text||'|'||c.conname||'|'||pg_get_constraintdef(c.oid),E'\n' order by c.conrelid::regclass::text,c.conname)) from pg_constraint c where c.conrelid in ('public.jobs'::regclass,'public.job_applications'::regclass)) INTO actual;
  IF actual IS DISTINCT FROM '442153c0d2888e2c27fe7f59de261f75' THEN RAISE EXCEPTION 'Live constraints changed since review'; END IF;
  SELECT (select md5(string_agg(to_jsonb(p)::text,E'\n' order by p.tablename,p.policyname)) from pg_policies p where p.schemaname='public' and p.tablename in ('jobs','job_applications')) INTO actual;
  IF actual IS DISTINCT FROM '927fd1e922c6500407136e4eca7b1320' THEN RAISE EXCEPTION 'Live policies changed since review'; END IF;
  SELECT (select md5(string_agg(pg_get_triggerdef(t.oid)||'|'||t.tgenabled::text,E'\n' order by t.tgrelid::regclass::text,t.tgname)) from pg_trigger t where t.tgrelid in ('public.jobs'::regclass,'public.job_applications'::regclass) and not t.tgisinternal) INTO actual;
  IF actual IS DISTINCT FROM 'bd03973ccdb7082b3da900d96a88bb1b' THEN RAISE EXCEPTION 'Live triggers changed since review'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.notify_on_job_application()'))) INTO actual;
  IF actual IS DISTINCT FROM 'c5b11a3e231434c664af97b69ae53568' THEN RAISE EXCEPTION 'Function drift: notify_on_job_application()'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.studio_applicants(uuid)'))) INTO actual;
  IF actual IS DISTINCT FROM 'acf1bcf269e564ff5f0851d204a788e7' THEN RAISE EXCEPTION 'Function drift: studio_applicants(uuid)'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.studio_close_job(uuid,boolean)'))) INTO actual;
  IF actual IS DISTINCT FROM 'fab3644b469f6cb4a4328ab9bddaa35e' THEN RAISE EXCEPTION 'Function drift: studio_close_job(uuid,boolean)'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.studio_require(text[])'))) INTO actual;
  IF actual IS DISTINCT FROM '4db38badfbabc20e393cb5c2e46e0de0' THEN RAISE EXCEPTION 'Function drift: studio_require(text[])'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.studio_role()'))) INTO actual;
  IF actual IS DISTINCT FROM 'd7f139e152efc0ae60d5d5fe08535509' THEN RAISE EXCEPTION 'Function drift: studio_role()'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.studio_schedule_interview(uuid,timestamp with time zone,text)'))) INTO actual;
  IF actual IS DISTINCT FROM '45af18dae0f9bc26a84371c51b8d7c5c' THEN RAISE EXCEPTION 'Function drift: studio_schedule_interview(uuid,timestamp with time zone,text)'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.studio_set_stage(uuid,text)'))) INTO actual;
  IF actual IS DISTINCT FROM '1ee80699b9617aed86a4b92b08bea671' THEN RAISE EXCEPTION 'Function drift: studio_set_stage(uuid,text)'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.studio_stage(text)'))) INTO actual;
  IF actual IS DISTINCT FROM 'd8c191c1f6290ae40240fae7895c5812' THEN RAISE EXCEPTION 'Function drift: studio_stage(text)'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.sync_job_application_count()'))) INTO actual;
  IF actual IS DISTINCT FROM '6663e70d439d0ef102c869dd9ee4413f' THEN RAISE EXCEPTION 'Function drift: sync_job_application_count()'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.viewer_can_see_job(uuid)'))) INTO actual;
  IF actual IS DISTINCT FROM 'd639f89716928bdbc8c8f9d233cf6e8f' THEN RAISE EXCEPTION 'Function drift: viewer_can_see_job(uuid)'; END IF;
  SELECT md5((jsonb_build_object(
 'table_security',(select jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) order by c.relname) from pg_class c where c.oid in ('public.jobs'::regclass,'public.job_applications'::regclass)),
 'column_acl',(select jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'column',a.attname,'acl',a.attacl::text) order by a.attrelid::regclass::text,a.attnum) from pg_attribute a where a.attrelid in ('public.jobs'::regclass,'public.job_applications'::regclass) and a.attnum>0 and not a.attisdropped),
 'function_security',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('studio_set_stage','studio_schedule_interview','studio_close_job','studio_require','studio_role','studio_stage','studio_applicants','viewer_can_see_job','notify_on_job_application','sync_job_application_count')),
 'roles',(select jsonb_agg(jsonb_build_object('role',rolname,'super',rolsuper,'inherit',rolinherit,'bypassrls',rolbypassrls,'create_role',rolcreaterole) order by rolname) from pg_roles where rolname in ('postgres','anon','authenticated','service_role'))
))::text) INTO actual;
  IF actual IS DISTINCT FROM '5d362dfa5e81d30f831067a26cfec488' THEN RAISE EXCEPTION 'Role, grants or ownership changed since review'; END IF;
END;
$pre$;
-- REVIEW CANDIDATE ONLY. Not installed on production.
-- Run drift-preconditions.sql in the same transaction before installation.
-- Preserve all existing RLS policies and Studio RPC contracts.
CREATE SCHEMA platinum_internal;
REVOKE ALL ON SCHEMA platinum_internal FROM PUBLIC, anon, authenticated;

CREATE FUNCTION platinum_internal.guard_job_application_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $guard$
DECLARE
  v_uid uuid := auth.uid();
  v_posted_by uuid;
  v_deadline timestamptz;
  v_role text := current_setting('role', true);
BEGIN
  -- Definer is required only to lock an employer's job while a candidate
  -- applies. An invoker row lock also evaluates Jobs UPDATE RLS and rejects
  -- candidates. Identity, visibility and field permissions remain explicit.
  -- A SECURITY DEFINER caller changes current_user but not the selected role.
  -- Never grant a bypass merely because current_user becomes postgres.
  IF v_role = 'service_role'
     OR (coalesce(v_role, 'none') = 'none'
         AND session_user = 'postgres' AND current_user = 'postgres'
         AND v_uid IS NULL) THEN
    RETURN NEW;
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage job applications' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.applicant_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'An application must belong to the signed-in applicant' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM 'applied'
       OR NEW.interview_at IS NOT NULL OR NEW.interview_location IS NOT NULL THEN
      RAISE EXCEPTION 'New applications must start as applied without an interview' USING ERRCODE = '42501';
    END IF;

    -- Existing clients INSERT then handle 23505 by editing application content.
    -- Lock the existing identity so a concurrent DELETE cannot turn that retry
    -- into a new application to a now-closed job. Do not reopen withdrawn rows.
    PERFORM 1 FROM public.job_applications a
    WHERE a.job_id = NEW.job_id AND a.applicant_id = v_uid
    FOR KEY SHARE;
    IF FOUND THEN
      RETURN NEW;
    END IF;

    SELECT j.posted_by, j.deadline INTO v_posted_by, v_deadline
    -- Counter maintenance updates this same job AFTER INSERT. Acquire the
    -- eventual row lock now to prevent two concurrent SHARE holders from
    -- deadlocking when both counter updates try to upgrade their lock.
    FROM public.jobs j WHERE j.id = NEW.job_id FOR NO KEY UPDATE;
    IF NOT FOUND OR public.viewer_can_see_job(NEW.job_id) IS NOT TRUE THEN
      RAISE EXCEPTION 'This job is not available for applications' USING ERRCODE = '42501';
    END IF;
    IF v_deadline IS NOT NULL AND v_deadline <= clock_timestamp() THEN
      RAISE EXCEPTION 'This job is closed for new applications' USING ERRCODE = '55000';
    END IF;
    NEW.applied_at := clock_timestamp();
    NEW.updated_at := NEW.applied_at;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Unsupported application operation' USING ERRCODE = '42501';
  END IF;

  IF v_uid = OLD.applicant_id THEN
    -- Candidate content edits remain permitted after a deadline or decision.
    -- Only explicit withdrawal may change the recruiter's status.
    IF (to_jsonb(NEW) - ARRAY['cover_note','cover_letter','cv_url','cv_name','applicant_phone','portfolio_url','status','updated_at'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['cover_note','cover_letter','cv_url','cv_name','applicant_phone','portfolio_url','status','updated_at']) THEN
      RAISE EXCEPTION 'Applicants may only edit their submitted details or withdraw' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'withdrawn' THEN
      RAISE EXCEPTION 'Only the hiring team can change an application decision' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT j.posted_by INTO v_posted_by FROM public.jobs j WHERE j.id = OLD.job_id;
    IF v_posted_by IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'Only the job owner can manage its applicants' USING ERRCODE = '42501';
    END IF;
    -- Matches current Studio helpers, including business access sessions.
    PERFORM public.studio_require(ARRAY['owner','admin','recruiter']);
    IF (to_jsonb(NEW) - ARRAY['status','interview_at','interview_location','updated_at'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','interview_at','interview_location','updated_at']) THEN
      RAISE EXCEPTION 'Hiring teams may only change status and interview details' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION platinum_internal.guard_job_application_write() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_job_application_write
BEFORE INSERT OR UPDATE ON public.job_applications
FOR EACH ROW EXECUTE FUNCTION platinum_internal.guard_job_application_write();

COMMIT;
