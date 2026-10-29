-- Bounded recruiter access with authoritative totals and transactional decisions.
CREATE INDEX IF NOT EXISTS job_applications_page ON public.job_applications(job_id, (coalesce(applied_at,'1970-01-01'::timestamptz)) DESC,id DESC);
CREATE INDEX IF NOT EXISTS job_applications_status_page ON public.job_applications(job_id,status,(coalesce(applied_at,'1970-01-01'::timestamptz)) DESC,id DESC);
CREATE OR REPLACE FUNCTION public.studio_applicant_page(p_job uuid,p_status text DEFAULT 'all',p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rows_json jsonb; next_interviews jsonb; interviews_today integer; totals jsonb; tail jsonb; more boolean; size integer:=least(greatest(coalesce(p_limit,25),1),50);
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 PERFORM public.studio_require(ARRAY['owner','admin','recruiter']);
 IF NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=p_job AND posted_by=auth.uid()) THEN RAISE EXCEPTION 'Only the job owner can view applicants' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN('all','applied','viewed','shortlisted','screening','interview','offer','hired','accepted','rejected','withdrawn') THEN RAISE EXCEPTION 'Invalid application status'; END IF;
 IF (p_before_at IS NULL) <> (p_before_id IS NULL) THEN RAISE EXCEPTION 'A complete page cursor is required'; END IF;
 SELECT coalesce(jsonb_object_agg(status,n),'{}'::jsonb)||jsonb_build_object('all',coalesce(sum(n),0)) INTO totals
 FROM (SELECT status,count(*) n FROM public.job_applications WHERE job_id=p_job GROUP BY status) counts;
 WITH page AS (
  SELECT a.*,row_number() OVER(ORDER BY coalesce(a.applied_at,'1970-01-01'::timestamptz) DESC,a.id DESC) AS page_row
  FROM public.job_applications a WHERE a.job_id=p_job AND (p_status='all' OR a.status=p_status)
  AND (p_before_at IS NULL OR (coalesce(a.applied_at,'1970-01-01'::timestamptz),a.id)<(p_before_at,p_before_id))
  ORDER BY coalesce(a.applied_at,'1970-01-01'::timestamptz) DESC,a.id DESC LIMIT size+1
 ) SELECT coalesce(jsonb_agg((to_jsonb(a)-'page_row')||jsonb_build_object('applicant',jsonb_build_object(
   'id',p.id,'full_name',p.full_name,'username',p.username,'avatar_url',p.avatar_url,'bio',p.bio,'location',p.location),
   'tags',coalesce((SELECT jsonb_agg(t.tag ORDER BY t.tag) FROM public.studio_applicant_tags t WHERE t.application_id=a.id),'[]'::jsonb),
   'notes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',n.id,'body',n.body,'created_at',n.created_at,'author',m.display_name) ORDER BY n.created_at)
     FROM public.studio_applicant_notes n LEFT JOIN public.business_access_members m ON m.id=n.author_member_id WHERE n.application_id=a.id),'[]'::jsonb)) ORDER BY a.page_row) FILTER(WHERE a.page_row<=size),'[]'::jsonb),
   coalesce(bool_or(a.page_row>size),false),
   (jsonb_agg(jsonb_build_object('id',a.id,'applied_at',coalesce(a.applied_at,'1970-01-01'::timestamptz)) ORDER BY a.page_row DESC) FILTER(WHERE a.page_row<=size))->0
 INTO rows_json,more,tail FROM page a LEFT JOIN public.profiles p ON p.id=a.applicant_id;
 SELECT coalesce(jsonb_agg(to_jsonb(upcoming) ORDER BY upcoming.interview_at),'[]'::jsonb) INTO next_interviews FROM (
  SELECT a.id,a.interview_at,coalesce(p.full_name,p.username,'Applicant') name FROM public.job_applications a
  LEFT JOIN public.profiles p ON p.id=a.applicant_id WHERE a.job_id=p_job AND a.status='interview' AND a.interview_at>=now()
  ORDER BY a.interview_at,a.id LIMIT 3
 ) upcoming;
 SELECT count(*)::integer INTO interviews_today FROM public.job_applications a WHERE a.job_id=p_job AND a.status='interview'
 AND a.interview_at>=now() AND a.interview_at<((date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC');
 RETURN jsonb_build_object('applications',rows_json,'counts',totals,'has_more',more,'cursor',CASE WHEN more THEN tail ELSE NULL END,
 'next_interviews',next_interviews,'interviews_today',interviews_today);
END;
$$;
REVOKE ALL ON FUNCTION public.studio_applicant_page(uuid,text,timestamptz,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.studio_applicant_page(uuid,text,timestamptz,uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_hiring_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.status='withdrawn' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Withdrawn applications cannot be reopened' USING ERRCODE='42501'; END IF;
 IF NEW.interview_at IS DISTINCT FROM OLD.interview_at OR NEW.interview_location IS DISTINCT FROM OLD.interview_location THEN
  IF OLD.status='withdrawn' THEN RAISE EXCEPTION 'Withdrawn applications cannot be scheduled' USING ERRCODE='42501'; END IF;
  IF NEW.interview_at IS NOT NULL AND (NOT isfinite(NEW.interview_at) OR NEW.interview_at<=clock_timestamp() OR NEW.interview_at>clock_timestamp()+interval '2 years') THEN RAISE EXCEPTION 'Choose a future interview time within two years'; END IF;
  IF length(coalesce(NEW.interview_location,''))>1000 THEN RAISE EXCEPTION 'Interview location is too long'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER hiring_workflow_guard BEFORE UPDATE ON public.job_applications FOR EACH ROW EXECUTE FUNCTION public.guard_hiring_workflow();
REVOKE ALL ON FUNCTION public.guard_hiring_workflow() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.studio_update_application(p_application uuid,p_status text,p_expected_status text DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.job_applications%ROWTYPE; saved public.job_applications%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 PERFORM public.studio_require(ARRAY['owner','admin','recruiter']);
 SELECT a1.* INTO a FROM public.job_applications a1 JOIN public.jobs j ON j.id=a1.job_id WHERE a1.id=p_application AND j.posted_by=auth.uid() FOR UPDATE OF a1;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Not your application' USING ERRCODE='42501'; END IF;
 IF a.status='withdrawn' THEN RAISE EXCEPTION 'This applicant has withdrawn' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN('applied','viewed','shortlisted','screening','interview','offer','hired','accepted','rejected') THEN RAISE EXCEPTION 'Invalid application status'; END IF;
 IF a.status=p_status THEN RETURN to_jsonb(a); END IF;
 IF (p_expected_status IS NOT NULL AND p_expected_status IS DISTINCT FROM a.status)
   OR (p_expected_updated_at IS NOT NULL AND p_expected_updated_at IS DISTINCT FROM a.updated_at) THEN RAISE EXCEPTION 'Application changed. Refresh before saving.' USING ERRCODE='40001'; END IF;
 IF p_status='interview' AND (a.interview_at IS NULL OR a.interview_at<=clock_timestamp()) THEN RAISE EXCEPTION 'Schedule an interview time first'; END IF;
 UPDATE public.job_applications SET status=p_status,updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.studio_update_application(uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.studio_update_application(uuid,text,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.studio_schedule_interview(p_application uuid,p_at timestamptz,p_location text,p_expected_updated_at timestamptz,p_expected_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.job_applications%ROWTYPE; saved public.job_applications%ROWTYPE; place text:=nullif(trim(p_location),'');
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 PERFORM public.studio_require(ARRAY['owner','admin','recruiter']);
 SELECT a1.* INTO a FROM public.job_applications a1 JOIN public.jobs j ON j.id=a1.job_id WHERE a1.id=p_application AND j.posted_by=auth.uid() FOR UPDATE OF a1;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Not your application' USING ERRCODE='42501'; END IF;
 IF a.status='withdrawn' THEN RAISE EXCEPTION 'This applicant has withdrawn' USING ERRCODE='42501'; END IF;
 IF p_at IS NOT NULL AND (NOT isfinite(p_at) OR p_at<=clock_timestamp() OR p_at>clock_timestamp()+interval '2 years') THEN RAISE EXCEPTION 'Choose a future interview time within two years'; END IF;
 IF p_at IS NULL THEN place:=NULL; END IF;
 IF length(coalesce(place,''))>1000 THEN RAISE EXCEPTION 'Interview location is too long'; END IF;
 -- A retried identical request is successful without repeating notification.
 IF a.interview_at IS NOT DISTINCT FROM p_at AND a.interview_location IS NOT DISTINCT FROM place THEN RETURN to_jsonb(a); END IF;
 IF (p_expected_status IS NOT NULL AND p_expected_status IS DISTINCT FROM a.status)
   OR (p_expected_updated_at IS NOT NULL AND p_expected_updated_at IS DISTINCT FROM a.updated_at) THEN RAISE EXCEPTION 'Application changed. Refresh before saving.' USING ERRCODE='40001'; END IF;
 UPDATE public.job_applications SET interview_at=p_at,interview_location=place,
 status=CASE WHEN p_at IS NOT NULL THEN 'interview' WHEN status='interview' THEN 'screening' ELSE status END,updated_at=clock_timestamp()
 WHERE id=a.id RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.studio_schedule_interview(uuid,timestamptz,text,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.studio_schedule_interview(uuid,timestamptz,text,timestamptz,text) TO authenticated;
-- Retain older Studio clients while routing their work through the same locks.
CREATE OR REPLACE FUNCTION public.studio_schedule_interview(p_application uuid,p_at timestamptz,p_location text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM public.studio_schedule_interview(p_application,p_at,p_location,NULL,NULL); END;
$$;
CREATE OR REPLACE FUNCTION public.studio_set_stage(p_application uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM public.studio_update_application(p_application,p_status,NULL,NULL); END;
$$;
REVOKE ALL ON FUNCTION public.studio_schedule_interview(uuid,timestamptz,text),public.studio_set_stage(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.studio_schedule_interview(uuid,timestamptz,text),public.studio_set_stage(uuid,text) TO authenticated;

-- Notifications originate from committed state transitions even for older
-- direct-update clients. Replays and unchanged values emit nothing.
CREATE OR REPLACE FUNCTION public.notify_hiring_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE title text; owner uuid;
BEGIN
 SELECT j.title,j.posted_by INTO title,owner FROM public.jobs j WHERE j.id=NEW.job_id;
 IF NEW.applicant_id=owner THEN RETURN NEW; END IF;
 IF NEW.interview_at IS DISTINCT FROM OLD.interview_at OR NEW.interview_location IS DISTINCT FROM OLD.interview_location THEN
   INSERT INTO public.notifications(recipient_id,actor_id,type,message,data)
   VALUES(NEW.applicant_id,owner,'job_interview',CASE WHEN NEW.interview_at IS NULL THEN 'Interview cancelled for ' ELSE 'Interview updated for ' END||title,
     jsonb_build_object('job_id',NEW.job_id,'application_id',NEW.id,'interview_at',NEW.interview_at,'location',NEW.interview_location));
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN('offer','hired','accepted','rejected') THEN
   INSERT INTO public.notifications(recipient_id,actor_id,type,message,data)
   VALUES(NEW.applicant_id,owner,'job_status','Application update for '||title,jsonb_build_object('job_id',NEW.job_id,'application_id',NEW.id,'status',NEW.status));
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER notify_hiring_change AFTER UPDATE ON public.job_applications FOR EACH ROW EXECUTE FUNCTION public.notify_hiring_change();
REVOKE ALL ON FUNCTION public.notify_hiring_change() FROM PUBLIC,anon,authenticated;
