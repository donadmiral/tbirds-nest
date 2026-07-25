-- 0031_message_deletion.sql
-- Three different things people mean by "delete", modelled separately because
-- they behave differently:
--
--   delete for me        one person stops seeing one message  -> message_deletions
--   delete for everyone  the message becomes a tombstone      -> messages.deleted_at
--   clear chat           one person hides everything so far   -> conversation_settings.cleared_at
--
-- Delete for everyone leaves a tombstone rather than removing the row, so the
-- other person sees that something was deleted instead of the conversation
-- silently changing shape. That is what WhatsApp does and it matters for trust.

alter table public.messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

create table if not exists public.message_deletions (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index if not exists idx_message_deletions_user on public.message_deletions (user_id);

alter table public.message_deletions enable row level security;

drop policy if exists message_deletions_own on public.message_deletions;
create policy message_deletions_own on public.message_deletions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.conversation_settings
  add column if not exists cleared_at timestamptz;

/**
 * Delete for everyone. Only the sender, and only within a sensible window,
 * because retracting something from days ago is not a delete, it is rewriting
 * what someone already read.
 */
create or replace function public.delete_message_for_everyone(p_message_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $fn$
declare v_sender uuid; v_created timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select sender_id, created_at into v_sender, v_created
  from messages where id = p_message_id;
  if v_sender is null then raise exception 'Message not found'; end if;
  if v_sender <> auth.uid() then raise exception 'You can only delete your own messages for everyone'; end if;
  if v_created < now() - interval '48 hours' then
    raise exception 'This message is too old to delete for everyone';
  end if;

  update messages
     set deleted_at = now(),
         deleted_by = auth.uid(),
         text = null,
         media_url = null,
         media_type = null
   where id = p_message_id;
end;
$fn$;

grant execute on function public.delete_message_for_everyone(uuid) to authenticated;

/**
 * Clear chat. Hides everything up to now for the caller only, without touching
 * what the other person sees.
 */
create or replace function public.clear_conversation(p_conversation_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  insert into conversation_settings (conversation_id, user_id, cleared_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set cleared_at = now();
end;
$fn$;

grant execute on function public.clear_conversation(uuid) to authenticated;