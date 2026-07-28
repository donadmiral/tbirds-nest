-- 0081 membership addition records: "Actor added X" system messages, completing
-- the added/left/removed family from 0080. Creation fan-out is skipped so a new
-- group does not open with N "added" lines.

create or replace function public.notify_member_addition()
returns trigger language plpgsql security definer set search_path = public
as $fn$
declare
  v_is_group boolean;
  v_created timestamptz;
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_member_name text;
  v_text text;
begin
  select is_group, created_at into v_is_group, v_created
  from conversations where id = NEW.conversation_id;
  if not coalesce(v_is_group, false) then return NEW; end if;
  if v_created is not null and v_created > now() - interval '15 seconds' then return NEW; end if;
  if v_actor is null then return NEW; end if;

  select full_name into v_member_name from profiles where id = NEW.user_id;

  if v_actor = NEW.user_id then
    v_text := coalesce(v_member_name, 'A member') || ' joined';
  else
    select full_name into v_actor_name from profiles where id = v_actor;
    v_text := coalesce(v_actor_name, 'An admin') || ' added ' || coalesce(v_member_name, 'a member');
  end if;

  begin
    insert into messages (conversation_id, sender_id, text, is_system_message)
    values (NEW.conversation_id, v_actor, v_text, true);
  exception when others then
    null;
  end;

  return NEW;
end $fn$;

drop trigger if exists trg_member_addition on public.conversation_members;
create trigger trg_member_addition
after insert on public.conversation_members
for each row execute function public.notify_member_addition();