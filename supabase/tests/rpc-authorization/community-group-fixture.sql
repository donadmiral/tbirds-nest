-- LOCAL DISPOSABLE PGlite fixture only. Never run on a hosted project.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
CREATE TABLE public.communities(id uuid PRIMARY KEY,name text,emoji text,parent_id uuid,status text DEFAULT 'active',join_mode text DEFAULT 'approval',conversation_id uuid);
CREATE TABLE public.community_members(community_id uuid,user_id uuid,role text DEFAULT 'member',status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','limited')),invited_by uuid,status_at timestamptz,PRIMARY KEY(community_id,user_id));
CREATE TABLE public.community_bans(community_id uuid,user_id uuid,PRIMARY KEY(community_id,user_id));
CREATE TABLE public.community_invites(community_id uuid,user_id uuid,invited_by uuid,status text,responded_at timestamptz,PRIMARY KEY(community_id,user_id));
CREATE TABLE public.community_join_requests(community_id uuid,user_id uuid,PRIMARY KEY(community_id,user_id));
CREATE TABLE public.notifications(recipient_id uuid,type text,data jsonb);
CREATE TABLE public.clubs(id uuid PRIMARY KEY,name text,emoji text);
CREATE TABLE public.club_members(club_id uuid,user_id uuid,PRIMARY KEY(club_id,user_id));
CREATE TABLE public.conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_1 uuid,user_2 uuid,type text,is_group boolean,group_name text,group_emoji text,group_type text,group_ref_id uuid,last_message text,last_message_time timestamptz);
CREATE TABLE public.conversation_members(conversation_id uuid,user_id uuid,role text DEFAULT 'member',PRIMARY KEY(conversation_id,user_id));

