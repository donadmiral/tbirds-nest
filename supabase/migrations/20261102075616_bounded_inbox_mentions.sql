-- The client supplies only its loaded conversations. Keep both existing table
-- RLS policies in force; message deletion is deliberately not an extra filter.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- Fail on an unexpected name collision rather than accepting a different index.
create index message_mentions_recipient_created_message_idx
  on public.message_mentions (mentioned_user_id, created_at desc, message_id);

create function public.get_inbox_mentions_v2(
  p_conversation_ids uuid[],
  p_since timestamptz default (now() - interval '7 days')
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_items jsonb;
  v_since timestamptz;
begin
  if v_viewer is null then
    raise exception 'AUTHENTICATED_SESSION_REQUIRED' using errcode = '42501';
  end if;
  -- An authenticated caller cannot expand this purpose-specific reader into
  -- an arbitrary historical scan. A later client cutoff stays exact.
  v_since := greatest(p_since, transaction_timestamp() - interval '7 days');
  if (public.get_paged_reader_capabilities()->>'inbox') is distinct from 'true' then
    raise exception 'INBOX_READER_NOT_READY' using errcode = '55000';
  end if;
  if p_conversation_ids is null or coalesce(array_ndims(p_conversation_ids), 1) <> 1
    or cardinality(p_conversation_ids) > 50 or array_position(p_conversation_ids, null) is not null
    or p_since is null or not isfinite(p_since) then
    raise exception 'INVALID_INBOX_MENTION_WINDOW' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'conversation_id', latest.conversation_id,
    'latest_mention_at', latest.created_at
  ) order by latest.conversation_id), '[]'::jsonb)
  into v_items
  from (
    select m.conversation_id, max(mm.created_at) as created_at
    from public.message_mentions mm
    join public.messages m on m.id = mm.message_id
    where mm.mentioned_user_id = v_viewer
      and mm.created_at > v_since
      and m.conversation_id = any(p_conversation_ids)
    group by m.conversation_id
  ) latest;

  return jsonb_build_object('version', 1, 'since', v_since, 'items', v_items);
end;
$$;

revoke all on function public.get_inbox_mentions_v2(uuid[], timestamptz) from public, anon, service_role;
grant execute on function public.get_inbox_mentions_v2(uuid[], timestamptz) to authenticated;

commit;
