begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- The existing push badge means unread messages only. Preserve its direct and
-- group predicates exactly, with one service-only scalar rather than one
-- network request per membership and an implicitly capped membership read.
create index if not exists messages_push_badge_dm_idx
 on public.messages(receiver_id) include(sender_id)
 where read_at is null and deleted_at is null and receiver_id is not null;
create index if not exists messages_push_badge_group_idx
 on public.messages(conversation_id,created_at) include(sender_id)
 where deleted_at is null;
create index if not exists conversation_members_push_badge_idx
 on public.conversation_members(user_id,conversation_id) include(last_read_at);
create function public.get_push_message_badge_v1(p_recipient uuid)
returns bigint language plpgsql stable security definer set search_path='' as $$
declare result bigint;
begin
 if p_recipient is null then raise exception 'A recipient is required' using errcode='22023';end if;
 select (select count(*) from public.messages m
   where m.receiver_id=p_recipient and m.sender_id<>p_recipient and m.read_at is null and m.deleted_at is null)
  +(select count(*) from public.conversation_members cm
    join public.messages m on m.conversation_id=cm.conversation_id
     and m.created_at>coalesce(cm.last_read_at,'1970-01-01'::timestamptz)
    where cm.user_id=p_recipient and m.sender_id<>p_recipient and m.deleted_at is null)
 into result;
 return result;
end $$;
revoke all on function public.get_push_message_badge_v1(uuid) from public,anon,authenticated;
grant execute on function public.get_push_message_badge_v1(uuid) to service_role;
notify pgrst,'reload schema';
commit;
