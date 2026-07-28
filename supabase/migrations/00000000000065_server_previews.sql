-- 0065: the conversation preview is written by the DATABASE, not the client.
-- Client preview writes were silently rejected by the conversations update
-- policy once last_sender_id joined the payload — previews froze for
-- non-admin group members and then for everyone.

create or replace function public.sync_conversation_preview()
returns trigger language plpgsql security definer set search_path = public
as $tg$
declare v_preview text;
begin
  if new.deleted_at is not null then return new; end if;
  v_preview := case
    when new.media_type = 'image' and new.view_limit is not null then '🕐 Photo'
    when new.media_type = 'image' then '📷 Photo'
    when new.media_type = 'video' then '🎬 Video'
    when new.media_type = 'gif' then 'GIF'
    when new.media_type = 'audio' then '🎤 Voice message'
    when new.media_type = 'document' then '📄 File'
    when new.media_type = 'payment' then coalesce(new.text, '💳 Payment')
    when new.media_type = 'call_event' then coalesce(new.text, '📞 Call')
    else coalesce(new.text, '')
  end;
  update conversations
  set last_message = v_preview,
      last_message_time = coalesce(new.created_at, now()),
      last_sender_id = new.sender_id
  where id = new.conversation_id;
  return new;
end $tg$;

drop trigger if exists trg_sync_conversation_preview on public.messages;
create trigger trg_sync_conversation_preview after insert on public.messages
  for each row execute function sync_conversation_preview();