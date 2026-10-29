-- Applicant-owned pagination and withdrawal. Hiring history is retained;
-- withdrawing does not delete the application, CV, notes or interview record.
CREATE INDEX IF NOT EXISTS job_applications_applicant_page ON public.job_applications
 (applicant_id, (coalesce(applied_at,'1970-01-01'::timestamptz)) DESC, id DESC);
-- Withdrawal replaces direct client deletion; privileged account-erasure flows
-- can still remove a person's data under the account retention policy.
DROP POLICY IF EXISTS job_apps_delete ON public.job_applications;
REVOKE DELETE ON public.job_applications FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.my_application_page(
 p_status text DEFAULT 'all', p_before_at timestamptz DEFAULT NULL,
 p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; tail jsonb; more boolean;
 size integer:=least(greatest(coalesce(p_limit,25),1),50);
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_status NOT IN('all','applied','viewed','shortlisted','screening','interview','offer','hired','accepted','rejected','withdrawn') THEN
  RAISE EXCEPTION 'Invalid application status' USING ERRCODE='22023';
 END IF;
 IF (p_before_at IS NULL) <> (p_before_id IS NULL) OR (p_before_at IS NOT NULL AND NOT isfinite(p_before_at)) THEN
  RAISE EXCEPTION 'A complete finite page cursor is required' USING ERRCODE='22023';
 END IF;
 WITH page AS (
  SELECT a.*,row_number() OVER(ORDER BY coalesce(a.applied_at,'1970-01-01'::timestamptz) DESC,a.id DESC) page_row
  FROM public.job_applications a WHERE a.applicant_id=auth.uid() AND (p_status='all' OR a.status=p_status)
   AND (p_before_at IS NULL OR (coalesce(a.applied_at,'1970-01-01'::timestamptz),a.id)<(p_before_at,p_before_id))
  ORDER BY coalesce(a.applied_at,'1970-01-01'::timestamptz) DESC,a.id DESC LIMIT size+1
 ) SELECT coalesce(jsonb_agg((to_jsonb(a)-'page_row')||jsonb_build_object('job',to_jsonb(j)) ORDER BY a.page_row)
   FILTER(WHERE a.page_row<=size),'[]'::jsonb), coalesce(bool_or(a.page_row>size),false),
   (jsonb_agg(jsonb_build_object('id',a.id,'applied_at',coalesce(a.applied_at,'1970-01-01'::timestamptz)) ORDER BY a.page_row DESC)
    FILTER(WHERE a.page_row<=size))->0
 INTO result,more,tail FROM page a LEFT JOIN public.jobs j ON j.id=a.job_id;
 RETURN jsonb_build_object('applications',result,'has_more',more,'cursor',CASE WHEN more THEN tail ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION public.my_application_page(text,timestamptz,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_application_page(text,timestamptz,uuid,integer) TO authenticated;

CREATE TABLE public.job_application_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 application_id uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type='withdrawn'),
 previous_status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(application_id,event_type)
);
ALTER TABLE public.job_application_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_application_events_read ON public.job_application_events FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.job_applications a WHERE a.id=application_id AND
  (a.applicant_id=auth.uid() OR EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=a.job_id AND j.posted_by=auth.uid()))));
REVOKE ALL ON public.job_application_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.job_application_events TO authenticated;

CREATE OR REPLACE FUNCTION public.record_application_withdrawal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid; title text;
BEGIN
 IF NEW.status='withdrawn' AND OLD.status IS DISTINCT FROM NEW.status THEN
  IF OLD.status NOT IN('applied','viewed','shortlisted','screening','interview','offer') THEN
   RAISE EXCEPTION 'This application is already closed' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.job_application_events(application_id,actor_id,event_type,previous_status)
   VALUES(NEW.id,coalesce(auth.uid(),NEW.applicant_id),'withdrawn',OLD.status);
  SELECT j.posted_by,j.title INTO owner,title FROM public.jobs j WHERE j.id=NEW.job_id;
  IF owner IS NOT NULL AND owner<>NEW.applicant_id THEN
   INSERT INTO public.notifications(recipient_id,actor_id,type,message,data)
   VALUES(owner,NEW.applicant_id,'job_status','Application withdrawn for '||coalesce(title,'your job'),
    jsonb_build_object('job_id',NEW.job_id,'job_title',title,'application_id',NEW.id,'status','withdrawn'));
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER record_application_withdrawal AFTER UPDATE OF status ON public.job_applications
 FOR EACH ROW EXECUTE FUNCTION public.record_application_withdrawal();
REVOKE ALL ON FUNCTION public.record_application_withdrawal() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_job_application(p_application uuid,
 p_expected_status text DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE a public.job_applications%ROWTYPE; saved public.job_applications%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.job_applications WHERE id=p_application AND applicant_id=auth.uid() FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Not your application' USING ERRCODE='42501'; END IF;
 -- A response lost in transit can be retried without a second receipt or event.
 IF a.status='withdrawn' THEN RETURN to_jsonb(a); END IF;
 IF a.status NOT IN('applied','viewed','shortlisted','screening','interview','offer') THEN
  RAISE EXCEPTION 'This application is already closed' USING ERRCODE='22023';
 END IF;
 IF p_expected_status IS DISTINCT FROM a.status OR p_expected_updated_at IS DISTINCT FROM a.updated_at THEN
  RAISE EXCEPTION 'Application changed. Refresh before withdrawing.' USING ERRCODE='40001';
 END IF;
 UPDATE public.job_applications SET status='withdrawn',updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_job_application(uuid,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.withdraw_job_application(uuid,text,timestamptz) TO authenticated;
