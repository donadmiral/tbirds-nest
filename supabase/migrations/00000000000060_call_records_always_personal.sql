-- 0060: a call between two people records in their PERSONAL thread, no
-- matter which context chat the call was dialed from. Group calls keep
-- recording in the group. Only the resolution block changes.

create or replace function public.record_call_event(p_call_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_caller_id uuid; v_receiver_id uuid; v_conversation_id uuid;
  v_is_group boolean;
  v_is_video boolean; v_status text; v_duration_sec integer;
  v_call_type text; v_type_label text; v_msg_text text; v_meta_json text;
  v_existing_id uuid; v_dur_h integer; v_dur_m integer; v_dur_s integer; v_dur_str text;
begin
  select cs.initiator_id, cs.receiver_id, cs.conversation_id, coalesce(cs.is_group_call, false),
         coalesce(cs.is_video, false), cs.status, coalesce(cs.duration_sec, 0)
    into v_caller_id, v_receiver_id, v_conversation_id, v_is_group, v_is_video, v_status, v_duration_sec
  from call_sessions cs where cs.id = p_call_id;
  if v_caller_id is null then return; end if;
  if v_status not in ('ended', 'missed', 'declined') then return; end if;

  if not v_is_group and v_receiver_id is not null then
    v_conversation_id := coalesce(
      resolve_personal_conversation(v_caller_id, v_receiver_id),
      v_conversation_id);
  end if;
  if v_conversation_id is null then return; end if;

  select m.id into v_existing_id from messages m
  where m.conversation_id = v_conversation_id and m.media_type = 'call_event'
    and m.media_url like '%' || p_call_id::text || '%' limit 1;
  if v_existing_id is not null then return; end if;

  if v_is_video then v_call_type := 'video'; v_type_label := 'Video';
  else v_call_type := 'voice'; v_type_label := 'Voice'; end if;

  if v_status = 'missed' then v_msg_text := 'Missed ' || v_call_type || ' call';
  elsif v_status = 'declined' then v_msg_text := 'Declined ' || v_call_type || ' call';
  elsif v_status = 'ended' and v_duration_sec > 0 then
    v_dur_h := v_duration_sec / 3600; v_dur_m := (v_duration_sec % 3600) / 60; v_dur_s := v_duration_sec % 60;
    if v_dur_h > 0 then v_dur_str := v_dur_h::text || ':' || lpad(v_dur_m::text, 2, '0') || ':' || lpad(v_dur_s::text, 2, '0');
    else v_dur_str := lpad(v_dur_m::text, 2, '0') || ':' || lpad(v_dur_s::text, 2, '0'); end if;
    v_msg_text := v_type_label || ' call · ' || v_dur_str;
  else v_msg_text := v_type_label || ' call'; end if;

  v_meta_json := jsonb_build_object('call_id', p_call_id::text, 'call_type', v_call_type,
    'status', v_status, 'duration_secs', v_duration_sec)::text;

  insert into messages (conversation_id, sender_id, receiver_id, text, media_type, media_url, is_system_message)
  values (v_conversation_id, v_caller_id, v_receiver_id, v_msg_text, 'call_event', v_meta_json, true);

  update conversations
  set last_message = case when v_is_video then '📹 ' else '📞 ' end || v_msg_text,
      last_message_time = now()
  where id = v_conversation_id;
end;
$function$;