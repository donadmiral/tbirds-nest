-- 0080 membership departure records: a system message is written when someone
-- leaves or is removed from a group. Server-side so the record exists even if
-- the acting client dies, and cannot be forged or skipped.

create or replace function public.notify_member_departure()
returns trigger language plpgsql security definer set search_path = public
as $fn$
declare
  v_is_group boolean;
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_member_name text;
  v_text text;
begin
  select is_group into v_is_group from conversations where id = OLD.conversation_id;
  if not coalesce(v_is_group, false) then return OLD; end if;

  select full_name into v_member_name from profiles where id = OLD.user_id;

  if v_actor is null or v_actor = OLD.user_id then
    v_text := coalesce(v_member_name, 'A member') || ' left';
  else
    select full_name into v_actor_name from profiles where id = v_actor;
    v_text := coalesce(v_actor_name, 'An admin') || ' removed ' || coalesce(v_member_name, 'a member');
  end if;

  begin
    insert into messages (conversation_id, sender_id, text, is_system_message)
    values (OLD.conversation_id, coalesce(v_actor, OLD.user_id), v_text, true);
  exception when others then
    null; -- conversation mid-deletion or similar; the record is best-effort there
  end;

  return OLD;
end $fn$;

drop trigger if exists trg_member_departure on public.conversation_members;
create trigger trg_member_departure
after delete on public.conversation_members
for each row execute function public.notify_member_departure();