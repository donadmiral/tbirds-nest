-- Dedicated private CV storage. Candidate migration: deploy with all readers.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('application-cvs', 'application-cvs', false, 8388608,
  ARRAY['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Keep all checks invoker-rights, so application and job RLS remain in force.
CREATE OR REPLACE FUNCTION public.can_read_application_cv(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    split_part(p_path, '/', 1) = (SELECT auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.job_applications a JOIN public.jobs j ON j.id = a.job_id
      WHERE a.cv_url = 'application-cvs/' || p_path
        AND a.applicant_id::text = split_part(p_path, '/', 1)
        AND a.job_id::text = split_part(p_path, '/', 2)
        AND j.posted_by = (SELECT auth.uid())
        AND public.studio_role() IN ('owner','admin','recruiter')
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_application_cv(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_application_cv(text) TO authenticated;

-- Restrictive guards also protect this bucket from older broad storage policies.
CREATE POLICY application_cvs_anon_guard ON storage.objects AS RESTRICTIVE
  FOR ALL TO anon USING (bucket_id <> 'application-cvs') WITH CHECK (bucket_id <> 'application-cvs');
CREATE POLICY application_cvs_read_guard ON storage.objects AS RESTRICTIVE
  FOR SELECT TO authenticated USING (bucket_id <> 'application-cvs' OR public.can_read_application_cv(name));
CREATE POLICY application_cvs_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'application-cvs' AND public.can_read_application_cv(name));
CREATE POLICY application_cvs_insert_guard ON storage.objects AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (bucket_id <> 'application-cvs' OR (
    split_part(name, '/', 1) = (SELECT auth.uid())::text
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|doc|docx|txt)$'
  ));
CREATE POLICY application_cvs_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'application-cvs' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);
CREATE POLICY application_cvs_immutable ON storage.objects AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (bucket_id <> 'application-cvs') WITH CHECK (bucket_id <> 'application-cvs');
CREATE POLICY application_cvs_delete_guard ON storage.objects AS RESTRICTIVE
  FOR DELETE TO authenticated USING (bucket_id <> 'application-cvs' OR (
    split_part(name, '/', 1) = (SELECT auth.uid())::text
    AND NOT EXISTS (SELECT 1 FROM public.job_applications a WHERE a.cv_url = 'application-cvs/' || name)
  ));
CREATE POLICY application_cvs_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'application-cvs' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);

-- Bind every new-format reference to the applicant, job and uploaded object.
CREATE OR REPLACE FUNCTION public.validate_application_cv_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p_path text;
BEGIN
  IF NEW.cv_url LIKE 'application-cvs/%' AND
     (TG_OP = 'INSERT' OR NEW.cv_url IS DISTINCT FROM OLD.cv_url) THEN
    p_path := substr(NEW.cv_url, length('application-cvs/') + 1);
    IF p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|doc|docx|txt)$'
       OR split_part(p_path, '/', 1) <> NEW.applicant_id::text
       OR split_part(p_path, '/', 2) <> NEW.job_id::text
       OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'application-cvs' AND o.name = p_path) THEN
      RAISE EXCEPTION 'CV must be an uploaded file belonging to this applicant and job' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_application_cv_reference() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_application_cv_reference BEFORE INSERT OR UPDATE OF cv_url ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.validate_application_cv_reference();
COMMIT;
