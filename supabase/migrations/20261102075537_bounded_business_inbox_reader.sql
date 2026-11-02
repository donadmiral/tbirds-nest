begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- Acting-business access deliberately retains the original SECURITY DEFINER
-- contract and canonical is_business_member gate (including organization and
-- delegated access). Personal inbox RLS/unread/settings rules are different.
-- No readiness flag changes here. Existing complete APIs remain available.
create function public.get_business_inbox_page_v2(
  p_business_id uuid,p_tab text default 'primary',p_cursor jsonb default null,
  p_limit integer default 30,p_ids uuid[] default null
)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare
  viewer uuid:=auth.uid(); cursor_time timestamptz; cursor_id uuid;
  selected jsonb; items jsonb; last_row jsonb; next_cursor jsonb; has_more boolean;
begin
  if viewer is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';end if;
  if (public.get_paged_reader_capabilities()->>'inbox') is distinct from 'true' then
    raise exception 'PAGED_INBOX_READER_NOT_READY' using errcode='55000';
  end if;
  if p_business_id is null or p_tab is null or p_tab not in('primary','requests')
    or p_limit is null or p_limit not between 1 and 50
    or (p_ids is not null and (coalesce(array_ndims(p_ids),1)<>1 or cardinality(p_ids)>50
      or array_position(p_ids,null) is not null or p_cursor is not null)) then
    raise exception 'INVALID_BUSINESS_INBOX_REQUEST' using errcode='22023';
  end if;
  -- An inaccessible business returns the same empty collection as the old
  -- API, with fixed totals and no existence or message metadata disclosure.
  if not coalesce(public.is_business_member(p_business_id),false) then
    return jsonb_build_object('version',2,'can_view',false,'items','[]'::jsonb,'has_more',false,'next_cursor',null,
      'summary',jsonb_build_object('primary',0,'requests',0),'ordering','live');
  end if;
  if p_ids is not null then select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into p_ids from unnest(p_ids) x;end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048
      or p_cursor->>'version' is distinct from '2' or p_cursor->>'kind' is distinct from 'business_inbox'
      or p_cursor->>'viewer' is distinct from viewer::text or p_cursor->>'business' is distinct from p_business_id::text
      or p_cursor->>'tab' is distinct from p_tab or not (p_cursor ? 'activity_at')
      or jsonb_typeof(p_cursor->'activity_at') not in('string','null') then
      raise exception 'INVALID_BUSINESS_INBOX_CURSOR' using errcode='22023';
    end if;
    begin
      cursor_time:=(p_cursor->>'activity_at')::timestamptz;cursor_id:=(p_cursor->>'id')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'INVALID_BUSINESS_INBOX_CURSOR' using errcode='22023';
    end;
    if cursor_id is null or (cursor_time is not null and not isfinite(cursor_time)) then
      raise exception 'INVALID_BUSINESS_INBOX_CURSOR' using errcode='22023';
    end if;
  end if;

  with mine as materialized (
    select c.id from public.conversations c where c.user_1=p_business_id and c.type='direct' and (p_ids is null or c.id=any(p_ids))
    union select c.id from public.conversations c where c.user_2=p_business_id and c.type='direct' and (p_ids is null or c.id=any(p_ids))
  ), base as materialized (
    select c.id,c.context,other.id other_id,lm.id last_message_id,lm.created_at last_at,
      not exists(select 1 from public.messages mb where mb.conversation_id=c.id and mb.sender_id=p_business_id) is_request
    from mine join public.conversations c on c.id=mine.id
      join public.profiles other on other.id=case when c.user_1=p_business_id then c.user_2 else c.user_1 end
      left join lateral (
        select m.id,m.created_at from public.messages m where m.conversation_id=c.id
        order by m.created_at desc limit 1
      ) lm on true
  ), candidate_window as materialized (
    select b.* from base b where (p_ids is not null or b.is_request=(p_tab='requests'))
      and (p_cursor is null or (
        (cursor_time is not null and (b.last_at is null or b.last_at<cursor_time or (b.last_at=cursor_time and b.id<cursor_id)))
        or (cursor_time is null and b.last_at is null and b.id<cursor_id)
      ))
    order by b.last_at desc nulls last,b.id desc limit p_limit+1
  ), chosen as materialized (
    select * from candidate_window order by last_at desc nulls last,id desc limit p_limit
  ), unread as materialized (
    select m.conversation_id,count(*)::integer n from chosen c join public.messages m on m.conversation_id=c.id
    where m.receiver_id=p_business_id and m.sender_id<>p_business_id and m.read_at is null
    group by m.conversation_id
  )
  select jsonb_build_object('has_more',(select count(*)>p_limit from candidate_window),
    'summary',(select jsonb_build_object('primary',count(*) filter(where not is_request),'requests',count(*) filter(where is_request)) from base),
    'rows',coalesce(jsonb_agg(jsonb_build_object('activity_at',c.last_at,'id',c.id,
      'item',jsonb_build_object('id',c.id,'conversation_id',c.id,'context',c.context,
        'other_id',c.other_id,'other_name',other.full_name,'other_username',other.username,'other_avatar',other.avatar_url,
        'last_text',lm.text,'last_at',c.last_at,'last_sender',lm.sender_id,
        'unread',coalesce(u.n,0),'is_request',c.is_request)) order by c.last_at desc nulls last,c.id desc),'[]'::jsonb)) into selected
    from chosen c join public.profiles other on other.id=c.other_id
      left join public.messages lm on lm.id=c.last_message_id
      left join unread u on u.conversation_id=c.id;
  has_more:=(selected->>'has_more')::boolean;
  select coalesce(jsonb_agg(e.value->'item' order by e.ordinality),'[]'::jsonb) into items
    from jsonb_array_elements(selected->'rows') with ordinality e(value,ordinality);
  if has_more then
    last_row:=(selected->'rows')->(p_limit-1);
    next_cursor:=jsonb_build_object('version',2,'kind','business_inbox','viewer',viewer,'business',p_business_id,'tab',p_tab,
      'activity_at',last_row->'activity_at','id',last_row->'id');
  end if;
  return jsonb_build_object('version',2,'can_view',true,'items',items,'has_more',has_more,'next_cursor',next_cursor,
    'summary',selected->'summary','ordering','live');
end $$;
revoke all on function public.get_business_inbox_page_v2(uuid,text,jsonb,integer,uuid[]) from public,anon,service_role;
grant execute on function public.get_business_inbox_page_v2(uuid,text,jsonb,integer,uuid[]) to authenticated;
commit;
