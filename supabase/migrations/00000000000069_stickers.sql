-- 0069: stickers. New media_type plus its list preview.
alter table public.messages drop constraint if exists messages_media_type_check;
alter table public.messages add constraint messages_media_type_check
  check (media_type = any (array['image','video','gif','audio','link','document','call_event','payment','sticker']::text[]));

create or replace function public.sync_conversation_preview()
returns trigger language plpgsql security definer set search_path = public
as $tg$
declare v_preview text; v_name text;
begin
  if new.deleted_at is not null then return new; end if;
  v_preview := case
    when new.media_type = 'image' and new.view_limit is not null then '🕐 Photo'
    when new.media_type = 'image' then '📷 Photo'
    when new.media_type = 'video' then '🎬 Video'
    when new.media_type = 'gif' then 'GIF'
    when new.media_type = 'sticker' then '💟 Sticker'
    when new.media_type = 'audio' then '🎤 Voice message'
    when new.media_type = 'document' then '📄 File'
    when new.media_type = 'payment' then coalesce(new.text, '💳 Payment')
    when new.media_type = 'call_event' then coalesce(new.text, '📞 Call')
    else coalesce(new.text, '')
  end;
  select split_part(coalesce(p.full_name, p.username, ''), ' ', 1)
    into v_name from profiles p where p.id = new.sender_id;
  update conversations
  set last_message = v_preview,
      last_message_time = coalesce(new.created_at, now()),
      last_sender_id = new.sender_id,
      last_sender_name = nullif(v_name, '')
  where id = new.conversation_id;
  return new;
end $tg$;