CREATE OR REPLACE FUNCTION public.community_admit(p_community uuid, p_user uuid, p_invited_by uuid DEFAULT NULL::uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $source$
declare v_parent uuid; v_parent_name text;
begin
  if exists (select 1 from community_bans where community_id = p_community and user_id = p_user) then
    raise exception 'You were removed from this community and cannot rejoin';
  end if;
  select parent_id into v_parent from communities where id = p_community;
  if v_parent is not null and not exists (select 1 from community_members where community_id = v_parent and user_id = p_user) then
    select name into v_parent_name from communities where id = v_parent;
    raise exception 'Join % first', coalesce(v_parent_name, 'the parent community');
  end if;
  insert into community_members (community_id, user_id, role, status, invited_by, status_at)
  values (p_community, p_user, 'member', 'active', p_invited_by, now())
  on conflict (community_id, user_id) do nothing;
  update community_invites set status = 'accepted', responded_at = now() where community_id = p_community and user_id = p_user and status = 'invited';
  delete from community_join_requests where community_id = p_community and user_id = p_user;
  delete from notifications where recipient_id = p_user and type = 'community_invite' and data->>'community_id' = p_community::text;
end $source$;

CREATE OR REPLACE FUNCTION public.community_is_mod(p_community uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $source$
  select exists (select 1 from community_members m where m.community_id = p_community and m.user_id = auth.uid() and m.role in ('owner','moderator') and m.status = 'active');
$source$;

CREATE OR REPLACE FUNCTION public.get_or_create_group_conversation(p_group_type text, p_group_id uuid, p_group_name text, p_group_emoji text, p_user_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $source$
declare
  v_conv_id uuid;
begin
  select id into v_conv_id
  from conversations
  where type = 'group'
    and group_type = p_group_type
    and group_ref_id = p_group_id
  limit 1;

  if v_conv_id is null then
    insert into conversations (
      user_1, user_2, type, is_group,
      group_name, group_emoji, group_type, group_ref_id,
      last_message, last_message_time
    ) values (
      p_user_id, null, 'group', true,
      p_group_name, p_group_emoji, p_group_type, p_group_id,
      'Group created', now()
    )
    returning id into v_conv_id;
  end if;

  -- Direct insert bypasses RLS (security definer)
  insert into conversation_members (conversation_id, user_id, role)
  values (v_conv_id, p_user_id, 'member')
  on conflict do nothing;

  return v_conv_id;
end;
$source$;

CREATE OR REPLACE FUNCTION public.join_community(p_community uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $source$
declare v_mode text;
begin
  select join_mode into v_mode from communities where id = p_community and status = 'active';
  if v_mode is null then raise exception 'No such community'; end if;
  if exists (select 1 from community_members where community_id = p_community and user_id = auth.uid()) then
    return 'joined';
  end if;
  if exists (select 1 from community_bans where community_id = p_community and user_id = auth.uid()) then
    raise exception 'You were removed from this community and cannot rejoin';
  end if;
  if exists (select 1 from community_invites where community_id = p_community and user_id = auth.uid() and status = 'invited') then
    perform community_admit(p_community, auth.uid(), (select invited_by from community_invites where community_id = p_community and user_id = auth.uid()));
    return 'joined';
  end if;
  if v_mode = 'open' then
    perform community_admit(p_community, auth.uid(), null);
    return 'joined';
  elsif v_mode = 'approval' then
    insert into community_join_requests (community_id, user_id) values (p_community, auth.uid())
    on conflict (community_id, user_id) do nothing;
    return 'requested';
  else
    raise exception 'This community is invite only';
  end if;
end $source$;

CREATE OR REPLACE FUNCTION public.resolve_join_request(p_community uuid, p_user uuid, p_approve boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $source$
begin
  if not community_is_mod(p_community) then raise exception 'Only the owner and moderators review requests'; end if;
  if not exists (select 1 from community_join_requests where community_id = p_community and user_id = p_user) then raise exception 'No such request'; end if;
  delete from community_join_requests where community_id = p_community and user_id = p_user;
  if p_approve then perform community_admit(p_community, p_user, auth.uid()); end if;
end $source$;

CREATE OR REPLACE FUNCTION public.sync_club_to_conversation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $source$
declare
  v_name text; v_emoji text;
begin
  if TG_OP = 'INSERT' then
    select name, emoji into v_name, v_emoji
    from clubs where id = NEW.club_id;
    perform get_or_create_group_conversation(
      'club', NEW.club_id,
      coalesce(v_name,'Club'), coalesce(v_emoji,'🎯'), NEW.user_id
    );
  elsif TG_OP = 'DELETE' then
    delete from conversation_members cm
    using conversations c
    where c.id = cm.conversation_id
      and c.group_type = 'club'
      and c.group_ref_id = OLD.club_id
      and cm.user_id = OLD.user_id;
  end if;
  return coalesce(NEW, OLD);
end;
$source$;

CREATE OR REPLACE FUNCTION public.sync_community_to_conversation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $source$
declare
  v_name text; v_emoji text;
begin
  if TG_OP = 'INSERT' then
    select name, emoji into v_name, v_emoji
    from communities where id = NEW.community_id;
    perform get_or_create_group_conversation(
      'community', NEW.community_id,
      coalesce(v_name,'Community'), coalesce(v_emoji,'🌐'), NEW.user_id
    );
  elsif TG_OP = 'DELETE' then
    delete from conversation_members cm
    using conversations c
    where c.id = cm.conversation_id
      and c.group_type = 'community'
      and c.group_ref_id = OLD.community_id
      and cm.user_id = OLD.user_id;
  end if;
  return coalesce(NEW, OLD);
end;
$source$;

INSERT INTO public.communities(id,name,emoji,join_mode) VALUES
 ('10000000-0000-4000-8000-000000000001','Approval community','C','approval'),
 ('10000000-0000-4000-8000-000000000002','Open community','O','open'),
 ('10000000-0000-4000-8000-000000000003','Inactive community','I','approval');
UPDATE public.communities SET status='archived' WHERE id='10000000-0000-4000-8000-000000000003';
INSERT INTO public.community_members(community_id,user_id,role,status) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','owner','active'),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','member','active'),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','member','limited'),
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','member','active');
INSERT INTO public.clubs VALUES('20000000-0000-4000-8000-000000000001','Canonical club','K');
INSERT INTO public.club_members VALUES('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
CREATE TRIGGER trg_community_conversation AFTER INSERT OR DELETE ON public.community_members FOR EACH ROW EXECUTE FUNCTION public.sync_community_to_conversation();
CREATE TRIGGER trg_club_conversation AFTER INSERT OR DELETE ON public.club_members FOR EACH ROW EXECUTE FUNCTION public.sync_club_to_conversation();

GRANT EXECUTE ON FUNCTION public.get_or_create_group_conversation(text,uuid,text,text,uuid) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.community_admit(uuid,uuid,uuid) TO anon,authenticated,service_role;
