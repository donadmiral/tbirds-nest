-- A delayed close from one device must not disconnect a newer group-call join.
-- Joining is a new membership generation, including a takeover while an older
-- device's close is offline. Realtime reconnects must not call this admission RPC.
CREATE OR REPLACE FUNCTION public.join_group_call(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.call_sessions%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.call_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.id IS NULL OR NOT s.is_group_call OR s.status NOT IN ('ringing','active')
   OR (s.status='ringing' AND coalesce(s.expires_at,s.created_at+interval '90 seconds')<=now()) THEN
   RAISE EXCEPTION 'Call is no longer available';
 END IF;
 IF NOT public.is_conversation_member(s.conversation_id,auth.uid()) THEN RAISE EXCEPTION 'Not a member' USING ERRCODE='42501'; END IF;
 -- The existing transition trigger queues old provider access for revocation,
 -- then issues a fresh random provider identity on the transition back to joined.
 UPDATE public.call_participants SET status='left',left_at=now()
 WHERE call_session_id=s.id AND user_id=auth.uid() AND status='joined';
 INSERT INTO public.call_participants(call_session_id,user_id,status,joined_at,last_seen_at)
 VALUES(s.id,auth.uid(),'joined',now(),now()) ON CONFLICT(call_session_id,user_id)
 DO UPDATE SET status='joined',joined_at=now(),left_at=NULL,last_seen_at=now();
 UPDATE public.call_sessions SET status='active',started_at=coalesce(started_at,now())
 WHERE id=s.id AND status='ringing' AND auth.uid()<>s.initiator_id;
END;
$$;
REVOKE ALL ON FUNCTION public.join_group_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_call(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.join_group_call_membership(p_session_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_identity uuid;
BEGIN
 PERFORM public.join_group_call(p_session_id);
 SELECT provider_identity INTO v_identity FROM public.call_participants
 WHERE call_session_id=p_session_id AND user_id=auth.uid() AND status='joined';
 RETURN v_identity;
END;
$$;
REVOKE ALL ON FUNCTION public.join_group_call_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_call_membership(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_group_call_membership(p_conversation_id uuid, p_is_video boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_session uuid; v_identity uuid;
BEGIN
 v_session := public.start_group_call(p_conversation_id,p_is_video);
 v_identity := public.join_group_call_membership(v_session);
 RETURN jsonb_build_object('session_id',v_session,'provider_identity',v_identity);
END;
$$;
REVOKE ALL ON FUNCTION public.start_group_call_membership(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_group_call_membership(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_group_call_membership(p_session_id uuid, p_provider_identity uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.call_sessions%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_provider_identity IS NULL THEN RAISE EXCEPTION 'Membership identity required' USING ERRCODE='22023'; END IF;
 -- Match the locking order used by join_group_call and leave_group_call.
 SELECT * INTO s FROM public.call_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.id IS NULL OR NOT s.is_group_call THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.call_participants WHERE call_session_id=s.id
   AND user_id=auth.uid() AND provider_identity=p_provider_identity AND status='joined') THEN RETURN false; END IF;
 PERFORM public.leave_group_call(p_session_id);
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.leave_group_call_membership(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_group_call_membership(uuid,uuid) TO authenticated;
