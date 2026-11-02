begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- The Market/Jobs inbox has an older, distinct contract: exclude every
-- is_request row; include DM membership; count unread receiver messages even
-- when deleted; retain the subject projection and NULLS LAST activity order.
-- Keep that contract, with detail/count work restricted to at most 50 rows.
-- This uses the existing default-off inbox capability and does not enable it.
create index messages_context_unread_window_idx
  on public.messages(receiver_id,conversation_id) where read_at is null;

create function public.get_context_inbox_page_v2(
  p_context text,p_cursor jsonb default null,p_limit integer default 30,p_ids uuid[] default null
)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare
  viewer uuid:=auth.uid(); cursor_time timestamptz; cursor_id uuid;
  selected jsonb; items jsonb; last_row jsonb; next_cursor jsonb; has_more boolean;
begin
  if viewer is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';end if;
  if (public.get_paged_reader_capabilities()->>'inbox') is distinct from 'true' then
    raise exception 'PAGED_INBOX_READER_NOT_READY' using errcode='55000';
  end if;
  if p_context is null or p_context not in('market','jobs') or p_limit is null or p_limit not between 1 and 50
    or (p_ids is not null and (coalesce(array_ndims(p_ids),1)<>1 or cardinality(p_ids)>50
      or array_position(p_ids,null) is not null or p_cursor is not null)) then
    raise exception 'INVALID_CONTEXT_INBOX_REQUEST' using errcode='22023';
  end if;
  if p_ids is not null then select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into p_ids from unnest(p_ids) x;end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048
      or p_cursor->>'version' is distinct from '2' or p_cursor->>'kind' is distinct from 'context_inbox'
      or p_cursor->>'viewer' is distinct from viewer::text or p_cursor->>'context' is distinct from p_context
      or not (p_cursor ? 'activity_at') or jsonb_typeof(p_cursor->'activity_at') not in('string','null') then
      raise exception 'INVALID_CONTEXT_INBOX_CURSOR' using errcode='22023';
    end if;
    begin
      cursor_time:=(p_cursor->>'activity_at')::timestamptz;cursor_id:=(p_cursor->>'id')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'INVALID_CONTEXT_INBOX_CURSOR' using errcode='22023';
    end;
    if cursor_id is null or (cursor_time is not null and not isfinite(cursor_time)) then
      raise exception 'INVALID_CONTEXT_INBOX_CURSOR' using errcode='22023';
    end if;
  end if;

  with mine as materialized (
    select c.id from public.conversations c where c.user_1=viewer and (p_ids is null or c.id=any(p_ids))
    union select c.id from public.conversations c where c.user_2=viewer and (p_ids is null or c.id=any(p_ids))
    union select cm.conversation_id from public.conversation_members cm
      where cm.user_id=viewer and (p_ids is null or cm.conversation_id=any(p_ids))
  ), candidate_window as materialized (
    select c.* from mine join public.conversations c on c.id=mine.id
    where coalesce(c.context,'personal')=p_context and not coalesce(c.is_group,false)
      and not coalesce(c.is_request,false)
      and (p_cursor is null or (
        (cursor_time is not null and (c.last_message_time is null or c.last_message_time<cursor_time
          or (c.last_message_time=cursor_time and c.id<cursor_id)))
        or (cursor_time is null and c.last_message_time is null and c.id<cursor_id)
      ))
    order by c.last_message_time desc nulls last,c.id desc limit p_limit+1
  ), chosen as materialized (
    select * from candidate_window order by last_message_time desc nulls last,id desc limit p_limit
  ), unread as materialized (
    select m.conversation_id,count(*)::integer n from chosen c
      join public.messages m on m.conversation_id=c.id
    where m.receiver_id=viewer and m.sender_id<>viewer and m.read_at is null
    group by m.conversation_id
  )
  select jsonb_build_object('has_more',(select count(*)>p_limit from candidate_window),
    'rows',coalesce(jsonb_agg(jsonb_build_object('activity_at',c.last_message_time,'id',c.id,
      'item',jsonb_build_object('id',c.id,'conversation_id',c.id,'is_group',coalesce(c.is_group,false),
        'group_name',c.group_name,'group_avatar_url',c.group_avatar_url,
        'other_id',other.id,'other_name',other.full_name,'other_username',other.username,'other_avatar',other.avatar_url,
        'last_message',c.last_message,'last_message_time',c.last_message_time,'last_message_sender_id',c.last_message_sender_id,
        'unread_count',coalesce(u.n,0),'context',coalesce(c.context,'personal'),'context_ref_id',c.context_ref_id,
        'ref_title',case when c.context='market' then l.title when c.context='jobs' then j.title end,
        'ref_subtitle',case when c.context='market' then coalesce(l.currency,'USD')||' '||l.price::text when c.context='jobs' then j.company end,
        'ref_image',case when c.context='market' then l.images[1] end))
      order by c.last_message_time desc nulls last,c.id desc),'[]'::jsonb)) into selected
  from chosen c
    left join public.profiles other on other.id=case when c.user_1=viewer then c.user_2 else c.user_1 end
    left join public.marketplace_listings l on c.context='market' and l.id=c.context_ref_id
    left join public.jobs j on c.context='jobs' and j.id=c.context_ref_id
    left join unread u on u.conversation_id=c.id;

  has_more:=(selected->>'has_more')::boolean;
  select coalesce(jsonb_agg(e.value->'item' order by e.ordinality),'[]'::jsonb) into items
    from jsonb_array_elements(selected->'rows') with ordinality e(value,ordinality);
  if has_more then
    last_row:=(selected->'rows')->(p_limit-1);
    next_cursor:=jsonb_build_object('version',2,'kind','context_inbox','viewer',viewer,'context',p_context,
      'activity_at',last_row->'activity_at','id',last_row->'id');
  end if;
  return jsonb_build_object('version',2,'items',items,'has_more',has_more,'next_cursor',next_cursor,'ordering','live');
end $$;
revoke all on function public.get_context_inbox_page_v2(text,jsonb,integer,uuid[]) from public,anon,service_role;
grant execute on function public.get_context_inbox_page_v2(text,jsonb,integer,uuid[]) to authenticated;
commit;
