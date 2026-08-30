-- Captured from the live database on 2026-08-30.
-- Created in the dashboard, so they existed only there until now.

CREATE OR REPLACE FUNCTION public.accept_message_request(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_conv record;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv is null then
    raise exception 'conversation not found';
  end if;
  if v_conv.is_group then
    raise exception 'not a request';
  end if;
  if v_conv.request_status <> 'pending' then
    raise exception 'not a pending request';
  end if;

  -- Only the non-sender (the receiver) can accept.
  if v_conv.request_sender_id = v_user_id then
    raise exception 'sender cannot accept own request';
  end if;
  if v_conv.user_1 <> v_user_id and v_conv.user_2 <> v_user_id then
    raise exception 'not a party to this conversation';
  end if;

  update public.conversations
    set request_status = 'accepted',
        is_request = false
    where id = p_conversation_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_business_member(p_business_id uuid, p_username text, p_role text DEFAULT 'contributor'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_target uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_business_owner(p_business_id) then
    raise exception 'Only an owner can add team members';
  end if;
  if p_role not in ('owner', 'manager', 'contributor') then
    raise exception 'Role must be owner, manager or contributor';
  end if;

  select id, full_name into v_target, v_name
  from profiles where lower(username) = lower(trim(p_username));
  if v_target is null then raise exception 'No account with that username'; end if;
  if v_target = p_business_id then raise exception 'A business cannot be its own member'; end if;

  insert into business_members (business_id, member_id, role)
  values (p_business_id, v_target, p_role)
  on conflict (business_id, member_id) do update set role = excluded.role;

  return jsonb_build_object('member_id', v_target, 'full_name', v_name, 'role', p_role);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_memory_page(p_story_id uuid, p_caption text DEFAULT NULL::text, p_style text DEFAULT 'polaroid'::text, p_album_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_album uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_album_id is not null then
    select id into v_album from memory_albums where id = p_album_id and user_id = auth.uid();
    if v_album is null then raise exception 'not your book'; end if;
  else
    select id into v_album from memory_albums where user_id = auth.uid() and is_default;
    if v_album is null then
      insert into memory_albums (user_id, is_default) values (auth.uid(), true) returning id into v_album;
    end if;
  end if;
  insert into memory_pages (user_id, album_id, story_id, media_url, media_type, thumbnail_url, caption, style, taken_at, sort_order)
  select auth.uid(), v_album, s.id, s.media_url, s.media_type, s.thumbnail_url,
         coalesce(p_caption, s.caption), coalesce(p_style, 'polaroid'), s.created_at,
         coalesce((select max(sort_order) + 1 from memory_pages where album_id = v_album), 0)
  from stories s
  where s.id = p_story_id and s.user_id = auth.uid()
  on conflict (album_id, story_id) do nothing
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_review_campaign(p_id uuid, p_approve boolean, p_note text DEFAULT NULL::text, p_paid_amount numeric DEFAULT NULL::numeric, p_payment_ref text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  select * into c from studio_campaigns where id = p_id;
  if c is null then raise exception 'No such campaign'; end if;
  if c.status <> 'submitted' then raise exception 'Campaign is not awaiting review'; end if;
  update studio_campaigns set status = case when p_approve then 'approved' else 'rejected' end, review_note = p_note, reviewed_at = now(),
    paid_amount = coalesce(p_paid_amount, paid_amount), payment_ref = coalesce(p_payment_ref, payment_ref), updated_at = now() where id = p_id;
  insert into notifications (recipient_id, actor_id, type, message, data)
  values (c.owner_id, null, 'campaign_review',
    case when p_approve then 'Campaign approved: ' || c.name || '. Set it live from Studio.' else 'Campaign not approved: ' || c.name || coalesce('. ' || p_note, '') end,
    jsonb_build_object('campaign_id', c.id, 'approved', p_approve));
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from admin_users where user_id = auth.uid() and active;
$function$
;

CREATE OR REPLACE FUNCTION public.bump_ad_counters()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.kind = 'impression' then
    update promoted_posts set impressions_count = impressions_count + 1 where id = new.promo_id;
  else
    update promoted_posts set clicks_count = clicks_count + 1 where id = new.promo_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.bump_post_views()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update posts set views_count = coalesce(views_count, 0) + 1 where id = new.post_id;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.bump_story_views_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  update public.stories set views_count = views_count + 1 where id = NEW.story_id;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.business_away_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_msg text; a record; v_first boolean;
begin
  if coalesce(new.is_system_message, false) or new.payment_id is not null then return new; end if;
  if new.receiver_id is null or new.sender_id = new.receiver_id then return new; end if;
  if not exists (select 1 from profiles pr where pr.id = new.receiver_id and pr.account_type = 'business') then return new; end if;
  select welcome_enabled, welcome_text, away_enabled, away_text into a from studio_auto_replies where owner_id = new.receiver_id;
  v_first := not exists (select 1 from messages m0 where m0.conversation_id = new.conversation_id and m0.id <> new.id);
  if a is not null and a.welcome_enabled and nullif(trim(coalesce(a.welcome_text,'')),'') is not null and v_first then
    insert into messages (conversation_id, sender_id, receiver_id, text) values (new.conversation_id, new.receiver_id, new.sender_id, trim(a.welcome_text));
    return new;
  end if;
  if a is not null then
    if a.away_enabled and nullif(trim(coalesce(a.away_text,'')),'') is not null and not studio_is_open_now(new.receiver_id) then
      v_msg := trim(a.away_text);
    end if;
  else
    select s.away_message into v_msg from business_dm_settings s
    where s.business_id = new.receiver_id and s.away_enabled and nullif(trim(s.away_message), '') is not null;
  end if;
  if v_msg is null then return new; end if;
  if exists (select 1 from messages m2 where m2.conversation_id = new.conversation_id and m2.sender_id = new.receiver_id and m2.created_at > now() - interval '24 hours') then return new; end if;
  insert into messages (conversation_id, sender_id, receiver_id, text) values (new.conversation_id, new.receiver_id, new.sender_id, v_msg);
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.can_act_as(p_target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select auth.uid() is not null
     and (auth.uid() = p_target or is_business_member(p_target));
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_memory_album(p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select case
  when auth.uid() is null then false
  when auth.uid() = p_owner then true
  when exists (select 1 from blocked_users b
               where (b.blocker_id = p_owner and b.blocked_id = auth.uid())
                  or (b.blocker_id = auth.uid() and b.blocked_id = p_owner)) then false
  when exists (select 1 from memory_album_access a
               where a.owner_id = p_owner and a.member_id = auth.uid() and a.kind = 'block') then false
  else case coalesce((select audience from memory_albums where user_id = p_owner), 'profile')
    when 'only_me' then false
    when 'custom' then exists (select 1 from memory_album_access a
                               where a.owner_id = p_owner and a.member_id = auth.uid() and a.kind = 'allow')
    when 'followers' then exists (select 1 from follows f
                                  where f.following_id = p_owner and f.follower_id = auth.uid())
    else coalesce((select pr.profile_visibility from profiles pr where pr.id = p_owner), 'public') <> 'private'
         or exists (select 1 from follows f
                    where f.following_id = p_owner and f.follower_id = auth.uid())
  end
end;
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when p.user_id = auth.uid() then true
      when exists (select 1 from blocked_users b
                   where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                      or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())) then false
      when p.community_id is not null then exists (
        select 1 from community_members cm
        where cm.community_id = p.community_id and cm.user_id = auth.uid())
      when exists (select 1 from profiles px
                   where px.id = p.user_id
                     and px.profile_visibility = 'private'
                     and not exists (select 1 from follows f
                                     where f.follower_id = auth.uid()
                                       and f.following_id = p.user_id)) then false
      when coalesce(p.audience, 'everyone') = 'everyone' then true
      when p.audience = 'followers' then exists (
        select 1 from follows f where f.follower_id = auth.uid() and f.following_id = p.user_id)
      when p.audience = 'mentioned' then exists (
        select 1 from post_mentions pm where pm.post_id = p.id and pm.mentioned_user_id = auth.uid())
      when p.audience = 'verified' then exists (
        select 1 from profiles vp where vp.id = auth.uid() and vp.is_verified)
      else true
    end
    from posts p where p.id = p_post_id
  ), false);
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_profile(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when p.id = auth.uid() then true
      when exists (
        select 1 from blocked_users b
        where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
           or (b.blocker_id = p.id and b.blocked_id = auth.uid())
      ) then false
      when p.profile_visibility = 'private' then exists (
        select 1 from follows f
        where f.follower_id = auth.uid() and f.following_id = p.id
      )
      else true
    end
    from profiles p
    where p.id = p_profile_id
  ), false);
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_story(p_story_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ select public.viewer_can_see_story(p_story_id); $function$
;

CREATE OR REPLACE FUNCTION public.cancel_join_request(p_community uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from community_join_requests where community_id = p_community and user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.capture_functions_tmp()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select string_agg(pg_get_functiondef(p.oid) || E';\n', E'\n' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
$function$
;

CREATE OR REPLACE FUNCTION public.channels_member_count_fn()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'INSERT' then update channels set member_count = member_count + 1 where id = new.channel_id; return new;
  else update channels set member_count = greatest(member_count - 1, 0) where id = old.channel_id; return old; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.check_email_allowed(p_email text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_domain TEXT;
  v_blocked BOOLEAN;
  v_is_school BOOLEAN;
BEGIN
  v_domain := lower(split_part(p_email, '@', 2));
  v_blocked := public.is_email_blocked(p_email);
  v_is_school := public.is_verified_school_domain(p_email);

  RETURN json_build_object(
    'allowed', NOT v_blocked,
    'domain', v_domain,
    'is_school_domain', v_is_school,
    'reason', CASE WHEN v_blocked THEN 'disposable_email_not_allowed' ELSE null END
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_expired_stories()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deleted int;
begin
  delete from public.stories where expires_at < (now() - interval '7 days');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clear_conversation(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  insert into conversation_settings (conversation_id, user_id, cleared_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set cleared_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_media_view(p_message_id uuid)
 RETURNS TABLE(url text, remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m record;
  v int;
begin
  select msg.id, msg.sender_id, msg.media_url, msg.view_limit, msg.conversation_id
    into m from messages msg where msg.id = p_message_id;
  if m.id is null or m.view_limit is null then
    return query select null::text, 0; return;
  end if;
  if m.sender_id = auth.uid() then
    return query select null::text, 0; return;  -- sender never reopens
  end if;
  if not exists (
    select 1 from conversations c
    where c.id = m.conversation_id
      and (c.user_1 = auth.uid() or c.user_2 = auth.uid()
           or is_conversation_member(c.id, auth.uid()))
  ) then
    raise exception 'not a participant';
  end if;

  insert into message_views (message_id, user_id, views, first_viewed_at)
  values (p_message_id, auth.uid(), 0, now())
  on conflict (message_id, user_id) do nothing;

  select views into v from message_views
   where message_id = p_message_id and user_id = auth.uid() for update;

  if v >= m.view_limit then
    return query select null::text, 0; return;
  end if;

  update message_views set views = views + 1,
    first_viewed_at = coalesce(first_viewed_at, now())
  where message_id = p_message_id and user_id = auth.uid();

  return query select m.media_url, (m.view_limit - v - 1);
end $function$
;

CREATE OR REPLACE FUNCTION public.contains_blocked(p_text text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from blocked_words w
    where p_text is not null and p_text ilike '%' || w.word || '%'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.count_active_mentorships(p_mentor_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int
  from public.mentorships
  where mentor_id = p_mentor_id and status = 'active';
$function$
;

CREATE OR REPLACE FUNCTION public.create_business_access_member(p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_biz uuid := auth.uid();
  v_type text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_raw text := '';
  v_code text;
  i int;
begin
  if v_biz is null then raise exception 'Not signed in'; end if;
  select account_type into v_type from profiles where id = v_biz;
  if v_type is distinct from 'business' then
    raise exception 'Only a business account manages its access';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A name is required'; end if;
  for i in 1..8 loop
    v_raw := v_raw || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  v_code := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4);
  insert into business_access_members (business_id, display_name, code_hash)
  values (v_biz, trim(p_name), encode(digest(upper(v_code), 'sha256'), 'hex'));
  return jsonb_build_object('code', v_code);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_channel(p_name text, p_description text DEFAULT NULL::text, p_audience text DEFAULT 'everyone'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid; cid uuid;
begin
  uid := auth.uid();
  if uid is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Channel name required'; end if;
  insert into channels (owner_id, name, description, audience)
    values (uid, trim(p_name), nullif(trim(coalesce(p_description,'')),''), coalesce(p_audience,'everyone'))
    returning id into cid;
  insert into channel_members (channel_id, user_id, role, notification_level) values (cid, uid, 'owner', 'all');
  return jsonb_build_object('id', cid, 'name', trim(p_name));
end $function$
;

CREATE OR REPLACE FUNCTION public.create_community(p_name text, p_description text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_join_mode text DEFAULT 'open'::text, p_cover_color text DEFAULT 'sky'::text, p_rules text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_name is null or length(trim(p_name)) < 3 or length(trim(p_name)) > 60 then
    raise exception 'Community names run 3 to 60 characters';
  end if;
  if p_join_mode not in ('open','approval','invite') then raise exception 'Bad join mode'; end if;
  insert into communities (owner_id, name, description, category, join_mode, cover_color, rules, member_count, status, last_activity_at)
  values (auth.uid(), trim(p_name), nullif(trim(coalesce(p_description,'')),''), p_category, p_join_mode, coalesce(p_cover_color,'sky'), nullif(trim(coalesce(p_rules,'')),''), 0, 'active', now())
  returning id into v_id;
  insert into community_members (community_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_group_conversation(p_group_name text, p_member_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_creator_id uuid := auth.uid();
  v_conv_id uuid;
  v_member_id uuid;
begin
  if v_creator_id is null then
    raise exception 'unauthorized';
  end if;
  if p_group_name is null or length(trim(p_group_name)) = 0 then
    raise exception 'group name required';
  end if;
  if p_member_ids is null or array_length(p_member_ids, 1) < 1 then
    raise exception 'at least one member required';
  end if;

  insert into public.conversations (
    is_group, group_name, created_by, user_1,
    last_message, last_message_time, last_message_sender_id,
    admin_only_edit, admin_only_invite
  )
  values (
    true, trim(p_group_name), v_creator_id, v_creator_id,
    'Group created', now(), v_creator_id,
    false, false
  )
  returning id into v_conv_id;

  insert into public.conversation_members (conversation_id, user_id, role, joined_at)
  values (v_conv_id, v_creator_id, 'admin', now());

  foreach v_member_id in array p_member_ids loop
    if v_member_id <> v_creator_id then
      insert into public.conversation_members (conversation_id, user_id, role, joined_at)
      values (v_conv_id, v_member_id, 'member', now())
      on conflict do nothing;
    end if;
  end loop;

  return v_conv_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_memory_book(p_title text, p_cover_color text DEFAULT 'blush'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into memory_albums (user_id, title, cover_color, audience, is_default)
  values (auth.uid(), coalesce(nullif(trim(p_title), ''), 'Memories'), coalesce(p_cover_color, 'blush'), 'profile', false)
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decline_group_call(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update call_participants set status = 'declined', left_at = now()
  where call_session_id = p_session_id and user_id = auth.uid();

  update call_sessions s
  set status = 'missed', ended_at = now()
  where s.id = p_session_id
    and s.status = 'ringing'
    and not exists (
      select 1 from call_participants p
      where p.call_session_id = s.id
        and p.status in ('invited', 'joined')
        and p.user_id <> s.initiator_id
    );
end $function$
;

CREATE OR REPLACE FUNCTION public.decline_mentorship_request(p_request_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  update public.mentorship_requests
     set status = 'declined', responded_at = now(), response_note = p_note
   where id = p_request_id and mentor_id = auth.uid() and status = 'pending';

  if not found then raise exception 'Request not found or not yours'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decline_message_request(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_conv record;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv is null then
    raise exception 'conversation not found';
  end if;
  if v_conv.is_group then
    raise exception 'not a request';
  end if;
  if v_conv.request_status <> 'pending' then
    raise exception 'not a pending request';
  end if;
  if v_conv.user_1 <> v_user_id and v_conv.user_2 <> v_user_id then
    raise exception 'not a party to this conversation';
  end if;
  if v_conv.request_sender_id = v_user_id then
    raise exception 'sender cannot decline own request';
  end if;

  -- Delete messages first (no cascade defined), then the conversation.
  delete from public.messages where conversation_id = p_conversation_id;
  delete from public.conversations where id = p_conversation_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_business_review(p_business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_bp uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select id into v_bp from business_profiles where profile_id = p_business_id;
  if v_bp is null then return; end if;
  delete from business_reviews where business_id = v_bp and user_id = auth.uid();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_memory_book(p_album uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
delete from memory_albums where id = p_album and user_id = auth.uid() and is_default = false;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_message_for_everyone(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid()
     and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'You can only delete your own account';
  end if;
  delete from message_deletions where user_id = p_user_id;
  delete from saved_messages where user_id = p_user_id;
  delete from starred_messages where starred_by = p_user_id;
  delete from message_reactions where user_id = p_user_id;
  delete from message_reads where user_id = p_user_id;
  delete from messages where sender_id = p_user_id;
  delete from conversation_typing where user_id = p_user_id;
  delete from conversation_settings where user_id = p_user_id;
  delete from conversation_members where user_id = p_user_id;
  delete from chat_payments where sender_id = p_user_id or recipient_id = p_user_id;
  delete from call_participants where user_id = p_user_id;
  delete from story_views where user_id = p_user_id;
  delete from story_reactions where user_id = p_user_id;
  delete from stories where user_id = p_user_id;
  delete from post_seen where user_id = p_user_id;
  delete from post_bookmarks where user_id = p_user_id;
  delete from post_reposts where user_id = p_user_id;
  delete from post_likes where user_id = p_user_id;
  delete from comment_reactions where user_id = p_user_id;
  delete from post_comments where user_id = p_user_id;
  delete from post_products where post_id in (select id from posts where user_id = p_user_id);
  delete from posts where user_id = p_user_id;
  delete from marketplace_listings where seller_id = p_user_id;
  delete from saved_listings where user_id = p_user_id;
  delete from seller_reviews where seller_id = p_user_id or reviewer_id = p_user_id;
  delete from job_saves where user_id = p_user_id;
  delete from follows where follower_id = p_user_id or following_id = p_user_id;
  delete from follow_requests where requester_id = p_user_id or target_id = p_user_id;
  delete from close_friends where owner_id = p_user_id or friend_id = p_user_id;
  delete from blocked_users where blocker_id = p_user_id or blocked_id = p_user_id;
  delete from user_reports where reporter_id = p_user_id or reported_id = p_user_id;
  delete from notifications where recipient_id = p_user_id;
  delete from club_members where user_id = p_user_id;
  delete from community_members where user_id = p_user_id;
  delete from business_members where member_id = p_user_id or business_id = p_user_id;
  delete from business_reviews where user_id = p_user_id;
  delete from business_posts where owner_id = p_user_id;
  delete from business_profiles where owner_id = p_user_id or profile_id = p_user_id;
  delete from support_tickets where user_id = p_user_id;
  delete from user_app_settings where user_id = p_user_id;
  delete from user_presence where user_id = p_user_id;
  delete from user_push_tokens where user_id = p_user_id;
  delete from profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.email_for_username(p_username text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select email from profiles
   where lower(username) = lower(trim(both '@' from p_username))
   limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.end_group_call_for_all(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from call_sessions
                 where id = p_session_id and initiator_id = auth.uid()) then
    raise exception 'only the call starter can end it for everyone';
  end if;

  update call_participants set status = 'left', left_at = now()
  where call_session_id = p_session_id and status in ('invited', 'joined');

  update call_sessions set status = 'ended', ended_at = now()
  where id = p_session_id and status in ('ringing', 'active');
end $function$
;

CREATE OR REPLACE FUNCTION public.end_meeting(p_meeting_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  update public.meetings
     set ended_at = now()
   where id = p_meeting_id and host_id = v_user and ended_at is null;

  if not found then raise exception 'Meeting not found or not yours'; end if;

  -- Mark all remaining participants as left
  update public.meeting_participants
     set left_at = now()
   where meeting_id = p_meeting_id and left_at is null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.end_mentorship(p_mentorship_id uuid, p_reason text DEFAULT 'completed'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_row record;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_reason not in ('completed','mentor_ended','mentee_ended','inactive') then
    raise exception 'Invalid reason';
  end if;

  select * into v_row from public.mentorships
    where id = p_mentorship_id and status = 'active'
    for update;

  if v_row is null then raise exception 'Mentorship not found or already ended'; end if;
  if v_row.mentor_id <> v_user and v_row.mentee_id <> v_user then
    raise exception 'Not a participant';
  end if;

  update public.mentorships
     set status = 'ended', ended_at = now(), end_reason = p_reason
   where id = p_mentorship_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.feed_block_exists(p_author uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = p_author)
       or (b.blocker_id = p_author and b.blocked_id = auth.uid())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.finalise_business(p_business_id uuid, p_name text, p_username text, p_category text, p_owner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from profiles where id = p_business_id) then
    raise exception 'No profile row for that auth user yet';
  end if;

  update profiles set
    full_name    = p_name,
    username     = lower(trim(p_username)),
    account_type = 'business',
    updated_at   = now()
  where id = p_business_id;

  insert into business_profiles (owner_id, profile_id, name, category)
  values (p_owner_id, p_business_id, p_name, nullif(trim(p_category), ''))
  on conflict (profile_id) do update
    set name = excluded.name, category = excluded.category, updated_at = now();

  insert into business_members (business_id, member_id, role)
  values (p_business_id, p_owner_id, 'owner')
  on conflict (business_id, member_id) do update set role = 'owner';

  return jsonb_build_object('business_id', p_business_id, 'name', p_name, 'username', lower(trim(p_username)));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.find_or_create_conversation(user_a uuid, user_b uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  existing_id uuid;
  new_id uuid;
begin
  -- Try find existing conversation
  select c.id into existing_id
  from conversations c
  join conversation_participants p1 on p1.conversation_id = c.id and p1.user_id = user_a
  join conversation_participants p2 on p2.conversation_id = c.id and p2.user_id = user_b
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  -- Create new conversation
  insert into conversations (created_at, updated_at)
  values (now(), now())
  returning id into new_id;

  -- Add participants
  insert into conversation_participants (conversation_id, user_id)
  values
    (new_id, user_a),
    (new_id, user_b);

  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_notify_message_reaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_msg_sender_id uuid;
  v_conversation_id uuid;
  v_actor_name text;
BEGIN
  -- Get message sender and conversation
  SELECT sender_id, conversation_id
  INTO v_msg_sender_id, v_conversation_id
  FROM messages
  WHERE id = NEW.message_id;

  -- Skip if message not found or self-reaction
  IF v_msg_sender_id IS NULL OR v_msg_sender_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Get actor name
  SELECT coalesce(full_name, username, 'Someone') INTO v_actor_name
  FROM profiles
  WHERE id = NEW.user_id;

  -- Insert notification
  INSERT INTO notifications (
    recipient_id,
    actor_id,
    type,
    message,
    body_preview,
    data
  ) VALUES (
    v_msg_sender_id,
    NEW.user_id,
    'message_reaction',
    v_actor_name || ' reacted ' || NEW.emoji || ' to your message',
    NEW.emoji,
    jsonb_build_object(
      'conversation_id', v_conversation_id,
      'message_id', NEW.message_id,
      'emoji', NEW.emoji
    )
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_notify_story_reaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_story_owner_id uuid;
  v_actor_name text;
BEGIN
  -- Get story owner
  SELECT user_id INTO v_story_owner_id
  FROM stories
  WHERE id = NEW.story_id;

  -- Skip if story not found or self-reaction
  IF v_story_owner_id IS NULL OR v_story_owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Get actor name
  SELECT coalesce(full_name, username, 'Someone') INTO v_actor_name
  FROM profiles
  WHERE id = NEW.user_id;

  -- Insert notification
  INSERT INTO notifications (
    recipient_id,
    actor_id,
    type,
    message,
    body_preview,
    data
  ) VALUES (
    v_story_owner_id,
    NEW.user_id,
    'story_reaction',
    v_actor_name || ' reacted ' || NEW.emoji || ' to your story',
    NEW.emoji,
    jsonb_build_object(
      'story_id', NEW.story_id,
      'emoji', NEW.emoji
    )
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.gen_meeting_room_name()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  v_name text;
  v_exists boolean;
begin
  loop
    -- 8 char alphanumeric room name like "k3xp9q2m"
    v_name := lower(substring(md5(random()::text || clock_timestamp()::text), 1, 8));
    select exists(select 1 from public.meetings where room_name = v_name) into v_exists;
    exit when not v_exists;
  end loop;
  return v_name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_active_promos(p_limit integer DEFAULT 3)
 RETURNS TABLE(post_id uuid, author_id uuid, content text, body text, media_url text, media jsonb, products jsonb, channel text, article_title text, read_minutes integer, quoted_post_id uuid, thread_parent_id uuid, created_at timestamp with time zone, likes_count integer, comments_count integer, reposts_count integer, bookmarks_count integer, views_count integer, is_trending boolean, author_name text, author_username text, author_avatar text, author_verified boolean, promo_id uuid, promo_label text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select p.id, p.user_id, p.content, p.body, p.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height, 'alt_text', m.alt_text, 'is_sensitive', m.is_sensitive,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = p.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'title', x.title, 'subtitle', x.subtitle, 'price', x.price,
      'currency', x.currency, 'image_url', x.image_url, 'listing_id', x.listing_id,
      'link_url', x.link_url, 'cta_label', x.cta_label, 'sort_order', x.sort_order)
      order by x.sort_order)
    from post_products x where x.post_id = p.id), '[]'::jsonb),
  p.channel, p.article_title, p.read_minutes, p.quoted_post_id, p.thread_parent_id,
  p.created_at, p.likes_count, p.comments_count, p.reposts_count, p.bookmarks_count,
  p.views_count, false,
  pr.full_name, pr.username, pr.avatar_url, pr.is_verified,
  pp.id, pp.label
from promoted_posts pp
join posts p    on p.id = pp.post_id
join profiles pr on pr.id = p.user_id
where pp.status = 'active'
  and now() >= pp.starts_at
  and (pp.ends_at is null or now() <= pp.ends_at)
  and (pp.total_cap is null or pp.impressions_count < pp.total_cap)
  and coalesce(p.audience, 'everyone') = 'everyone'
  and (pp.target_topics is null
       or array_length(pp.target_topics, 1) is null
       or exists (select 1 from user_interests ui
                  where ui.user_id = auth.uid() and ui.topic = any(pp.target_topics)))
  and not exists (select 1 from blocked_users b
                  where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                     or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
order by pp.created_at desc
limit least(coalesce(p_limit, 3), 5);
$function$
;

CREATE OR REPLACE FUNCTION public.get_business_conversations(p_business_id uuid)
 RETURNS TABLE(conversation_id uuid, context text, other_id uuid, other_name text, other_username text, other_avatar text, last_text text, last_at timestamp with time zone, last_sender uuid, unread integer, is_request boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id,
         c.context,
         pr.id, pr.full_name, pr.username, pr.avatar_url,
         lm.text,
         lm.created_at,
         lm.sender_id,
         (select count(*)::int from messages m
           where m.conversation_id = c.id
             and m.receiver_id = p_business_id
             and m.sender_id <> p_business_id
             and m.read_at is null) as unread,
         not exists (select 1 from messages mb
           where mb.conversation_id = c.id
             and mb.sender_id = p_business_id) as is_request
  from conversations c
  join profiles pr
    on pr.id = case when c.user_1 = p_business_id then c.user_2 else c.user_1 end
  left join lateral (
    select m.text, m.created_at, m.sender_id
    from messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where is_business_member(p_business_id)
    and c.type = 'direct'
    and (c.user_1 = p_business_id or c.user_2 = p_business_id)
  order by lm.created_at desc nulls last;
$function$
;

CREATE OR REPLACE FUNCTION public.get_business_members(p_business_id uuid)
 RETURNS TABLE(member_id uuid, full_name text, username text, avatar_url text, role text, joined_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.full_name, p.username, p.avatar_url, m.role, m.created_at
  from business_members m
  join profiles p on p.id = m.member_id
  where m.business_id = p_business_id
    and is_business_member(p_business_id)
  order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end, p.full_name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_business_products(p_business_id uuid, p_limit integer DEFAULT 60)
 RETURNS TABLE(product_id uuid, post_id uuid, title text, subtitle text, price numeric, currency text, image_url text, listing_id uuid, link_url text, cta_label text, posted_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select pp.id, pp.post_id, pp.title, pp.subtitle, pp.price, pp.currency,
         pp.image_url, pp.listing_id, pp.link_url, pp.cta_label, p.created_at
  from post_products pp
  join posts p on p.id = pp.post_id
  where p.user_id = p_business_id
  order by p.created_at desc, pp.sort_order
  limit least(coalesce(p_limit, 60), 200);
$function$
;

CREATE OR REPLACE FUNCTION public.get_business_reviews(p_business_id uuid, p_limit integer DEFAULT 30)
 RETURNS TABLE(review_id uuid, rating smallint, body text, created_at timestamp with time zone, reviewer_id uuid, reviewer_name text, reviewer_username text, reviewer_avatar text, is_mine boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select r.id, r.rating, r.body, r.created_at,
         pr.id, pr.full_name, pr.username, pr.avatar_url,
         (r.user_id = auth.uid())
  from business_reviews r
  join business_profiles b on b.id = r.business_id
  join profiles pr on pr.id = r.user_id
  where b.profile_id = p_business_id
  order by (r.user_id = auth.uid()) desc, r.created_at desc
  limit least(coalesce(p_limit, 30), 100);
$function$
;

CREATE OR REPLACE FUNCTION public.get_business_unread(p_business_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when exists (
    select 1 from business_members bm
    where bm.business_id = p_business_id and bm.member_id = auth.uid()
  ) then (
    select count(*)::int from messages m
    where m.receiver_id = p_business_id
      and m.read_at is null
      and m.deleted_at is null
  ) else 0 end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_catchup_feed(p_mode text DEFAULT 'all'::text, p_limit integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, story_count integer, unseen_count integer, latest_story_at timestamp with time zone, latest_story_id uuid, has_unseen boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with visible_stories as (
    select s.* from public.stories s
    where s.expires_at > now()
      and not exists (
        select 1 from public.muted_stories m
        where m.user_id = auth.uid() and m.muted_id = s.user_id)
      and (
        s.user_id = auth.uid()
        or (
          auth.uid() is not null
          and (
            coalesce(s.audience, 'everyone') = 'everyone'
            or (s.audience = 'followers' and exists (
              select 1 from public.follows f where f.following_id = s.user_id and f.follower_id = auth.uid()))
            or (s.audience = 'close_friends' and exists (
              select 1 from public.close_friends cf where cf.owner_id = s.user_id and cf.friend_id = auth.uid()))
            or (s.audience = 'only_with' and exists (
              select 1 from public.story_shared_with sw where sw.story_id = s.id and sw.user_id = auth.uid()))
            or (s.audience = 'except' and not exists (
              select 1 from public.story_hidden_from hf where hf.story_id = s.id and hf.user_id = auth.uid()))
          )
        )
      )
  ),
  grouped as (
    select vs.user_id, count(*)::int as story_count,
      count(*) filter (where not exists (
        select 1 from public.story_views sv where sv.story_id = vs.id and sv.user_id = auth.uid()))::int as unseen_count,
      max(vs.created_at) as latest_story_at,
      (array_agg(vs.id order by vs.created_at desc))[1] as latest_story_id
    from visible_stories vs group by vs.user_id
  )
  select g.user_id, p.full_name, p.username, p.avatar_url, g.story_count, g.unseen_count,
         g.latest_story_at, g.latest_story_id, g.unseen_count > 0 as has_unseen
  from grouped g join public.profiles p on p.id = g.user_id
  order by (g.unseen_count > 0) desc, g.latest_story_at desc
  limit greatest(1, least(p_limit, 100));
$function$
;

CREATE OR REPLACE FUNCTION public.get_channel_members(p_channel uuid, p_limit integer DEFAULT 60)
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, role text, notification_level text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.user_id, p.full_name, p.username, p.avatar_url, m.role, m.notification_level
  from channel_members m
  join profiles p on p.id = m.user_id
  where m.channel_id = p_channel
    and exists (select 1 from channel_members me where me.channel_id = p_channel and me.user_id = auth.uid())
  order by case m.role when 'owner' then 0 when 'collaborator' then 1 when 'moderator' then 2 else 3 end,
           p.full_name nulls last
  limit least(coalesce(p_limit, 60), 200);
$function$
;

CREATE OR REPLACE FUNCTION public.get_channel_messages(p_channel uuid, p_limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, content text, created_at timestamp with time zone, media_url text, media_type text, sender_name text, sender_avatar text, sender_role text, reactions jsonb, my_reactions text[], reply_count integer, is_prompt boolean, poll jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    m.id, m.content, m.created_at, m.media_url, m.media_type,
    p.full_name, p.avatar_url,
    coalesce(cm.role, 'member'),
    coalesce((select jsonb_object_agg(r.emoji, r.n) from (
      select emoji, count(*)::int as n from channel_message_reactions where message_id = m.id group by emoji
    ) r), '{}'::jsonb),
    coalesce((select array_agg(emoji) from channel_message_reactions where message_id = m.id and user_id = auth.uid()), '{}'),
    m.reply_count, m.is_prompt,
    (select case when pl.message_id is null then null else jsonb_build_object(
      'ends_at', pl.ends_at,
      'total', (select count(*)::int from channel_poll_votes v where v.message_id = m.id),
      'my_option', (select v.option_id from channel_poll_votes v where v.message_id = m.id and v.user_id = auth.uid()),
      'options', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'label', o.label,
          'votes', (select count(*)::int from channel_poll_votes v where v.option_id = o.id)
        ) order by o.position), '[]'::jsonb)
        from channel_poll_options o where o.message_id = m.id)
    ) end from channel_polls pl where pl.message_id = m.id)
  from channel_messages m
  join profiles p on p.id = m.sender_id
  left join channel_members cm on cm.channel_id = m.channel_id and cm.user_id = m.sender_id
  where m.channel_id = p_channel
    and exists (
      select 1 from channels c where c.id = p_channel and (
        c.audience = 'everyone'
        or exists (select 1 from channel_members me where me.channel_id = p_channel and me.user_id = auth.uid())
      )
    )
  order by m.created_at desc
  limit least(coalesce(p_limit, 40), 100);
$function$
;

CREATE OR REPLACE FUNCTION public.get_channel_replies(p_message uuid, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, content text, created_at timestamp with time zone, user_id uuid, user_name text, user_avatar text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.id, r.content, r.created_at, pr.id, pr.full_name, pr.avatar_url
  from channel_replies r join profiles pr on pr.id = r.user_id
  where r.message_id = p_message and (p_cursor is null or r.created_at > p_cursor)
  order by r.created_at asc
  limit least(coalesce(p_limit, 40), 80);
$function$
;

CREATE OR REPLACE FUNCTION public.get_channel_settings(p_channel uuid)
 RETURNS TABLE(name text, description text, audience text, replies_enabled boolean, icon_url text, member_count integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.name, c.description, c.audience, c.replies_enabled, c.icon_url, c.member_count
  from channels c
  where c.id = p_channel
    and exists (select 1 from channel_members m where m.channel_id = p_channel and m.user_id = auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.get_channels(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 30)
 RETURNS TABLE(id uuid, name text, description text, icon_url text, member_count integer, owner_id uuid, owner_name text, owner_username text, owner_avatar text, is_member boolean, my_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.name, c.description, c.icon_url, c.member_count,
         pr.id, pr.full_name, pr.username, pr.avatar_url,
         (cm.user_id is not null), cm.role
  from channels c
  join profiles pr on pr.id = c.owner_id
  left join channel_members cm on cm.channel_id = c.id and cm.user_id = auth.uid()
  where c.status = 'active'
    and (coalesce(trim(p_query),'') = '' or c.name ilike '%' || trim(p_query) || '%' or c.description ilike '%' || trim(p_query) || '%')
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = auth.uid() and b.blocked_id = c.owner_id)
                       or (b.blocker_id = c.owner_id and b.blocked_id = auth.uid()))
  order by (cm.user_id is not null) desc, c.member_count desc, c.created_at desc
  limit least(coalesce(p_limit, 30), 60);
$function$
;

CREATE OR REPLACE FUNCTION public.get_communities(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 30)
 RETURNS TABLE(id uuid, name text, description text, icon_url text, cover_color text, category text, join_mode text, member_count integer, last_activity_at timestamp with time zone, is_member boolean, my_role text, has_pending boolean, owner_username text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.name, c.description, c.icon_url, c.cover_color, c.category,
         c.join_mode, c.member_count, c.last_activity_at,
         (m.user_id is not null) as is_member,
         m.role as my_role,
         exists (select 1 from community_join_requests r where r.community_id = c.id and r.user_id = auth.uid()) as has_pending,
         p.username as owner_username
  from communities c
  left join profiles p on p.id = c.owner_id
  left join community_members m on m.community_id = c.id and m.user_id = auth.uid()
  where c.status = 'active' and c.name is not null and c.owner_id is not null
    and (p_query is null or trim(p_query) = '' or c.name ilike '%' || trim(p_query) || '%' or c.description ilike '%' || trim(p_query) || '%')
  order by (m.user_id is not null) desc, c.last_activity_at desc, c.member_count desc
  limit least(coalesce(p_limit, 30), 60);
$function$
;

CREATE OR REPLACE FUNCTION public.get_community(p_community uuid)
 RETURNS TABLE(id uuid, name text, description text, icon_url text, cover_color text, category text, rules text, join_mode text, member_count integer, is_member boolean, my_role text, has_pending boolean, owner_username text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.name, c.description, c.icon_url, c.cover_color, c.category,
         c.rules, c.join_mode, c.member_count,
         (m.user_id is not null), m.role,
         exists (select 1 from community_join_requests r where r.community_id = c.id and r.user_id = auth.uid()),
         p.username
  from communities c
  left join profiles p on p.id = c.owner_id
  left join community_members m on m.community_id = c.id and m.user_id = auth.uid()
  where c.id = p_community and c.status = 'active';
$function$
;

CREATE OR REPLACE FUNCTION public.get_community_members(p_community uuid, p_limit integer DEFAULT 60)
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, role text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.user_id, p.full_name, p.username, p.avatar_url, m.role
  from community_members m
  join profiles p on p.id = m.user_id
  where m.community_id = p_community
    and exists (select 1 from community_members me where me.community_id = p_community and me.user_id = auth.uid())
  order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end, p.full_name nulls last
  limit least(coalesce(p_limit, 60), 200);
$function$
;

CREATE OR REPLACE FUNCTION public.get_community_posts(p_community uuid, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 25)
 RETURNS TABLE(post_id uuid, author_id uuid, content text, body text, media_url text, media jsonb, products jsonb, link jsonb, channel text, article_title text, read_minutes integer, quoted_post_id uuid, thread_parent_id uuid, created_at timestamp with time zone, likes_count integer, comments_count integer, reposts_count integer, bookmarks_count integer, views_count integer, is_trending boolean, author_name text, author_username text, author_avatar text, author_verified boolean, author_kind text, author_verified_tier text, viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean, viewer_follows boolean, sort_key double precision, innovation_field text, innovation_stage text, has_fact_check boolean, reposted_by_id uuid, reposted_by_name text, reposted_by_username text, has_poll boolean, edited_at timestamp with time zone, category text, is_pinned boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select p.id, p.user_id, p.content, p.body, p.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height, 'alt_text', m.alt_text, 'is_sensitive', m.is_sensitive,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = p.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', pp.id, 'title', pp.title, 'subtitle', pp.subtitle,
      'price', pp.price, 'currency', pp.currency, 'image_url', pp.image_url,
      'listing_id', pp.listing_id, 'link_url', pp.link_url,
      'cta_label', pp.cta_label, 'sort_order', pp.sort_order)
      order by pp.sort_order)
    from post_products pp where pp.post_id = p.id), '[]'::jsonb),
  case when lp.url is not null then jsonb_build_object(
      'url', lp.url, 'title', lp.title, 'description', lp.description,
      'image_url', lp.image_url, 'domain', lp.domain)
    else null end,
  p.channel, p.article_title, p.read_minutes, p.quoted_post_id, p.thread_parent_id,
  p.created_at, p.likes_count, p.comments_count, p.reposts_count, p.bookmarks_count,
  p.views_count, false,
  pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.account_type, pr.verified_tier,
  (lk.user_id is not null), (bk.user_id is not null), (rp.user_id is not null), (fl.follower_id is not null),
  extract(epoch from p.created_at)::double precision,
  p.innovation_field, p.innovation_stage,
  exists (select 1 from fact_checks fc
          join fact_check_votes fv on fv.fact_check_id = fc.id
          where fc.post_id = p.id
          group by fc.id
          having count(*) filter (where fv.helpful) >= 3
             and count(*) filter (where fv.helpful) > 2 * count(*) filter (where not fv.helpful)),
  null::uuid, null::text, null::text,
  exists (select 1 from post_polls pl where pl.post_id = p.id),
  p.edited_at, p.category,
  p.is_community_pinned
from posts p
join profiles pr on pr.id = p.user_id
left join link_previews lp on lp.url = p.link_url
left join post_likes lk     on lk.post_id = p.id and lk.user_id = auth.uid()
left join post_bookmarks bk on bk.post_id = p.id and bk.user_id = auth.uid()
left join post_reposts rp   on rp.post_id = p.id and rp.user_id = auth.uid()
left join follows fl        on fl.following_id = p.user_id and fl.follower_id = auth.uid()
where p.community_id = p_community
  and exists (select 1 from community_members mm where mm.community_id = p_community and mm.user_id = auth.uid())
  and (p_cursor is null or p.created_at < p_cursor)
order by (case when p_cursor is null then (not p.is_community_pinned)::int else 1 end), p.created_at desc, p.id desc
limit least(coalesce(p_limit, 25), 50);
$function$
;

CREATE OR REPLACE FUNCTION public.get_context_unread()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with mine as (
    select c.id, coalesce(c.context, 'personal') as ctx, coalesce(c.is_group, false) as is_group
    from conversations c
    where (c.user_1 = auth.uid() or c.user_2 = auth.uid())
       or exists (select 1 from conversation_members m
                  where m.conversation_id = c.id and m.user_id = auth.uid())
  ),
  unread as (
    select mine.ctx, mine.is_group, count(*)::int as n
    from mine
    join messages msg on msg.conversation_id = mine.id
    where msg.receiver_id = auth.uid()
      and msg.sender_id <> auth.uid()
      and msg.read_at is null
    group by mine.ctx, mine.is_group
  )
  select jsonb_build_object(
    'market',   coalesce((select sum(n) from unread where ctx = 'market'), 0),
    'jobs',     coalesce((select sum(n) from unread where ctx = 'jobs'), 0),
    'groups',   coalesce((select sum(n) from unread where is_group and ctx = 'personal'), 0),
    'personal', coalesce((select sum(n) from unread where ctx = 'personal' and not is_group), 0)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.get_conversation_payments(p_conversation_id uuid)
 RETURNS TABLE(payment_id uuid, sender_id uuid, recipient_id uuid, amount numeric, currency text, status text, note text, listing_id uuid, created_at timestamp with time zone, completed_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.sender_id, p.recipient_id, p.amount, p.currency, p.status,
         p.note, p.listing_id, p.created_at, p.completed_at
  from chat_payments p
  where p.conversation_id = p_conversation_id
    and (p.sender_id = auth.uid() or p.recipient_id = auth.uid())
  order by p.created_at desc
  limit 50;
$function$
;

CREATE OR REPLACE FUNCTION public.get_conversations_by_context(p_context text DEFAULT 'personal'::text, p_include_groups boolean DEFAULT true)
 RETURNS TABLE(conversation_id uuid, is_group boolean, group_name text, group_avatar_url text, other_id uuid, other_name text, other_username text, other_avatar text, last_message text, last_message_time timestamp with time zone, last_message_sender_id uuid, unread_count integer, context text, context_ref_id uuid, ref_title text, ref_subtitle text, ref_image text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with mine as (
    select c.*
    from conversations c
    where ((c.user_1 = auth.uid() or c.user_2 = auth.uid())
        or exists (select 1 from conversation_members m
                   where m.conversation_id = c.id and m.user_id = auth.uid()))
      and coalesce(c.context, 'personal') = p_context
      and (p_include_groups or coalesce(c.is_group, false) = false)
      and coalesce(c.is_request, false) = false
  )
  select
    m.id, coalesce(m.is_group, false), m.group_name, m.group_avatar_url,
    other.id, other.full_name, other.username, other.avatar_url,
    m.last_message, m.last_message_time, m.last_message_sender_id,
    (select count(*)::int from messages msg
      where msg.conversation_id = m.id
        and msg.receiver_id = auth.uid()
        and msg.sender_id <> auth.uid()
        and msg.read_at is null),
    coalesce(m.context, 'personal'), m.context_ref_id,
    case when m.context = 'market' then l.title
         when m.context = 'jobs'   then j.title end,
    case when m.context = 'market' then coalesce(l.currency, 'USD') || ' ' || l.price::text
         when m.context = 'jobs'   then j.company end,
    case when m.context = 'market' then l.images[1] end
  from mine m
  left join profiles other
    on other.id = case when coalesce(m.is_group, false) then null
                       when m.user_1 = auth.uid() then m.user_2
                       else m.user_1 end
  left join marketplace_listings l on m.context = 'market' and l.id = m.context_ref_id
  left join jobs j                 on m.context = 'jobs'   and j.id = m.context_ref_id
  order by m.last_message_time desc nulls last;
$function$
;

CREATE OR REPLACE FUNCTION public.get_fact_checks(p_post_id uuid)
 RETURNS TABLE(id uuid, body text, sources text[], created_at timestamp with time zone, helpful_count integer, not_helpful_count integer, viewer_vote boolean, is_mine boolean, qualifies boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select f.id, f.body, f.sources, f.created_at,
  coalesce(sum(case when v.helpful then 1 else 0 end), 0)::int,
  coalesce(sum(case when not v.helpful then 1 else 0 end), 0)::int,
  (select mv.helpful from fact_check_votes mv where mv.fact_check_id = f.id and mv.voter_id = auth.uid()),
  (f.author_id = auth.uid()),
  (coalesce(sum(case when v.helpful then 1 else 0 end), 0) >= 3
   and coalesce(sum(case when v.helpful then 1 else 0 end), 0)
       > coalesce(sum(case when not v.helpful then 1 else 0 end), 0) * 2)
from fact_checks f
left join fact_check_votes v on v.fact_check_id = f.id
where f.post_id = p_post_id
group by f.id
order by 5 desc, f.created_at asc;
$function$
;

CREATE OR REPLACE FUNCTION public.get_feed(p_mode text DEFAULT 'for_you'::text, p_cursor_key double precision DEFAULT NULL::double precision, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(post_id uuid, author_id uuid, content text, body text, media_url text, media jsonb, products jsonb, link jsonb, channel text, article_title text, read_minutes integer, quoted_post_id uuid, thread_parent_id uuid, created_at timestamp with time zone, likes_count integer, comments_count integer, reposts_count integer, bookmarks_count integer, views_count integer, is_trending boolean, author_name text, author_username text, author_avatar text, author_verified boolean, author_kind text, author_verified_tier text, viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean, viewer_follows boolean, sort_key double precision, innovation_field text, innovation_stage text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with viewer as (select auth.uid() as uid),
recent_velocity as (
  select coalesce(percentile_cont(0.9) within group (
           order by (coalesce(likes_count,0) + coalesce(comments_count,0) + coalesce(reposts_count,0))
                    / greatest(extract(epoch from (now() - created_at)) / 3600.0, 1.0)
         ), 0) as cutoff
  from posts where created_at > now() - interval '72 hours'
),
affinity as (
  select p.user_id as author_id, count(*)::int as n
  from post_likes pl join posts p on p.id = pl.post_id
  where pl.user_id = (select uid from viewer)
    and pl.created_at > now() - interval '30 days'
  group by p.user_id
),
candidates as (
  select p.id, p.user_id, p.content, p.body, p.media_url, p.link_url, p.channel,
         p.article_title, p.read_minutes, p.innovation_field, p.innovation_stage, p.quoted_post_id, p.thread_parent_id,
         p.created_at, p.likes_count, p.comments_count, p.reposts_count,
         p.bookmarks_count, p.views_count
  from posts p
  where (p_mode <> 'innovation' or p.channel = 'innovation')
    and (p_mode <> 'for_you'    or p.created_at > now() - interval '365 days')
    and (p_mode <> 'trending'   or p.created_at > now() - interval '7 days')
    and (p_mode <> 'trending' or (coalesce(p.likes_count,0) + coalesce(p.comments_count,0) + coalesce(p.reposts_count,0)) >= 3)
    and (p_mode <> 'trending' or p.id in (select ref_id from trending_snapshot where kind = 'post'))
    and (p_mode <> 'for_you'
      or not exists (select 1 from post_products pp2
                     where pp2.post_id = p.id and pp2.listing_id is not null)
      or exists (select 1 from post_products pp3
                 join marketplace_listings ml3 on ml3.id = pp3.listing_id
                 where pp3.post_id = p.id and ml3.status = 'available')
      or exists (select 1 from post_media pm2 where pm2.post_id = p.id))
    and not exists (select 1 from hidden_posts h
                    where h.post_id = p.id and h.user_id = (select uid from viewer))
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = (select uid from viewer) and b.blocked_id = p.user_id)
                       or (b.blocker_id = p.user_id and b.blocked_id = (select uid from viewer)))
    and not exists (select 1 from profiles px
                    where px.id = p.user_id
                      and px.profile_visibility = 'private'
                      and px.id <> (select uid from viewer)
                      and not exists (select 1 from follows f2
                                      where f2.follower_id = (select uid from viewer)
                                        and f2.following_id = p.user_id))
    and (
      coalesce(p.audience, 'everyone') = 'everyone'
      or p.user_id = (select uid from viewer)
      or (p.audience = 'followers' and exists (
            select 1 from follows f
            where f.following_id = p.user_id and f.follower_id = (select uid from viewer)))
      or (p.audience = 'mentioned' and exists (
            select 1 from post_mentions pm
            where pm.post_id = p.id and pm.mentioned_user_id = (select uid from viewer)))
      or (p.audience = 'verified' and exists (
            select 1 from profiles vp
            where vp.id = (select uid from viewer) and vp.is_verified))
    )
),
enriched as (
  select c.*, pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.account_type, pr.verified_tier,
    (fl.follower_id is not null) as follows,
    (lk.user_id is not null) as liked,
    (bk.user_id is not null) as bookmarked,
    (rp.user_id is not null) as reposted,
    (sn.post_id is not null) as seen,
    coalesce(af.n, 0) as affinity_n,
    (coalesce(c.likes_count,0) + coalesce(c.comments_count,0) + coalesce(c.reposts_count,0)) as engagements,
    (coalesce(c.likes_count,0) + coalesce(c.comments_count,0) + coalesce(c.reposts_count,0))
      / greatest(extract(epoch from (now() - c.created_at)) / 3600.0, 1.0) as velocity
  from candidates c
  join profiles pr on pr.id = c.user_id
  left join follows fl        on fl.following_id = c.user_id and fl.follower_id = (select uid from viewer)
  left join post_likes lk     on lk.post_id = c.id and lk.user_id = (select uid from viewer)
  left join post_bookmarks bk on bk.post_id = c.id and bk.user_id = (select uid from viewer)
  left join post_reposts rp   on rp.post_id = c.id and rp.user_id = (select uid from viewer)
  left join post_seen sn      on sn.post_id = c.id and sn.user_id = (select uid from viewer)
  left join affinity af       on af.author_id = c.user_id
),
base as (
  select e.*,
    (exists (select 1 from trending_snapshot ts
             where ts.kind = 'post' and ts.ref_id = e.id)) as trending,
    case
      when p_mode in ('for_you', 'innovation') then
        ( (coalesce(e.likes_count,0) * 1.0)
        + (coalesce(e.comments_count,0) * 2.5)
        + (coalesce(e.reposts_count,0) * 2.0) + 1.0 )
        / power((extract(epoch from (now() - e.created_at)) / 3600.0) + 2.0, 1.5)
        * (case when e.follows then 3.0 else 1.0 end)
        * (1.0 + least(e.affinity_n, 5) * 0.15)
        * (case when e.seen then 0.15 else 1.0 end)
      when p_mode = 'trending' then
        10000.0 - coalesce((select ts.rank from trending_snapshot ts
                    where ts.kind = 'post' and ts.ref_id = e.id), 9999)
      else extract(epoch from e.created_at)
    end as raw_score
  from enriched e
),
diversified as (
  select b.*,
    case when p_mode in ('for_you', 'trending', 'innovation')
      then b.raw_score * power(0.55::double precision,
             (row_number() over (partition by b.user_id order by b.raw_score desc) - 1))
      else b.raw_score
    end as sort_key
  from base b
)
select d.id, d.user_id, d.content, d.body, d.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = d.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', pp.id, 'title', pp.title, 'subtitle', pp.subtitle,
      'price', pp.price, 'currency', pp.currency, 'image_url', pp.image_url,
      'listing_id', pp.listing_id, 'link_url', pp.link_url,
      'cta_label', pp.cta_label, 'sort_order', pp.sort_order,
      'listing_status', ml.status)
      order by pp.sort_order)
    from post_products pp
    left join marketplace_listings ml on ml.id = pp.listing_id
    where pp.post_id = d.id
      and (ml.id is null or ml.status = 'available' or d.user_id = (select uid from viewer))), '[]'::jsonb),
  case when lp.url is not null then jsonb_build_object(
      'url', lp.url, 'title', lp.title, 'description', lp.description,
      'image_url', lp.image_url, 'domain', lp.domain)
    else null end,
  d.channel, d.article_title, d.read_minutes, d.quoted_post_id, d.thread_parent_id,
  d.created_at, d.likes_count, d.comments_count, d.reposts_count, d.bookmarks_count,
  d.views_count, d.trending,
  d.full_name, d.username, d.avatar_url, d.is_verified, d.account_type, d.verified_tier,
  d.liked, d.bookmarked, d.reposted, d.follows, d.sort_key,
  d.innovation_field, d.innovation_stage
from diversified d
left join link_previews lp on lp.url = d.link_url
where p_cursor_key is null or (d.sort_key, d.id) < (p_cursor_key, p_cursor_id)
order by d.sort_key desc, d.id desc
limit least(coalesce(p_limit, 20), 50);
$function$
;

CREATE OR REPLACE FUNCTION public.get_groups_in_common(p_other_id uuid)
 RETURNS TABLE(conversation_id uuid, group_name text, group_avatar_url text, member_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select c.id, c.group_name, c.group_avatar_url,
         (select count(*)::int from conversation_members m3 where m3.conversation_id = c.id)
  from conversations c
  where coalesce(c.is_group, false) = true
    and exists (select 1 from conversation_members m1
                where m1.conversation_id = c.id and m1.user_id = auth.uid())
    and exists (select 1 from conversation_members m2
                where m2.conversation_id = c.id and m2.user_id = p_other_id)
  order by c.group_name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_highlight_stories(p_highlight_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, media_url text, media_type text, thumbnail_url text, duration_sec integer, caption text, scope text, views_count integer, expires_at timestamp with time zone, created_at timestamp with time zone, is_viewed boolean, stickers_json jsonb, text_background jsonb, media_transform jsonb, category text, dual_front_url text, dual_layout jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    s.id,
    s.user_id,
    s.media_url,
    s.media_type::text,
    s.thumbnail_url,
    s.duration_sec,
    s.caption,
    s.scope::text,
    s.views_count,
    s.expires_at,
    s.created_at,
    exists (
      select 1 from public.story_views sv
      where sv.story_id = s.id and sv.user_id = auth.uid()
    ) as is_viewed,
    s.stickers_json,
    s.text_background,
    s.media_transform,
    s.category,
    s.dual_front_url,
    s.dual_layout
  FROM story_highlight_items hi
  JOIN stories s ON s.id = hi.story_id
  WHERE hi.highlight_id = p_highlight_id
  ORDER BY hi.sort_order ASC, s.created_at ASC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_incoming_mentorship_requests()
 RETURNS TABLE(request_id uuid, mentee_id uuid, full_name text, username text, avatar_url text, headline text, message text, focus_areas text[], requested_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    r.id as request_id,
    r.mentee_id,
    p.full_name,
    p.username,
    p.avatar_url,
    p.headline,
    r.message,
    r.focus_areas,
    r.requested_at
  from public.mentorship_requests r
  join public.profiles p on p.id = r.mentee_id
  where r.mentor_id = auth.uid() and r.status = 'pending'
  order by r.requested_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.get_join_requests(p_community uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, message text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.user_id, p.full_name, p.username, p.avatar_url, r.message, r.created_at
  from community_join_requests r
  join profiles p on p.id = r.user_id
  where r.community_id = p_community
    and exists (select 1 from community_members m where m.community_id = p_community and m.user_id = auth.uid() and m.role in ('owner','moderator'))
  order by r.created_at asc
  limit least(coalesce(p_limit, 50), 200);
$function$
;

CREATE OR REPLACE FUNCTION public.get_market_feed(p_category text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS SETOF marketplace_listings
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select l.*
  from marketplace_listings l
  where l.status = 'available'
    and l.hidden_at is null
    and (p_category is null or l.category = p_category)
    and (p_search is null or l.title ilike '%' || p_search || '%'
         or l.description ilike '%' || p_search || '%')
  order by
    (p_city is not null and l.location_city ilike p_city) desc,
    l.created_at desc
  limit p_limit offset p_offset;
$function$
;

CREATE OR REPLACE FUNCTION public.get_memory_album(p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select jsonb_build_object(
  'id', a.id,
  'is_default', true,
  'is_owner', auth.uid() = p_owner,
  'can_view', can_view_memory_album(p_owner),
  'title', coalesce(a.title, 'Memories'),
  'cover_color', coalesce(a.cover_color, 'blush'),
  'audience', coalesce(a.audience, 'profile'),
  'count', (select count(*) from memory_pages mp where mp.album_id = a.id),
  'pages', case when can_view_memory_album(p_owner) then
    coalesce((select jsonb_agg(jsonb_build_object(
        'id', mp.id, 'media_url', mp.media_url, 'media_type', mp.media_type,
        'thumbnail_url', mp.thumbnail_url, 'caption', mp.caption, 'style', mp.style,
        'taken_at', mp.taken_at, 'sort_order', mp.sort_order)
        order by mp.sort_order, mp.created_at)
      from memory_pages mp where mp.album_id = a.id), '[]'::jsonb)
    else '[]'::jsonb end
)
from (select 1) one
left join memory_albums a on a.user_id = p_owner and a.is_default;
$function$
;

CREATE OR REPLACE FUNCTION public.get_memory_albums(p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select jsonb_build_object(
  'is_owner', auth.uid() = p_owner,
  'can_view', can_view_memory_album(p_owner),
  'books', case when auth.uid() = p_owner or can_view_memory_album(p_owner) then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', coalesce(a.title, 'Memories'),
      'cover_color', coalesce(a.cover_color, 'blush'), 'is_default', a.is_default,
      'count', (select count(*) from memory_pages mp where mp.album_id = a.id))
      order by a.is_default desc, a.created_at)
    from memory_albums a where a.user_id = p_owner), '[]'::jsonb)
  else '[]'::jsonb end
);
$function$
;

CREATE OR REPLACE FUNCTION public.get_memory_book(p_album uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  alb memory_albums%rowtype;
  uid uuid;
  owner boolean;
  viewable boolean;
  pgs jsonb;
begin
  uid := auth.uid();
  select * into alb from memory_albums where id = p_album;
  if not found then
    return jsonb_build_object('can_view', false, 'is_owner', false, 'count', 0, 'pages', '[]'::jsonb);
  end if;
  owner := (alb.user_id = uid);
  viewable := owner
    or (coalesce(alb.audience, 'profile') = 'profile' and (
          coalesce((select pr.profile_visibility from profiles pr where pr.id = alb.user_id), 'public') <> 'private'
          or exists (select 1 from follows f where f.follower_id = uid and f.following_id = alb.user_id)))
    or (alb.audience = 'followers' and exists (select 1 from follows f where f.follower_id = uid and f.following_id = alb.user_id));
  if viewable then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', mp.story_id,
      'story_id', mp.story_id,
      'sort_order', 0,
      'media_url', s.media_url,
      'media_type', s.media_type,
      'thumbnail_url', s.thumbnail_url,
      'caption', coalesce(to_jsonb(mp)->>'caption', ''),
      'taken_at', s.created_at,
      'story_caption', s.caption,
      'text_background', s.text_background,
      'stickers', s.stickers_json,
      'duration_sec', s.duration_sec,
      'dual_front_url', s.dual_front_url,
      'audio_url', s.audio_url,
      'audio_title', s.audio_title
    ) order by s.created_at asc), '[]'::jsonb)
    into pgs
    from memory_pages mp join stories s on s.id = mp.story_id
    where mp.album_id = p_album;
  else
    pgs := '[]'::jsonb;
  end if;
  return jsonb_build_object(
    'id', alb.id, 'user_id', alb.user_id, 'title', alb.title,
    'cover_color', alb.cover_color, 'audience', alb.audience,
    'is_owner', owner, 'can_view', viewable,
    'count', jsonb_array_length(pgs), 'pages', pgs
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.get_mentorship_detail(p_mentorship_id uuid)
 RETURNS TABLE(mentorship_id uuid, mentor_id uuid, mentee_id uuid, mentor_name text, mentor_username text, mentor_avatar text, mentee_name text, mentee_username text, mentee_avatar text, mentor_kind text, conversation_id uuid, status text, started_at timestamp with time zone, ended_at timestamp with time zone, end_reason text, my_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    m.id,
    m.mentor_id,
    m.mentee_id,
    pm.full_name,
    pm.username,
    pm.avatar_url,
    pe.full_name,
    pe.username,
    pe.avatar_url,
    mp.mentor_kind,
    m.conversation_id,
    m.status,
    m.started_at,
    m.ended_at,
    m.end_reason,
    case when m.mentor_id = auth.uid() then 'mentor' else 'mentee' end
  from public.mentorships m
  join public.profiles pm on pm.id = m.mentor_id
  join public.profiles pe on pe.id = m.mentee_id
  left join public.mentor_profiles mp on mp.profile_id = m.mentor_id
  where m.id = p_mentorship_id
    and (m.mentor_id = auth.uid() or m.mentee_id = auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.get_message_requests()
 RETURNS TABLE(conversation_id uuid, sender_id uuid, sender_name text, sender_username text, sender_avatar_url text, sender_institution_name text, requested_at timestamp with time zone, last_message_preview text, last_message_time timestamp with time zone, unread_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with my_pending as (
    select c.*
    from public.conversations c
    where c.is_group = false
      and c.request_status = 'pending'
      and c.request_sender_id is not null
      and c.request_sender_id <> auth.uid()
      and (c.user_1 = auth.uid() or c.user_2 = auth.uid())
  )
  select
    mp.id as conversation_id,
    mp.request_sender_id as sender_id,
    p.full_name as sender_name,
    p.username as sender_username,
    p.avatar_url as sender_avatar_url,
    null::text as sender_institution_name,
    mp.requested_at,
    mp.last_message as last_message_preview,
    mp.last_message_time,
    (
      select count(*)::int
      from public.messages m
      where m.conversation_id = mp.id
        and m.sender_id = mp.request_sender_id
        and not exists (
          select 1 from public.message_reads mr
          where mr.message_id = m.id and mr.user_id = auth.uid()
        )
    ) as unread_count
  from my_pending mp
  join public.profiles p on p.id = mp.request_sender_id
  order by mp.requested_at desc nulls last;
$function$
;

CREATE OR REPLACE FUNCTION public.get_moment_feed(p_prompt_id uuid)
 RETURNS TABLE(post_id uuid, story_id uuid, user_id uuid, is_late boolean, late_seconds integer, posted_at timestamp with time zone, full_name text, username text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    mp.id as post_id,
    mp.story_id,
    mp.user_id,
    mp.is_late,
    mp.late_seconds,
    mp.posted_at,
    pr.full_name,
    pr.username,
    pr.avatar_url
  FROM campus_moment_posts mp
  JOIN profiles pr ON pr.id = mp.user_id
  WHERE mp.prompt_id = p_prompt_id
  ORDER BY mp.is_late ASC, mp.posted_at ASC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_account_type()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT COALESCE(account_type, 'public')
  FROM public.profiles
  WHERE id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_actors()
 RETURNS TABLE(actor_id uuid, full_name text, username text, avatar_url text, kind text, role text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.full_name, p.username, p.avatar_url, 'personal'::text, 'self'::text
  from profiles p where p.id = auth.uid()
  union all
  select p.id, p.full_name, p.username, p.avatar_url, 'business'::text, m.role
  from business_members m
  join profiles p on p.id = m.business_id
  where m.member_id = auth.uid()
  -- Positional: in a UNION, ORDER BY cannot reference RETURNS TABLE output
  -- names. Column 5 is kind, column 2 is full_name.
  order by 5, 2;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_businesses()
 RETURNS TABLE(business_id uuid, full_name text, username text, avatar_url text, role text, category text, is_verified boolean, member_count integer, post_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.full_name, p.username, p.avatar_url, m.role,
         b.category, coalesce(b.is_verified, false),
         (select count(*)::int from business_members m2 where m2.business_id = p.id),
         (select count(*)::int from posts po where po.user_id = p.id)
  from business_members m
  join profiles p on p.id = m.business_id
  left join business_profiles b on b.profile_id = p.id
  where m.member_id = auth.uid()
  order by p.full_name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_sticker_response(p_story_id uuid, p_sticker_id text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_result story_sticker_responses;
BEGIN
  SELECT * INTO v_result
  FROM story_sticker_responses
  WHERE story_id = p_story_id
    AND sticker_id = p_sticker_id
    AND user_id = auth.uid();

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN row_to_json(v_result);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_story_reactions(p_story_id uuid)
 RETURNS TABLE(emoji text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT sr.emoji
  FROM story_reactions sr
  WHERE sr.story_id = p_story_id
    AND sr.user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_verified_status()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT COALESCE(
    (SELECT is_verified_school_user FROM public.profiles WHERE id = auth.uid()),
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.get_notifications(p_limit integer DEFAULT 50, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(notification_id uuid, type text, message text, body_preview text, data jsonb, read_at timestamp with time zone, created_at timestamp with time zone, actor_id uuid, actor_name text, actor_username text, actor_avatar text, others_count integer, other_avatars text[], post_id uuid, post_thumb text, post_text text, viewer_follows boolean, unread_in_group integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with mine as (
  select n.id, n.type, n.message, n.body_preview, n.data, n.read_at, n.created_at,
         n.actor_id,
         nullif(n.data->>'post_id', '')::uuid as pid
  from notifications n
  where n.recipient_id = auth.uid()
    and n.type not in ('message', 'incoming_call', 'missed_call',
                       'connection_request', 'connection_accepted')
    and (p_cursor is null or n.created_at < p_cursor)
),
keyed as (
  select m.*,
    case
      -- engagement on one post
      when m.type in ('like', 'repost', 'comment_like') and m.pid is not null
        then m.type || ':' || m.pid::text
      -- people doing the same thing to you
      when m.type in ('follow', 'follow_request', 'story_reaction')
        then m.type || ':bucket'
      else 'x:' || m.id::text
    end as gkey
  from mine m
),
agg as (
  select gkey,
    (array_agg(id order by created_at desc))[1]           as id,
    (array_agg(type order by created_at desc))[1]         as type,
    (array_agg(message order by created_at desc))[1]      as message,
    (array_agg(body_preview order by created_at desc))[1] as body_preview,
    (array_agg(data order by created_at desc))[1]         as data,
    min(read_at)                                          as read_at,
    max(created_at)                                       as created_at,
    (array_agg(actor_id order by created_at desc))[1]     as actor_id,
    (array_agg(pid order by created_at desc))[1]          as pid,
    count(distinct actor_id)::int                         as actor_count,
    count(*) filter (where read_at is null)::int          as unread_n,
    array_agg(distinct actor_id)                          as actor_ids
  from keyed
  group by gkey
)
select
  a.id, a.type, a.message, a.body_preview, a.data, a.read_at, a.created_at,
  a.actor_id, pr.full_name, pr.username, pr.avatar_url,
  greatest(a.actor_count - 1, 0),
  coalesce((
    select array_agg(p2.avatar_url)
    from (select unnest(a.actor_ids) as aid limit 3) x
    join profiles p2 on p2.id = x.aid
    where p2.avatar_url is not null
  ), '{}'::text[]),
  a.pid,
  (select coalesce(
     (select m.url from post_media m where m.post_id = a.pid order by m.sort_order nulls last limit 1),
     (select p.media_url from posts p where p.id = a.pid))),
  (select left(coalesce(p.content, p.body, ''), 90) from posts p where p.id = a.pid),
  exists (select 1 from follows f
          where f.follower_id = auth.uid() and f.following_id = a.actor_id),
  a.unread_n
from agg a
left join profiles pr on pr.id = a.actor_id
order by a.created_at desc
limit least(coalesce(p_limit, 50), 100);
$function$
;

CREATE OR REPLACE FUNCTION public.get_or_create_group_conversation(p_group_type text, p_group_id uuid, p_group_name text, p_group_emoji text, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_outgoing_mentorship_requests()
 RETURNS TABLE(request_id uuid, mentor_id uuid, full_name text, username text, avatar_url text, mentor_kind text, status text, message text, requested_at timestamp with time zone, responded_at timestamp with time zone, response_note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    r.id as request_id,
    r.mentor_id,
    p.full_name,
    p.username,
    p.avatar_url,
    mp.mentor_kind,
    r.status,
    r.message,
    r.requested_at,
    r.responded_at,
    r.response_note
  from public.mentorship_requests r
  join public.profiles p on p.id = r.mentor_id
  left join public.mentor_profiles mp on mp.profile_id = r.mentor_id
  where r.mentee_id = auth.uid()
  order by r.requested_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.get_payments_by_ids(p_ids uuid[])
 RETURNS TABLE(payment_id uuid, sender_id uuid, recipient_id uuid, amount numeric, currency text, status text, note text, listing_id uuid, listing_title text, created_at timestamp with time zone, completed_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.sender_id, p.recipient_id, p.amount, p.currency, p.status,
         p.note, p.listing_id, l.title, p.created_at, p.completed_at
  from chat_payments p
  left join marketplace_listings l on l.id = p.listing_id
  where p.id = any(p_ids)
    and (p.sender_id = auth.uid() or p.recipient_id = auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.get_poll(p_post_id uuid)
 RETURNS TABLE(option_id uuid, label text, votes integer, viewer_vote uuid, ends_at timestamp with time zone, total integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select o.id, o.label,
  (select count(*)::int from post_poll_votes v where v.option_id = o.id),
  (select mv.option_id from post_poll_votes mv where mv.post_id = p_post_id and mv.voter_id = auth.uid()),
  pl.ends_at,
  (select count(*)::int from post_poll_votes v2 where v2.post_id = p_post_id)
from post_poll_options o
join post_polls pl on pl.post_id = o.post_id
where o.post_id = p_post_id
order by o.sort_order;
$function$
;

CREATE OR REPLACE FUNCTION public.get_post_insights(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_author uuid;
  v_reach  int;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select user_id into v_author from posts where id = p_post_id;
  if v_author is null then raise exception 'Post not found'; end if;
  if not can_act_as(v_author) then
    raise exception 'Insights are only visible to the author';
  end if;

  select count(distinct user_id)::int into v_reach
  from post_seen where post_id = p_post_id;

  select jsonb_build_object(
    'reach',           v_reach,
    'likes',           coalesce(p.likes_count, 0),
    'comments',        coalesce(p.comments_count, 0),
    'reposts',         coalesce(p.reposts_count, 0),
    'bookmarks',       coalesce(p.bookmarks_count, 0),
    'engagements',     coalesce(p.likes_count,0) + coalesce(p.comments_count,0)
                       + coalesce(p.reposts_count,0) + coalesce(p.bookmarks_count,0),
    'engagement_rate', case when v_reach > 0 then
                         round(((coalesce(p.likes_count,0) + coalesce(p.comments_count,0)
                               + coalesce(p.reposts_count,0) + coalesce(p.bookmarks_count,0))::numeric
                               / v_reach) * 100, 1)
                       else null end,
    'posted_at',       p.created_at,
    'video',           case when exists (
                              select 1 from post_media m
                              where m.post_id = p_post_id and m.media_type = 'video')
                         then (
                           select jsonb_build_object(
                             'unique_viewers', count(distinct coalesce(viewer_id::text, 'session:' || session_id))
                                                 filter (where duration_sec >= 3),
                             'total_plays',    count(*),
                             'avg_seconds',    round(coalesce(avg(duration_sec) filter (where duration_sec >= 3), 0)::numeric, 1)
                           ) from post_video_views where post_id = p_post_id)
                         else null end,
    'recent_likers',   coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'id', pr.id, 'full_name', pr.full_name,
                                  'username', pr.username, 'avatar_url', pr.avatar_url)
                                order by pl.created_at desc)
                         from post_likes pl
                         join profiles pr on pr.id = pl.user_id
                         where pl.post_id = p_post_id
                         limit 12), '[]'::jsonb)
  ) into v_result
  from posts p where p.id = p_post_id;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_post_video_stats(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'unique_viewers', count(distinct coalesce(viewer_id::text, 'session:' || session_id))
                        filter (where duration_sec >= 3),
    'total_plays',    count(*),
    'avg_seconds',    round(coalesce(avg(duration_sec) filter (where duration_sec >= 3), 0)::numeric, 1),
    'max_seconds',    coalesce(max(duration_sec), 0)
  )
  from post_video_views
  where post_id = p_post_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_posts_by_hashtag(p_tag text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, user_id uuid, content text, likes_count integer, comments_count integer, reposts_count integer, created_at timestamp with time zone, author_name text, author_avatar text, author_username text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH clean_tag AS (
    SELECT lower(regexp_replace(p_tag, '[^#A-Za-z0-9_]', '', 'g')) AS val
  ),
  matching AS (
    SELECT
      p.id,
      p.user_id,
      p.content,
      p.likes_count,
      p.comments_count,
      p.reposts_count,
      p.created_at
    FROM posts p, clean_tag ct
    WHERE p.content ~* (regexp_replace(ct.val, '([.*+?^${}()|[\]\\])', '\\\1', 'g') || '(?![A-Za-z0-9_])')
      AND p.content IS NOT NULL
      AND p.community_id IS NULL
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT
    m.id,
    m.user_id,
    m.content,
    m.likes_count,
    m.comments_count,
    m.reposts_count,
    m.created_at,
    coalesce(pr.full_name, 'User') AS author_name,
    pr.avatar_url AS author_avatar,
    pr.username AS author_username
  FROM matching m
  LEFT JOIN profiles pr ON pr.id = m.user_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_profile(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_row profiles;
  v_follows boolean;
  v_requested boolean;
  v_reach int;
  v_result jsonb;
begin
  select * into v_row from profiles where id = p_profile_id;
  if v_row.id is null then raise exception 'Profile not found'; end if;

  v_follows := exists (select 1 from follows
                       where follower_id = v_me and following_id = p_profile_id);
  v_requested := exists (select 1 from follow_requests
                         where requester_id = v_me and target_id = p_profile_id
                           and status = 'pending');

  if v_me = p_profile_id then
    select count(distinct s.user_id) into v_reach
    from post_seen s join posts p on p.id = s.post_id
    where p.user_id = p_profile_id;
  else
    v_reach := null;
  end if;

  select jsonb_build_object(
    'id', v_row.id,
    'full_name', v_row.full_name,
    'username', v_row.username,
    'avatar_url', v_row.avatar_url,
    'banner_url', v_row.banner_url,
    'bio', v_row.bio,
    'headline', v_row.headline,
    'workplace', v_row.workplace,
    'location', v_row.location,
    'email', v_row.email,
    'role', v_row.role,
    'degree_program', v_row.degree_program,
    'profile_visibility', coalesce(v_row.profile_visibility, 'public'),
    'account_type', coalesce(v_row.account_type, 'personal'),
    'is_verified', coalesce(v_row.is_verified, false),
    'verified_tier', v_row.verified_tier,
    'verified_category', v_row.verified_category,
    'joined_at', v_row.created_at,
    'created_at', v_row.created_at,
    'is_self', (v_me = p_profile_id),
    'viewer_follows', v_follows,
    'viewer_requested', v_requested,
    'can_view_content', (v_me = p_profile_id)
                          or coalesce(v_row.profile_visibility, 'public') <> 'private'
                          or v_follows,
    'counts', jsonb_build_object(
      'posts',     (select count(*) from posts   where user_id = p_profile_id),
      'followers', (select count(*) from follows where following_id = p_profile_id),
      'following', (select count(*) from follows where follower_id = p_profile_id),
      'reach',     v_reach,
      'media',     (select count(*) from posts p2
                     where p2.user_id = p_profile_id
                       and (p2.media_url is not null
                            or exists (select 1 from post_media m where m.post_id = p2.id))),
      'reposts',   (select count(*) from post_reposts   where user_id = p_profile_id),
      'saved',     (select count(*) from post_bookmarks where user_id = p_profile_id),
      'listings',  (select count(*) from marketplace_listings
                     where seller_id = p_profile_id and status = 'available')
    ),
    'seller_rating', (select jsonb_build_object(
                        'avg', round(coalesce(avg(rating), 0)::numeric, 1),
                        'count', count(*))
                      from seller_reviews where seller_id = p_profile_id),
    'business', case when coalesce(v_row.account_type, 'personal') = 'business' then (
      select jsonb_build_object(
        'category', b.category, 'address', b.address, 'phone', b.phone,
        'email', b.email, 'website', b.website, 'social_links', b.social_links,
        'hours', b.hours,
        'avg_rating', b.avg_rating, 'review_count', b.review_count,
        'is_verified', b.is_verified)
      from business_profiles b where b.profile_id = p_profile_id
    ) else null end,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'full_name', pr.full_name,
               'username', pr.username, 'avatar_url', pr.avatar_url, 'role', m.role))
      from business_members m
      join profiles pr on pr.id = m.member_id
      where m.business_id = p_profile_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_profile_context(p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid;
  names text[];
  cnt int;
begin
  uid := auth.uid();
  if uid is null then return jsonb_build_object('mutual_names', '{}'::text[], 'mutual_count', 0); end if;
  if uid <> p_profile then
    insert into profile_views (profile_id, viewer_id) values (p_profile, uid)
    on conflict (profile_id, viewer_id, day) do nothing;
  end if;
  select count(*) into cnt
    from follows f1 join follows f2 on f2.follower_id = f1.following_id and f2.following_id = p_profile
    where f1.follower_id = uid and f1.following_id <> uid and f1.following_id <> p_profile;
  select array_agg(nm) into names from (
    select coalesce(p.full_name, '@' || p.username) as nm
      from follows f1
      join follows f2 on f2.follower_id = f1.following_id and f2.following_id = p_profile
      join profiles p on p.id = f1.following_id
      where f1.follower_id = uid and f1.following_id <> uid and f1.following_id <> p_profile
      limit 2) t;
  return jsonb_build_object('mutual_names', coalesce(names, '{}'::text[]), 'mutual_count', coalesce(cnt, 0));
end $function$
;

CREATE OR REPLACE FUNCTION public.get_profile_insights(p_profile uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when auth.uid() = p_profile then jsonb_build_object(
    'views_7d',  (select count(*) from profile_views where profile_id = p_profile and day > current_date - 7),
    'views_30d', (select count(*) from profile_views where profile_id = p_profile and day > current_date - 30),
    'unique_30d',(select count(distinct viewer_id) from profile_views where profile_id = p_profile and day > current_date - 30),
    'new_followers_7d', (select count(*) from follows where following_id = p_profile and created_at > now() - interval '7 days')
  ) else null end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_profile_posts(p_profile_id uuid, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 20)
 RETURNS TABLE(post_id uuid, content text, body text, media_url text, media jsonb, products jsonb, channel text, article_title text, read_minutes integer, created_at timestamp with time zone, likes_count integer, comments_count integer, reposts_count integer, bookmarks_count integer, views_count integer, viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean, is_pinned boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with viewer as (select auth.uid() as uid),
allowed as (
  select ((select uid from viewer) = p_profile_id)
      or coalesce(pr.profile_visibility, 'public') <> 'private'
      or exists (select 1 from follows f
                 where f.follower_id = (select uid from viewer)
                   and f.following_id = p_profile_id) as ok
  from profiles pr where pr.id = p_profile_id
),
pin as (select pinned_post_id from profiles where id = p_profile_id)
select p.id, p.content, p.body, p.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height,
      'alt_text', m.alt_text, 'is_sensitive', m.is_sensitive,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = p.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', pp.id, 'title', pp.title, 'subtitle', pp.subtitle, 'price', pp.price,
      'currency', pp.currency, 'image_url', pp.image_url, 'listing_id', pp.listing_id,
      'link_url', pp.link_url, 'cta_label', pp.cta_label, 'sort_order', pp.sort_order,
      'listing_status', ml.status)
      order by pp.sort_order)
    from post_products pp
    left join marketplace_listings ml on ml.id = pp.listing_id
    where pp.post_id = p.id), '[]'::jsonb),
  p.channel, p.article_title, p.read_minutes, p.created_at,
  p.likes_count, p.comments_count, p.reposts_count, p.bookmarks_count, p.views_count,
  (lk.user_id is not null), (bk.user_id is not null), (rp.user_id is not null),
  (p.id = (select pinned_post_id from pin))
from posts p
left join post_likes lk     on lk.post_id = p.id and lk.user_id = (select uid from viewer)
left join post_bookmarks bk on bk.post_id = p.id and bk.user_id = (select uid from viewer)
left join post_reposts rp   on rp.post_id = p.id and rp.user_id = (select uid from viewer)
where p.user_id = p_profile_id
  and p.community_id is null
  and (select ok from allowed)
  and not exists (select 1 from blocked_users b
                  where (b.blocker_id = (select uid from viewer) and b.blocked_id = p.user_id)
                     or (b.blocker_id = p.user_id and b.blocked_id = (select uid from viewer)))
  and (
    coalesce(p.audience, 'everyone') = 'everyone'
    or p.user_id = (select uid from viewer)
    or (p.audience = 'followers' and exists (
          select 1 from follows f
          where f.following_id = p.user_id and f.follower_id = (select uid from viewer)))
    or (p.audience = 'mentioned' and exists (
          select 1 from post_mentions pm
          where pm.post_id = p.id and pm.mentioned_user_id = (select uid from viewer)))
    or (p.audience = 'verified' and exists (
          select 1 from profiles vp
          where vp.id = (select uid from viewer) and vp.is_verified))
  )
  and (p_cursor is null or p.created_at < p_cursor)
order by (case when p_cursor is null and p.id = (select pinned_post_id from pin) then 0 else 1 end),
         p.created_at desc
limit least(coalesce(p_limit, 20), 50);
$function$
;

CREATE OR REPLACE FUNCTION public.get_profile_reach_28d(p_profile_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(distinct u)::int from (
    select s.user_id as u
    from post_seen s
    join posts p on p.id = s.post_id
    where p.user_id = p_profile_id
      and s.seen_at > now() - interval '28 days'
      and s.user_id <> p_profile_id
    union
    select v.user_id
    from story_views v
    join stories st on st.id = v.story_id
    where st.user_id = p_profile_id
      and v.viewed_at > now() - interval '28 days'
      and v.user_id <> p_profile_id
  ) x;
$function$
;

CREATE OR REPLACE FUNCTION public.get_recent_likers(post_ids uuid[])
 RETURNS TABLE(post_id uuid, liker_names text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.pid as post_id,
         array_agg(x.name order by x.liked_at desc) as liker_names
  from unnest(post_ids) as p(pid)
  cross join lateral (
    select coalesce(nullif(pr.full_name, ''), pr.username, 'Someone') as name,
           pl.created_at as liked_at
    from public.post_likes pl
    join public.profiles pr on pr.id = pl.user_id
    where pl.post_id = p.pid
    order by pl.created_at desc
    limit 2
  ) x
  group by p.pid;
$function$
;

CREATE OR REPLACE FUNCTION public.get_seller_listings(p_seller_id uuid, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 20, p_include_sold boolean DEFAULT false)
 RETURNS TABLE(listing_id uuid, title text, description text, price numeric, currency text, category text, condition text, location_city text, images text[], status text, delivery_available boolean, delivery_fee numeric, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select l.id, l.title, l.description, l.price, l.currency, l.category, l.condition,
         l.location_city, l.images, l.status,
         l.delivery_available, l.delivery_fee, l.created_at
  from marketplace_listings l
  where l.seller_id = p_seller_id
    and (p_include_sold or l.status = 'available')
    and (p_cursor is null or l.created_at < p_cursor)
  order by l.created_at desc
  limit least(coalesce(p_limit, 20), 50);
$function$
;

CREATE OR REPLACE FUNCTION public.get_seller_rating(p_seller_id uuid)
 RETURNS TABLE(avg_rating numeric, review_count integer, five integer, four integer, three integer, two integer, one integer)
 LANGUAGE sql
 STABLE
AS $function$
  select round(avg(rating)::numeric, 2), count(*)::int,
    count(*) filter (where rating = 5)::int, count(*) filter (where rating = 4)::int,
    count(*) filter (where rating = 3)::int, count(*) filter (where rating = 2)::int,
    count(*) filter (where rating = 1)::int
  from public.seller_reviews where seller_id = p_seller_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_startup_interest_counts()
 RETURNS TABLE(startup_id uuid, count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT si.startup_id, COUNT(*)::bigint
  FROM public.startup_interest si
  GROUP BY si.startup_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_sticker_responses(p_story_id uuid, p_sticker_id text)
 RETURNS TABLE(id uuid, story_id uuid, sticker_id text, user_id uuid, response_type text, text_value text, number_value numeric, option_id text, created_at timestamp with time zone, full_name text, username text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    r.id,
    r.story_id,
    r.sticker_id,
    r.user_id,
    r.response_type,
    r.text_value,
    r.number_value,
    r.option_id,
    r.created_at,
    p.full_name,
    p.username,
    p.avatar_url
  FROM story_sticker_responses r
  JOIN profiles p ON p.id = r.user_id
  WHERE r.story_id = p_story_id AND r.sticker_id = p_sticker_id
  ORDER BY r.created_at DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_story_poll(p_story_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_poll record;
  v_options jsonb;
  v_my_vote uuid;
  v_total bigint;
BEGIN
  -- Find poll (RLS enforces visibility)
  SELECT id, story_id, question, nx, ny, scale
  INTO v_poll
  FROM story_polls
  WHERE story_id = p_story_id;

  IF v_poll IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get caller's current vote
  SELECT option_id INTO v_my_vote
  FROM story_poll_votes
  WHERE poll_id = v_poll.id AND user_id = auth.uid();

  -- Get total votes
  SELECT count(*) INTO v_total
  FROM story_poll_votes
  WHERE poll_id = v_poll.id;

  -- Get options with vote counts
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'label', o.label,
      'position', o.position,
      'vote_count', (
        SELECT count(*) FROM story_poll_votes v
        WHERE v.option_id = o.id
      )
    ) ORDER BY o.position
  ) INTO v_options
  FROM story_poll_options o
  WHERE o.poll_id = v_poll.id;

  RETURN jsonb_build_object(
    'poll_id', v_poll.id,
    'story_id', v_poll.story_id,
    'question', v_poll.question,
    'nx', v_poll.nx,
    'ny', v_poll.ny,
    'scale', v_poll.scale,
    'options', COALESCE(v_options, '[]'::jsonb),
    'my_vote', v_my_vote,
    'total_votes', v_total
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_story_poll_voters(p_poll_id uuid, p_option_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid;
  v_voters jsonb;
BEGIN
  -- Verify caller owns the story behind this poll
  SELECT s.user_id INTO v_owner_id
  FROM story_polls sp
  JOIN stories s ON s.id = sp.story_id
  WHERE sp.id = p_poll_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Poll not found';
  END IF;

  IF v_owner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the story owner can view voters';
  END IF;

  -- Verify option belongs to poll
  IF NOT EXISTS (
    SELECT 1 FROM story_poll_options
    WHERE id = p_option_id AND poll_id = p_poll_id
  ) THEN
    RAISE EXCEPTION 'Option does not belong to this poll';
  END IF;

  -- Get voters with profile info
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', p.id,
      'full_name', p.full_name,
      'username', p.username,
      'avatar_url', p.avatar_url,
      'voted_at', v.updated_at
    ) ORDER BY v.updated_at DESC
  ) INTO v_voters
  FROM story_poll_votes v
  JOIN profiles p ON p.id = v.user_id
  WHERE v.poll_id = p_poll_id AND v.option_id = p_option_id;

  RETURN COALESCE(v_voters, '[]'::jsonb);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_story_reactions(p_story_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, emoji text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    sr.user_id,
    coalesce(p.full_name, 'User') AS full_name,
    p.username,
    p.avatar_url,
    sr.emoji,
    sr.created_at
  FROM story_reactions sr
  LEFT JOIN profiles p ON p.id = sr.user_id
  WHERE sr.story_id = p_story_id
  ORDER BY sr.created_at DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_story_viewers(p_story_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, viewed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    sv.user_id,
    p.full_name,
    p.username,
    p.avatar_url,
    sv.viewed_at
  from public.story_views sv
  join public.profiles p on p.id = sv.user_id
  where sv.story_id = p_story_id
    and exists (
      select 1 from public.stories s
      where s.id = p_story_id and s.user_id = auth.uid()
    )
  order by sv.viewed_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.get_trending_stories(p_limit integer DEFAULT 6)
 RETURNS TABLE(story_id uuid, user_id uuid, full_name text, username text, avatar_url text, views integer, reactions integer, heat numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select t.ref_id, t.user_id, p.full_name, p.username, p.avatar_url,
         t.uniq_engagers, 0, t.heat
  from trending_snapshot t
  join profiles p on p.id = t.user_id
  where t.kind = 'story'
  order by t.rank
  limit least(greatest(coalesce(p_limit, 6), 1), 6);
$function$
;

CREATE OR REPLACE FUNCTION public.get_trending_topics(p_days integer DEFAULT 7, p_limit integer DEFAULT 15)
 RETURNS TABLE(tag text, post_count integer, total_likes integer, total_comments integer, total_reposts integer, score double precision, unique_users integer, velocity integer, acceleration double precision, rep_post_id uuid, rep_content text, rep_author text)
 LANGUAGE sql
 STABLE
AS $function$
  with raw_matches as (
    select p.id as post_id, p.user_id,
      lower((regexp_matches(p.content, '#[A-Za-z0-9_]+', 'gi'))[1]) as raw_tag,
      p.likes_count, p.comments_count, p.reposts_count, p.created_at
    from posts p
    where p.created_at >= now() - make_interval(days => p_days)
      and p.content is not null and p.content ~ '#[A-Za-z0-9_]+'
    union all
    select s.id as post_id, s.user_id,
      '#' || lower(elem->>'hashtag') as raw_tag,
      0, 0, 0, s.created_at
    from stories s, jsonb_array_elements(coalesce(s.stickers_json, '[]'::jsonb)) elem
    where s.created_at >= now() - make_interval(days => p_days)
      and elem->>'kind' = 'hashtag'
      and coalesce(elem->>'hashtag', '') ~ '^[A-Za-z0-9_]+$'
  ),
  deduped as (
    select distinct on (user_id, raw_tag)
      post_id, user_id, raw_tag, likes_count, comments_count, reposts_count, created_at
    from raw_matches order by user_id, raw_tag, created_at asc
  ),
  grouped as (
    select d.raw_tag as tag, count(*)::int as post_count,
      count(distinct d.user_id)::int as unique_users,
      coalesce(sum(d.likes_count), 0)::int as total_likes,
      coalesce(sum(d.comments_count), 0)::int as total_comments,
      coalesce(sum(d.reposts_count), 0)::int as total_reposts,
      min(d.created_at) as earliest_at
    from deduped d group by d.raw_tag
    having count(distinct d.user_id) >= 2 and count(*) >= 2
  ),
  windows as (
    select d.raw_tag as tag,
      count(*) filter (where d.created_at >= now() - interval '24 hours')::int as vel_now,
      count(*) filter (where d.created_at >= now() - interval '48 hours'
                         and d.created_at <  now() - interval '24 hours')::int as vel_prev
    from deduped d group by d.raw_tag
  ),
  rep as (
    select distinct on (d.raw_tag) d.raw_tag as tag, d.post_id,
      p.content, pr.full_name
    from deduped d
    join posts p on p.id = d.post_id
    left join profiles pr on pr.id = d.user_id
    order by d.raw_tag, (coalesce(p.likes_count,0) * 2 + coalesce(p.comments_count,0) * 3 + coalesce(p.reposts_count,0) * 4) desc, p.created_at desc
  )
  select g.tag, g.post_count, g.total_likes, g.total_comments, g.total_reposts,
    (
      (g.unique_users * 6.0) + (g.post_count * 4.0) + (g.total_comments * 3.0)
      + (g.total_reposts * 5.0) + (g.total_likes * 1.0)
      + (coalesce(w.vel_now, 0) * 8.0)
      + (greatest(coalesce(w.vel_now,0) - coalesce(w.vel_prev,0), 0) * 10.0)
    ) * exp(-1.0 * extract(epoch from (now() - g.earliest_at)) / 3600.0 / 36.0) as score,
    g.unique_users,
    coalesce(w.vel_now, 0)::int as velocity,
    (coalesce(w.vel_now,0)::float - coalesce(w.vel_prev,0)::float) as acceleration,
    r.post_id as rep_post_id, r.content as rep_content, r.full_name as rep_author
  from grouped g
  left join windows w on w.tag = g.tag
  left join rep r on r.tag = g.tag
  where not exists (
    select 1 from public.trend_dismissals td
    where td.user_id = auth.uid() and td.tag = g.tag
  )
  order by score desc
  limit p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.get_unread_counts()
 RETURNS TABLE(conversation_id uuid, unread integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.conversation_id, count(*)::int
  from messages m
  where m.receiver_id = auth.uid()
    and m.sender_id <> auth.uid()
    and m.read_at is null
    and m.deleted_at is null
  group by m.conversation_id
  union all
  select m.conversation_id, count(*)::int
  from messages m
  join conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.deleted_at is null
    and m.created_at > cm.last_read_at
  group by m.conversation_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_unread_counts(p_user_id uuid)
 RETURNS TABLE(conversation_id uuid, unread_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select conversation_id, sum(unread_count)::bigint as unread_count
  from (
    -- DM branch
    select m.conversation_id, count(*)::bigint as unread_count
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.is_group = false
      and m.receiver_id = p_user_id
      and m.sender_id <> p_user_id
      and m.viewed_at is null
      and not exists (
        select 1
        from public.message_reads r
        where r.message_id = m.id
          and r.user_id = p_user_id
      )
    group by m.conversation_id

    union all

    -- Group branch
    select m.conversation_id, count(*)::bigint as unread_count
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.conversation_members cm
      on cm.conversation_id = c.id
     and cm.user_id = p_user_id
    where c.is_group = true
      and m.sender_id <> p_user_id
      and not exists (
        select 1
        from public.message_reads r
        where r.message_id = m.id
          and r.user_id = p_user_id
      )
    group by m.conversation_id
  ) t
  group by conversation_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_highlights(p_user_id uuid)
 RETURNS TABLE(id uuid, title text, cover_url text, sort_order integer, story_count bigint, latest_story_media_url text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    h.id,
    h.title,
    h.cover_url,
    h.sort_order,
    count(hi.id) as story_count,
    (
      SELECT s.media_url FROM story_highlight_items hi2
      JOIN stories s ON s.id = hi2.story_id
      WHERE hi2.highlight_id = h.id
      ORDER BY hi2.sort_order DESC
      LIMIT 1
    ) as latest_story_media_url,
    h.created_at
  FROM story_highlights h
  LEFT JOIN story_highlight_items hi ON hi.highlight_id = h.id
  WHERE h.user_id = p_user_id
  GROUP BY h.id
  ORDER BY h.sort_order ASC, h.created_at ASC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_stories(p_user_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, media_url text, media_type text, thumbnail_url text, duration_sec integer, caption text, scope text, views_count integer, expires_at timestamp with time zone, created_at timestamp with time zone, is_viewed boolean, stickers_json jsonb, text_background jsonb, media_transform jsonb, category text, dual_front_url text, dual_layout jsonb, allow_replies boolean, allow_reactions boolean, allow_sharing boolean, audio_url text, audio_title text, audio_source text, audio_duration_sec integer, filter_id text)
 LANGUAGE sql
 STABLE
AS $function$
  select s.id, s.user_id, s.media_url, s.media_type::text, s.thumbnail_url,
    s.duration_sec, s.caption, s.scope::text, s.views_count, s.expires_at, s.created_at,
    exists (select 1 from public.story_views sv where sv.story_id = s.id and sv.user_id = auth.uid()) as is_viewed,
    s.stickers_json, s.text_background, s.media_transform, s.category,
    s.dual_front_url, s.dual_layout,
    s.allow_replies, s.allow_reactions, s.allow_sharing,
    s.audio_url, s.audio_title, s.audio_source, s.audio_duration_sec, s.filter_id
  from public.stories s
  where s.user_id = p_user_id
    and s.expires_at > now()
    and public.viewer_can_see_story(s.id)
  order by s.created_at asc;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_follow_action(p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_target_visibility text;
  v_existing_follow uuid;
  v_existing_request uuid;
  v_request_status text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if v_caller = p_target_id then raise exception 'Cannot follow yourself'; end if;

  select id into v_existing_follow from follows
  where follower_id = v_caller and following_id = p_target_id;

  if v_existing_follow is not null then
    delete from follows where id = v_existing_follow;
    delete from follow_requests
      where requester_id = v_caller and target_id = p_target_id;
    return jsonb_build_object('action', 'unfollowed');
  end if;

  select id, status into v_existing_request, v_request_status
  from follow_requests where requester_id = v_caller and target_id = p_target_id;

  if v_existing_request is not null then
    if v_request_status = 'pending' then
      delete from follow_requests
        where requester_id = v_caller and target_id = p_target_id;
      return jsonb_build_object('action', 'request_cancelled');
    else
      delete from follow_requests
        where requester_id = v_caller and target_id = p_target_id;
    end if;
  end if;

  select coalesce(profile_visibility, 'public') into v_target_visibility
  from profiles where id = p_target_id;

  if v_target_visibility = 'private' then
    insert into follow_requests (requester_id, target_id, status)
    values (v_caller, p_target_id, 'pending');
    return jsonb_build_object('action', 'requested');
  else
    insert into follows (follower_id, following_id) values (v_caller, p_target_id);
    return jsonb_build_object('action', 'followed');
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    insert into public.profiles (id, email, full_name, account_type)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      'personal'
    )
    on conflict (id) do nothing;
  exception when others then
    raise warning 'handle_new_user profiles insert failed for %: %', new.id, sqlerrm;
  end;

  begin
    insert into public.user_presence (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  exception when others then
    raise warning 'handle_new_user user_presence insert failed for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_verified_school_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_email TEXT;
  v_domain TEXT;
BEGIN
  SELECT email INTO v_email
  FROM auth.users
  WHERE id = NEW.id;

  IF v_email IS NOT NULL THEN
    v_domain := lower(split_part(v_email, '@', 2));
    NEW.email_domain := v_domain;
    NEW.is_verified_school_user := public.is_verified_school_domain(v_email);
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_share_count(p_post_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update posts set shares_count = shares_count + 1 where id = p_post_id;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_sound_use(p_sound_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.story_sounds set use_count = use_count + 1 where id = p_sound_id;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from admin_users where user_id = auth.uid() and active);
$function$
;

CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from business_members
    where business_id = p_business_id and member_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_business_owner(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from business_members
    where business_id = p_business_id and member_id = auth.uid() and role = 'owner'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_call_initiator(p_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from call_sessions
    where id = p_session_id and initiator_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_call_member(p_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from call_participants
    where call_session_id = p_session_id and user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_conversation_admin(p_conversation_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
begin
  set local row_security = off;

  select role into v_role
  from public.conversation_members
  where conversation_id = p_conversation_id
    and user_id = p_user_id
  limit 1;

  return coalesce(v_role, '') = 'admin';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conversation_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_exists boolean;
begin
  set local row_security = off;

  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id
      and user_id = p_user_id
  ) into v_exists;

  return coalesce(v_exists, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_email_blocked(p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_domain TEXT;
BEGIN
  v_domain := lower(split_part(p_email, '@', 2));
  RETURN EXISTS (
    SELECT 1 FROM public.blocked_email_domains
    WHERE domain = v_domain
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_username is not null
     and length(trim(p_username)) between 3 and 30
     and trim(p_username) ~ '^[a-z0-9_]+$'
     and not exists (select 1 from profiles where lower(username) = lower(trim(p_username)));
$function$
;

CREATE OR REPLACE FUNCTION public.is_verified_school_domain(p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_domain TEXT;
BEGIN
  v_domain := lower(split_part(p_email, '@', 2));

  IF v_domain IN ('asu.edu', 'thunderbird.asu.edu') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.jobs_search_tsv_fn()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.search_tsv :=
    setweight(to_tsvector('simple', coalesce(new.title,'') || ' ' || coalesce(new.company,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.description,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.industry,'') || ' ' || coalesce(new.category,'') || ' ' || coalesce(new.location,'')), 'C');
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.join_channel(p_channel uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid; ch channels%rowtype;
begin
  uid := auth.uid();
  if uid is null then raise exception 'Not signed in'; end if;
  select * into ch from channels where id = p_channel and status = 'active';
  if not found then raise exception 'Channel not found'; end if;
  if ch.audience = 'followers'
     and ch.owner_id <> uid
     and not exists (select 1 from follows f where f.follower_id = uid and f.following_id = ch.owner_id) then
    raise exception 'This channel is for followers';
  end if;
  insert into channel_members (channel_id, user_id) values (p_channel, uid)
  on conflict (channel_id, user_id) do nothing;
end $function$
;

CREATE OR REPLACE FUNCTION public.join_community(p_community uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_mode text;
begin
  select join_mode into v_mode from communities where id = p_community and status = 'active';
  if v_mode is null then raise exception 'No such community'; end if;
  if exists (select 1 from community_members where community_id = p_community and user_id = auth.uid()) then
    return 'joined';
  end if;
  if v_mode = 'open' then
    insert into community_members (community_id, user_id, role) values (p_community, auth.uid(), 'member')
    on conflict (community_id, user_id) do nothing;
    return 'joined';
  elsif v_mode = 'approval' then
    insert into community_join_requests (community_id, user_id) values (p_community, auth.uid())
    on conflict (community_id, user_id) do nothing;
    return 'requested';
  else
    raise exception 'This community is invite only';
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.join_group_call(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_conv uuid; v_status text; v_init uuid;
begin
  select conversation_id, status, initiator_id into v_conv, v_status, v_init
  from call_sessions where id = p_session_id;
  if v_conv is null then raise exception 'call not found'; end if;
  if v_status not in ('ringing', 'active') then raise exception 'call has ended'; end if;
  if not is_conversation_member(v_conv, auth.uid()) then raise exception 'not a member'; end if;

  insert into call_participants (call_session_id, user_id, status, joined_at)
  values (p_session_id, auth.uid(), 'joined', now())
  on conflict (call_session_id, user_id)
  do update set status = 'joined', joined_at = coalesce(call_participants.joined_at, now()), left_at = null;

  update call_sessions set status = 'active', started_at = coalesce(started_at, now())
  where id = p_session_id and status = 'ringing' and auth.uid() <> v_init;
end $function$
;

CREATE OR REPLACE FUNCTION public.leave_channel(p_channel uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from channel_members where channel_id = p_channel and user_id = auth.uid() and role <> 'owner';
$function$
;

CREATE OR REPLACE FUNCTION public.leave_community(p_community uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from community_members where community_id = p_community and user_id = auth.uid() and role = 'owner') then
    raise exception 'The owner cannot leave their own community';
  end if;
  delete from community_members where community_id = p_community and user_id = auth.uid();
end $function$
;

CREATE OR REPLACE FUNCTION public.leave_group_call(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update call_participants set status = 'left', left_at = now()
  where call_session_id = p_session_id and user_id = auth.uid();

  update call_sessions s
  set status = 'ended', ended_at = now(),
      duration_sec = greatest(0, extract(epoch from (now() - coalesce(s.started_at, s.created_at)))::int)
  where s.id = p_session_id
    and s.status in ('ringing', 'active')
    and not exists (select 1 from call_participants p
                    where p.call_session_id = s.id and p.status = 'joined');
end $function$
;

CREATE OR REPLACE FUNCTION public.link_business_profile(p_business_profile_id uuid, p_business_auth_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_name text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;

  select owner_id, name into v_owner, v_name
  from business_profiles where id = p_business_profile_id;
  if v_owner is null then raise exception 'Business page not found'; end if;
  if v_owner <> v_me then raise exception 'Only the page owner can link it'; end if;

  if not exists (select 1 from profiles where id = p_business_auth_id) then
    raise exception 'No profile exists for that auth id yet';
  end if;

  update profiles set account_type = 'business' where id = p_business_auth_id;
  update business_profiles set profile_id = p_business_auth_id
   where id = p_business_profile_id;

  insert into business_members (business_id, member_id, role)
  values (p_business_auth_id, v_me, 'owner')
  on conflict (business_id, member_id) do update set role = 'owner';

  return jsonb_build_object('business_id', p_business_auth_id, 'name', v_name);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_my_active_meetings()
 RETURNS TABLE(id uuid, room_name text, title text, is_public boolean, expires_at timestamp with time zone, created_at timestamp with time zone, participant_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    m.id, m.room_name, m.title, m.is_public, m.expires_at, m.created_at,
    (select count(*) from public.meeting_participants mp
      where mp.meeting_id = m.id and mp.left_at is null) as participant_count
  from public.meetings m
  where m.host_id = auth.uid()
    and m.ended_at is null
    and m.expires_at > now()
  order by m.created_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.list_my_mentorships(p_status text DEFAULT 'active'::text)
 RETURNS TABLE(mentorship_id uuid, role text, partner_id uuid, partner_name text, partner_username text, partner_avatar text, partner_headline text, mentor_kind text, conversation_id uuid, started_at timestamp with time zone, ended_at timestamp with time zone, goals_open integer, goals_completed integer, meetings_upcoming integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    m.id,
    case when m.mentor_id = auth.uid() then 'mentor' else 'mentee' end as role,
    case when m.mentor_id = auth.uid() then m.mentee_id else m.mentor_id end as partner_id,
    p.full_name,
    p.username,
    p.avatar_url,
    p.headline,
    mp.mentor_kind,
    m.conversation_id,
    m.started_at,
    m.ended_at,
    (select count(*)::int from public.mentorship_goals g
       where g.mentorship_id = m.id and g.status in ('open','in_progress')),
    (select count(*)::int from public.mentorship_goals g
       where g.mentorship_id = m.id and g.status = 'completed'),
    (select count(*)::int from public.mentorship_meetings mt
       where mt.mentorship_id = m.id
         and mt.status = 'scheduled'
         and mt.scheduled_at > now())
  from public.mentorships m
  join public.profiles p on p.id = case when m.mentor_id = auth.uid() then m.mentee_id else m.mentor_id end
  left join public.mentor_profiles mp on mp.profile_id = m.mentor_id
  where (m.mentor_id = auth.uid() or m.mentee_id = auth.uid())
    and (p_status is null or m.status = p_status)
  order by m.started_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.listings_search_tsv_fn()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.search_tsv :=
    setweight(to_tsvector('simple', coalesce(new.title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.description,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.category,'') || ' ' || coalesce(new.location_city,'')), 'C');
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.log_search_event(p_query text, p_vertical text DEFAULT 'all'::text, p_action text DEFAULT 'search'::text, p_result uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into search_events (user_id, query, vertical, action, result_id)
  select auth.uid(), left(coalesce(p_query,''), 200), left(coalesce(p_vertical,'all'), 30), left(coalesce(p_action,'search'), 30), p_result
  where coalesce(trim(p_query),'') <> '';
$function$
;

CREATE OR REPLACE FUNCTION public.make_offer(p_listing_id uuid, p_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_l record; v_conv uuid; v_offer uuid; v_meta text;
begin
  select id, seller_id, title, currency, status into v_l
  from marketplace_listings where id = p_listing_id;
  if v_l.id is null then raise exception 'listing not found'; end if;
  if v_l.status <> 'available' then raise exception 'listing is no longer available'; end if;
  if v_l.seller_id = auth.uid() then raise exception 'cannot offer on your own listing'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;

  insert into listing_offers (listing_id, buyer_id, seller_id, proposer_id, amount, currency)
  values (p_listing_id, auth.uid(), v_l.seller_id, auth.uid(), p_amount, v_l.currency)
  returning id into v_offer;

  select start_dm_ctx(v_l.seller_id, 'market', p_listing_id) into v_conv;

  v_meta := jsonb_build_object('offer_id', v_offer, 'listing_id', p_listing_id,
    'listing_title', v_l.title, 'amount', p_amount, 'currency', v_l.currency,
    'status', 'pending')::text;
  insert into messages (conversation_id, sender_id, receiver_id, text, media_type, media_url)
  values (v_conv, auth.uid(), v_l.seller_id,
    'Offer: ' || v_l.currency || ' ' || p_amount::text || ' for ' || v_l.title,
    'offer', v_meta);
  return v_offer;
end $function$
;

CREATE OR REPLACE FUNCTION public.mark_channel_read(p_channel uuid, p_message uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update channel_members set last_read_message_id = p_message
  where channel_id = p_channel and user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conv_id uuid, p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer;
BEGIN
  UPDATE messages
  SET read_at = now(),
      viewed_at = COALESCE(viewed_at, now()),
      delivered_at = COALESCE(delivered_at, now())
  WHERE conversation_id = p_conv_id
    AND receiver_id = p_user_id
    AND sender_id <> p_user_id
    AND read_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_conversation_read_v2(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update messages set read_at = now()
  where conversation_id = p_conversation_id
    and receiver_id = auth.uid() and read_at is null;

  update conversation_members set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();
end $function$
;

CREATE OR REPLACE FUNCTION public.mark_missed_calls()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  update calls set status = 'missed'
  where status = 'ringing' and created_at < now() - interval '60 seconds';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  update notifications
     set read_at = now()
   where recipient_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any(p_ids));

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_story_viewed(p_story_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  insert into public.story_views (story_id, user_id)
  values (p_story_id, auth.uid())
  on conflict (story_id, user_id) do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_connection_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    insert into notifications(recipient_id, actor_id, type, message, data)
    values (
      NEW.recipient_id, NEW.requester_id, 'connection_request',
      'sent you a connection request',
      jsonb_build_object('connection_id', NEW.id)
    )
    on conflict do nothing;

  elsif TG_OP = 'UPDATE' and NEW.status = 'accepted' and OLD.status = 'pending' then
    insert into notifications(recipient_id, actor_id, type, message, data)
    values (
      NEW.requester_id, NEW.recipient_id, 'connection_accepted',
      'accepted your connection request',
      jsonb_build_object('connection_id', NEW.id)
    )
    on conflict do nothing;
  end if;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_market_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into notifications (recipient_id, actor_id, type, message, data)
  select a.user_id, new.seller_id, 'market_alert',
         'listed a match for your alert',
         jsonb_build_object('listing_id', new.id, 'alert_id', a.id, 'query', a.query, 'title', new.title)
  from market_alerts a
  where a.user_id <> new.seller_id
    and (new.title ilike '%' || a.query || '%' or coalesce(new.description, '') ilike '%' || a.query || '%')
    and (a.max_price is null or new.price is null or new.price <= a.max_price)
    and (a.city is null or coalesce(new.location_city, '') ilike '%' || a.city || '%')
  on conflict do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_member_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.notify_member_departure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.notify_mentions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  content_text text;
  author_id    uuid;
  source_type  text;
  ref_post_id  uuid;
  mention      text;
  mentioned_id uuid;
  author_name  text;
BEGIN
  -- Determine source
  IF TG_TABLE_NAME = 'posts' THEN
    content_text := NEW.content;
    author_id    := NEW.user_id;
    source_type  := 'post';
    ref_post_id  := NEW.id;
  ELSIF TG_TABLE_NAME = 'post_comments' THEN
    content_text := NEW.body;
    author_id    := NEW.user_id;
    source_type  := 'comment';
    ref_post_id  := NEW.post_id;
  ELSE
    RETURN NEW;
  END IF;

  -- Guard: no content or no author
  IF content_text IS NULL OR content_text = '' OR author_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get author display name for notification message
  SELECT full_name INTO author_name
  FROM profiles WHERE id = author_id;
  author_name := COALESCE(author_name, 'Someone');

  -- Extract all @username matches and process each
  FOR mention IN
    SELECT DISTINCT (regexp_matches(content_text, '@([\w.]+)', 'g'))[1]
  LOOP
    -- Resolve username to user ID
    SELECT id INTO mentioned_id
    FROM profiles
    WHERE lower(username) = lower(mention);

    -- Skip if username not found, or self-mention
    IF mentioned_id IS NULL OR mentioned_id = author_id THEN
      CONTINUE;
    END IF;

    -- Skip if duplicate notification already exists for this exact mention
    -- (same actor, same recipient, same post, type=mention, within last 60 seconds)
    IF EXISTS (
      SELECT 1 FROM notifications
      WHERE recipient_id = mentioned_id
        AND actor_id = author_id
        AND type = 'mention'
        AND data->>'post_id' = ref_post_id::text
        AND created_at > now() - interval '60 seconds'
    ) THEN
      CONTINUE;
    END IF;

    -- Insert notification
    INSERT INTO notifications (
      id, recipient_id, actor_id, type, message, body_preview, data, created_at
    ) VALUES (
      gen_random_uuid(),
      mentioned_id,
      author_id,
      'mention',
      author_name || ' mentioned you in a ' || source_type,
      left(content_text, 120),
      jsonb_build_object('post_id', ref_post_id),
      now()
    );
  END LOOP;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_mentorship()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    -- Notify mentor of new request
    insert into notifications (recipient_id, actor_id, type, message, created_at)
    values (NEW.mentor_id, NEW.mentee_id, 'mentorship_request',
            'Someone requested you as their mentor', now())
    on conflict do nothing;
  end if;

  if TG_OP = 'UPDATE' and OLD.status = 'pending' and NEW.status = 'accepted' then
    -- Notify mentee they were accepted
    insert into notifications (recipient_id, actor_id, type, message, created_at)
    values (NEW.mentee_id, NEW.mentor_id, 'mentorship_accepted',
            'Your mentorship request was accepted', now())
    on conflict do nothing;
  end if;

  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_missed_call()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if NEW.status = 'missed' and OLD.status = 'ringing' then
    insert into notifications (recipient_id, actor_id, type, message, data)
    values (
      NEW.receiver_id, NEW.caller_id, 'missed_call', 'You missed a call',
      jsonb_build_object('call_id', NEW.id, 'is_video', NEW.is_video)
    );
  end if;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_business_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_business text;
begin
  if new.member_id = auth.uid() then return new; end if;
  select full_name into v_business from profiles where id = new.business_id;

  insert into notifications (recipient_id, actor_id, type, message, body_preview, data)
  values (new.member_id, auth.uid(), 'business_member',
          'You were added to ' || coalesce(v_business, 'a business'),
          initcap(new.role),
          jsonb_build_object('business_id', new.business_id, 'role', new.role));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_comment_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_author uuid; v_body text; v_post uuid; v_liker text;
begin
  if new.value <> 1 then return new; end if;
  select user_id, coalesce(body, content, ''), post_id
    into v_author, v_body, v_post
  from post_comments where id = new.comment_id;
  if v_author is null or v_author = new.user_id then return new; end if;
  select full_name into v_liker from profiles where id = new.user_id;
  insert into notifications (recipient_id, actor_id, type, message, body_preview, data)
  values (v_author, new.user_id, 'comment_like',
          coalesce(v_liker, 'Someone') || ' liked your comment',
          left(v_body, 80),
          jsonb_build_object('comment_id', new.comment_id, 'post_id', v_post));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_comment_mention()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  mention_username text;
  mentioned_user_id uuid;
  seen uuid[];
  comment_text text;
BEGIN
  comment_text := COALESCE(NEW.content, NEW.body);
  IF comment_text IS NULL THEN RETURN NEW; END IF;
  seen := ARRAY[]::uuid[];
  FOR mention_username IN
    SELECT DISTINCT LOWER(substring(m[1] FROM 2))
    FROM regexp_matches(comment_text, '@([A-Za-z0-9_\.]+)', 'g') AS m
  LOOP
    SELECT id INTO mentioned_user_id
    FROM public.profiles
    WHERE LOWER(username) = mention_username
    LIMIT 1;

    IF mentioned_user_id IS NOT NULL
       AND mentioned_user_id != NEW.user_id
       AND NOT (mentioned_user_id = ANY(seen)) THEN
      INSERT INTO public.notifications (recipient_id, actor_id, type, message, data, body_preview)
      VALUES (
        mentioned_user_id,
        NEW.user_id,
        'mention',
        'mentioned you in a comment',
        jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id),
        LEFT(comment_text, 140)
      );
      seen := array_append(seen, mentioned_user_id);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_follow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if new.follower_id = new.following_id then return new; end if;
  insert into public.notifications (recipient_id, actor_id, type, message, data)
  values (new.following_id, new.follower_id, 'follow', 'started following you',
    jsonb_build_object('follow_id', new.id));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_follow_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text;
begin
  if new.status <> 'pending' then return new; end if;
  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.requester_id;

  insert into notifications (recipient_id, actor_id, type, message, data)
  values (new.target_id, new.requester_id, 'follow_request',
          v_name || ' wants to follow you',
          jsonb_build_object('request_id', new.id));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_follow_request_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text;
begin
  if new.status <> 'accepted' or old.status is not distinct from 'accepted' then
    return new;
  end if;
  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.target_id;

  insert into notifications (recipient_id, actor_id, type, message, data)
  values (new.requester_id, new.target_id, 'follow_accepted',
          v_name || ' accepted your follow request',
          jsonb_build_object('request_id', new.id));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_job_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_poster uuid; v_title text; v_name text;
begin
  select posted_by, title into v_poster, v_title from jobs where id = new.job_id;
  if v_poster is null or v_poster = new.applicant_id then return new; end if;

  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.applicant_id;

  insert into notifications (recipient_id, actor_id, type, message, body_preview, data)
  values (v_poster, new.applicant_id, 'job_application',
          v_name || ' applied to your job',
          v_title,
          jsonb_build_object('job_id', new.job_id, 'application_id', new.id));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  post_author uuid;
BEGIN
  SELECT user_id INTO post_author FROM public.posts WHERE id = NEW.post_id;
  IF post_author IS NULL OR post_author = NEW.user_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (recipient_id, actor_id, type, message, data)
  VALUES (
    post_author,
    NEW.user_id,
    'like',
    'liked your post',
    jsonb_build_object('post_id', NEW.post_id)
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_new_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  sender_name text;
  conv_is_group boolean;
  conv_group_name text;
  member_id uuid;
  msg_preview text;
BEGIN
  -- Skip system messages
  IF NEW.is_system_message = true THEN
    RETURN NEW;
  END IF;

  -- Skip if no sender
  IF NEW.sender_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get sender display name
  SELECT full_name INTO sender_name
  FROM profiles WHERE id = NEW.sender_id;
  sender_name := COALESCE(sender_name, 'Someone');

  -- Build message preview
  IF NEW.media_type IS NOT NULL AND NEW.media_type != '' THEN
    msg_preview := CASE
      WHEN NEW.media_type LIKE 'image%' THEN 'Sent a photo'
      WHEN NEW.media_type LIKE 'video%' THEN 'Sent a video'
      WHEN NEW.media_type LIKE 'audio%' THEN 'Sent a voice message'
      ELSE 'Sent an attachment'
    END;
  ELSE
    msg_preview := LEFT(COALESCE(NEW.text, ''), 120);
  END IF;

  -- Check if conversation is a group
  SELECT is_group, group_name
  INTO conv_is_group, conv_group_name
  FROM conversations
  WHERE id = NEW.conversation_id;

  IF conv_is_group = true THEN
    -- Group message: notify all members except sender
    FOR member_id IN
      SELECT user_id FROM conversation_members
      WHERE conversation_id = NEW.conversation_id
        AND user_id != NEW.sender_id
    LOOP
      INSERT INTO notifications (recipient_id, actor_id, type, message, body_preview, data)
      VALUES (
        member_id,
        NEW.sender_id,
        'message',
        sender_name || ' in ' || COALESCE(conv_group_name, 'group chat'),
        msg_preview,
        jsonb_build_object(
          'conversation_id', NEW.conversation_id,
          'message_id', NEW.id,
          'is_group', true,
          'group_name', COALESCE(conv_group_name, 'Group Chat')
        )
      );
    END LOOP;
  ELSE
    -- 1-on-1 message: notify receiver directly
    IF NEW.receiver_id IS NOT NULL AND NEW.receiver_id != NEW.sender_id THEN
      INSERT INTO notifications (recipient_id, actor_id, type, message, body_preview, data)
      VALUES (
        NEW.receiver_id,
        NEW.sender_id,
        'message',
        sender_name || ' sent you a message',
        msg_preview,
        jsonb_build_object(
          'conversation_id', NEW.conversation_id,
          'message_id', NEW.id,
          'is_group', false
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text; v_amount text;
begin
  if new.status <> 'completed' or old.status is not distinct from 'completed' then
    return new;
  end if;
  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.sender_id;

  v_amount := case when coalesce(new.currency, 'USD') = 'USD'
                   then '$' || trim(to_char(new.amount, 'FM999999990.00'))
                   else 'ZWG ' || trim(to_char(new.amount, 'FM999999990.00')) end;

  insert into notifications (recipient_id, actor_id, type, message, body_preview, data)
  values (new.recipient_id, new.sender_id, 'payment_received',
          v_name || ' sent you ' || v_amount,
          new.note,
          jsonb_build_object('payment_id', new.id,
                             'conversation_id', new.conversation_id,
                             'listing_id', new.listing_id));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_post_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  post_author uuid;
  comment_text text;
BEGIN
  SELECT user_id INTO post_author FROM public.posts WHERE id = NEW.post_id;
  IF post_author IS NULL OR post_author = NEW.user_id THEN
    RETURN NEW;
  END IF;

  comment_text := COALESCE(NEW.content, NEW.body, '');

  INSERT INTO public.notifications (recipient_id, actor_id, type, message, data, body_preview)
  VALUES (
    post_author,
    NEW.user_id,
    CASE WHEN NEW.parent_comment_id IS NOT NULL THEN 'reply' ELSE 'comment' END,
    CASE WHEN NEW.parent_comment_id IS NOT NULL THEN 'replied to your comment' ELSE 'commented on your post' END,
    jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id, 'parent_comment_id', NEW.parent_comment_id),
    LEFT(comment_text, 140)
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_post_mention()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  mention_username text;
  mentioned_user_id uuid;
  seen uuid[];
BEGIN
  IF NEW.content IS NULL THEN RETURN NEW; END IF;
  seen := ARRAY[]::uuid[];
  FOR mention_username IN
    SELECT DISTINCT LOWER(substring(m[1] FROM 2))
    FROM regexp_matches(NEW.content, '@([A-Za-z0-9_\.]+)', 'g') AS m
  LOOP
    SELECT id INTO mentioned_user_id
    FROM public.profiles
    WHERE LOWER(username) = mention_username
    LIMIT 1;

    IF mentioned_user_id IS NOT NULL
       AND mentioned_user_id != NEW.user_id
       AND NOT (mentioned_user_id = ANY(seen)) THEN
      INSERT INTO public.notifications (recipient_id, actor_id, type, message, data, body_preview)
      VALUES (
        mentioned_user_id,
        NEW.user_id,
        'mention',
        'mentioned you in a post',
        jsonb_build_object('post_id', NEW.id),
        LEFT(NEW.content, 140)
      );
      seen := array_append(seen, mentioned_user_id);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_repost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  post_author uuid;
  post_preview text;
BEGIN
  SELECT user_id, LEFT(COALESCE(content, body, ''), 140)
    INTO post_author, post_preview
  FROM public.posts WHERE id = NEW.post_id;

  IF post_author IS NULL OR post_author = NEW.user_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (recipient_id, actor_id, type, message, data, body_preview)
  VALUES (
    post_author,
    NEW.user_id,
    'repost',
    'reposted your post',
    jsonb_build_object('post_id', NEW.post_id),
    post_preview
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_push_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets
    where name = 'service_role_key' order by created_at desc limit 1;
  if k is null then
    raise warning 'notify_push_notification: vault secret service_role_key missing, push skipped';
    return new;
  end if;
  perform net.http_post(
    url := 'https://prlkikhckbifseosbukl.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || k
    ),
    body := jsonb_build_object('type', 'INSERT', 'table', 'notifications', 'schema', 'public', 'record', to_jsonb(new))
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_referral()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text; v_title text;
begin
  if new.referred_id = new.referrer_id then return new; end if;

  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.referrer_id;
  select title into v_title from jobs where id = new.job_id;

  insert into notifications (recipient_id, actor_id, type, message, body_preview, data)
  values (new.referred_id, new.referrer_id, 'job_referral',
          v_name || ' referred you for a job',
          v_title,
          jsonb_build_object('job_id', new.job_id, 'referral_id', new.id));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_story_reaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_name text;
  v_msg text;
begin
  select user_id into v_owner from stories where id = new.story_id;
  if v_owner is null or v_owner = new.user_id then return new; end if;

  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.user_id;

  if new.emoji = '❤️' then
    v_msg := v_name || ' liked your story';
  else
    v_msg := v_name || ' reacted ' || new.emoji || ' to your story';
  end if;

  -- One feed row per actor per story: replace any previous reaction notice.
  delete from notifications
  where recipient_id = v_owner and actor_id = new.user_id
    and type = 'story_reaction' and (data->>'story_id') = new.story_id::text;

  insert into notifications (recipient_id, actor_id, type, message, data)
  values (v_owner, new.user_id, 'story_reaction', v_msg,
          jsonb_build_object('story_id', new.story_id, 'emoji', new.emoji));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_story_reaction_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner uuid;
begin
  select user_id into v_owner from stories where id = old.story_id;
  if v_owner is null then return old; end if;
  -- Instant un-react before the owner saw it: withdraw the unread notice.
  delete from notifications
  where recipient_id = v_owner and actor_id = old.user_id
    and type = 'story_reaction' and read_at is null
    and (data->>'story_id') = old.story_id::text
    and (data->>'emoji') = old.emoji;
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_voip_ring()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_key text;
begin
  if new.status = 'invited' then
    if exists (
      select 1 from call_participants cp
      where cp.call_session_id = new.call_session_id
        and cp.status = 'invited' and cp.id <> new.id
        and (cp.created_at < new.created_at
             or (cp.created_at = new.created_at and cp.id::text < new.id::text))
    ) then
      return new;
    end if;
    select decrypted_secret into v_key from vault.decrypted_secrets
    where name = 'service_role_key' order by created_at desc limit 1;
    if v_key is null then
      raise warning 'notify_voip_ring: service_role_key missing from vault';
      return new;
    end if;
    perform net.http_post(
      url := 'https://prlkikhckbifseosbukl.supabase.co/functions/v1/send-voip-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('callId', new.call_session_id)
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_voip_ring_1to1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_key text;
begin
  if new.status = 'ringing' and coalesce(new.is_group_call, false) = false and new.receiver_id is not null then
    select decrypted_secret into v_key from vault.decrypted_secrets
    where name = 'service_role_key' order by created_at desc limit 1;
    if v_key is null then
      raise warning 'notify_voip_ring_1to1: service_role_key missing from vault';
      return new;
    end if;
    perform net.http_post(
      url := 'https://prlkikhckbifseosbukl.supabase.co/functions/v1/send-voip-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('callId', new.id)
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_voip_ring_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k text;
begin
  -- Only rows that represent somebody's phone ringing. The caller's own row
  -- carries receiver_id null and status 'active', and must not push.
  if new.status = 'ringing' and new.receiver_id is not null then
    select decrypted_secret into k from vault.decrypted_secrets
      where name = 'service_role_key' order by created_at desc limit 1;
    if k is null then
      raise warning 'notify_voip_ring_session: vault secret service_role_key missing, push skipped';
      return new;
    end if;
    perform net.http_post(
      url := 'https://prlkikhckbifseosbukl.supabase.co/functions/v1/send-voip-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || k
      ),
      body := jsonb_build_object('callId', new.id)
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pin_community_post(p_post uuid, p_pin boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_comm uuid;
begin
  select community_id into v_comm from posts where id = p_post;
  if v_comm is null then raise exception 'Not a community post'; end if;
  if not exists (select 1 from community_members m where m.community_id = v_comm and m.user_id = auth.uid() and m.role in ('owner','moderator')) then
    raise exception 'Only the owner and moderators pin posts';
  end if;
  update posts set is_community_pinned = p_pin where id = p_post;
end $function$
;

CREATE OR REPLACE FUNCTION public.post_campus_moment(p_prompt_id uuid, p_story_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_prompt campus_moment_prompts;
  v_story stories;
  v_is_late boolean;
  v_late_seconds int;
  v_existing campus_moment_posts;
  v_result campus_moment_posts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_prompt FROM campus_moment_prompts WHERE id = p_prompt_id;
  IF v_prompt IS NULL THEN
    RAISE EXCEPTION 'Prompt not found';
  END IF;

  SELECT * INTO v_story FROM stories WHERE id = p_story_id;
  IF v_story IS NULL THEN
    RAISE EXCEPTION 'Story not found';
  END IF;

  IF v_story.user_id != auth.uid() THEN
    RAISE EXCEPTION 'Story does not belong to you';
  END IF;

  -- Check for existing post (handle duplicate gracefully)
  SELECT * INTO v_existing FROM campus_moment_posts
    WHERE prompt_id = p_prompt_id AND user_id = auth.uid();
  IF v_existing IS NOT NULL THEN
    RETURN row_to_json(v_existing);
  END IF;

  v_is_late := now() > v_prompt.window_end;
  v_late_seconds := CASE WHEN v_is_late
    THEN EXTRACT(EPOCH FROM (now() - v_prompt.window_end))::int
    ELSE 0
  END;

  INSERT INTO campus_moment_posts (prompt_id, story_id, user_id, is_late, late_seconds)
  VALUES (p_prompt_id, p_story_id, auth.uid(), v_is_late, v_late_seconds)
  RETURNING * INTO v_result;

  RETURN row_to_json(v_result);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.post_channel_message(p_channel uuid, p_content text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_media_type text DEFAULT NULL::text, p_is_prompt boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_msg uuid; v_role text;
begin
  select role into v_role from channel_members where channel_id = p_channel and user_id = auth.uid();
  if v_role is null or v_role not in ('owner','collaborator') then
    raise exception 'Only the owner and collaborators post';
  end if;
  if (p_content is null or trim(p_content) = '') and p_media_url is null then
    raise exception 'Say something or attach media';
  end if;
  insert into channel_messages (channel_id, sender_id, content, media_url, media_type, is_prompt)
  values (p_channel, auth.uid(), nullif(trim(coalesce(p_content, '')), ''), p_media_url, p_media_type, coalesce(p_is_prompt, false))
  returning id into v_msg;
  return v_msg;
end $function$
;

CREATE OR REPLACE FUNCTION public.post_channel_poll(p_channel uuid, p_question text, p_options text[], p_days integer DEFAULT 3)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_msg uuid; v_opt text; v_pos int := 0; v_role text;
begin
  select role into v_role from channel_members where channel_id = p_channel and user_id = auth.uid();
  if v_role is null or v_role not in ('owner','collaborator') then
    raise exception 'Only the owner and collaborators post';
  end if;
  if p_question is null or trim(p_question) = '' then raise exception 'Poll needs a question'; end if;
  if p_options is null or array_length(p_options, 1) < 2 or array_length(p_options, 1) > 4 then
    raise exception 'Polls take 2 to 4 options';
  end if;
  insert into channel_messages (channel_id, sender_id, content)
  values (p_channel, auth.uid(), trim(p_question)) returning id into v_msg;
  insert into channel_polls (message_id, ends_at)
  values (v_msg, now() + make_interval(days => greatest(least(coalesce(p_days,3),7),1)));
  foreach v_opt in array p_options loop
    if trim(v_opt) <> '' then
      insert into channel_poll_options (message_id, label, position) values (v_msg, trim(v_opt), v_pos);
      v_pos := v_pos + 1;
    end if;
  end loop;
  return v_msg;
end $function$
;

CREATE OR REPLACE FUNCTION public.post_payment_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Only on the transition into completed, and only once.
  if new.status <> 'completed' or old.status is not distinct from 'completed' then
    return new;
  end if;
  if exists (select 1 from messages where payment_id = new.id) then
    return new;
  end if;

  insert into messages (conversation_id, sender_id, receiver_id, text, media_type, payment_id)
  values (new.conversation_id, new.sender_id, new.recipient_id, null, 'payment', new.id);

  update conversations
     set last_message = 'Payment',
         last_message_time = now(),
         last_message_sender_id = new.sender_id
   where id = new.conversation_id;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.posts_search_tsv_fn()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.search_tsv :=
    setweight(to_tsvector('simple', coalesce(new.content,'') || ' ' || coalesce(new.body,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.article_title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.category,'')), 'B');
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.profiles_search_tsv_fn()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.search_tsv :=
    setweight(to_tsvector('simple', coalesce(new.username,'') || ' ' || coalesce(new.full_name,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.bio,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.location,'')), 'C');
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.rate_fact_check(p_id uuid, p_helpful boolean)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
insert into fact_check_votes (fact_check_id, voter_id, helpful)
values (p_id, auth.uid(), p_helpful)
on conflict (fact_check_id, voter_id) do update set helpful = excluded.helpful;
$function$
;

CREATE OR REPLACE FUNCTION public.react_channel_message(p_message uuid, p_emoji text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid;
begin
  uid := auth.uid();
  if not exists (select 1 from channel_members cm join channel_messages m on m.channel_id = cm.channel_id
                 where m.id = p_message and cm.user_id = uid) then
    raise exception 'Join the channel to react';
  end if;
  if exists (select 1 from channel_message_reactions where message_id = p_message and user_id = uid and emoji = p_emoji) then
    delete from channel_message_reactions where message_id = p_message and user_id = uid and emoji = p_emoji;
  else
    insert into channel_message_reactions (message_id, user_id, emoji) values (p_message, uid, p_emoji);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.rebuild_daily_stats(p_day date)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into daily_stats (day, dau, new_signups, posts, comments, likes, messages, stories, listings, jobs, computed_at)
  select
    p_day,
    (select count(distinct actor) from (
       select user_id as actor from posts where created_at >= p_day and created_at < p_day + 1
       union select user_id from post_comments where created_at >= p_day and created_at < p_day + 1
       union select user_id from post_likes where created_at >= p_day and created_at < p_day + 1
       union select sender_id from messages where created_at >= p_day and created_at < p_day + 1
       union select user_id from stories where created_at >= p_day and created_at < p_day + 1
       union select user_id from story_views where viewed_at >= p_day and viewed_at < p_day + 1
     ) a where actor is not null),
    (select count(*) from profiles where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from posts where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from post_comments where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from post_likes where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from messages where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from stories where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from marketplace_listings where created_at >= p_day and created_at < p_day + 1),
    (select count(*) from jobs where created_at >= p_day and created_at < p_day + 1),
    now()
  on conflict (day) do update set
    dau = excluded.dau, new_signups = excluded.new_signups, posts = excluded.posts,
    comments = excluded.comments, likes = excluded.likes, messages = excluded.messages,
    stories = excluded.stories, listings = excluded.listings, jobs = excluded.jobs,
    computed_at = now();
$function$
;

CREATE OR REPLACE FUNCTION public.rebuild_trending_snapshot()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from trending_snapshot;

  insert into trending_snapshot (kind, ref_id, user_id, rank, heat, uniq_engagers)
  select 'post', ref_id, author_id,
         row_number() over (order by heat desc, uniq desc), heat, uniq
  from (
    select distinct on (p.user_id)
      p.id as ref_id, p.user_id as author_id,
      ( (select count(distinct l.user_id) from post_likes l
          where l.post_id = p.id and l.user_id <> p.user_id) * 1.0
      + (select count(distinct c.user_id) from post_comments c
          where c.post_id = p.id and c.user_id <> p.user_id) * 2.5
      + (select count(distinct r.user_id) from post_reposts r
          where r.post_id = p.id and r.user_id <> p.user_id) * 2.0
      ) / power(greatest(extract(epoch from (now() - p.created_at)) / 3600.0, 1.0), 0.8) as heat,
      ( select count(distinct e.user_id) from (
          select user_id from post_likes where post_id = p.id
          union select user_id from post_comments where post_id = p.id
          union select user_id from post_reposts where post_id = p.id
        ) e where e.user_id <> p.user_id ) as uniq
    from posts p
    where p.created_at > now() - interval '72 hours'
      and coalesce(p.audience, 'everyone') = 'everyone'
    order by p.user_id, heat desc
  ) x
  where uniq >= 3
  order by heat desc
  limit 20;

  insert into trending_snapshot (kind, ref_id, user_id, rank, heat, uniq_engagers)
  select 'story', story_id, s_user, row_number() over (order by heat desc, views desc), heat, views
  from (
    select distinct on (s.user_id)
      s.id as story_id, s.user_id as s_user,
      (select count(*) from story_views v
        where v.story_id = s.id and v.user_id <> s.user_id)::int as views,
      (select count(*) from story_reactions r
        where r.story_id = s.id and r.user_id <> s.user_id)::int as reactions,
      ((select count(*) from story_views v
         where v.story_id = s.id and v.user_id <> s.user_id)
       + (select count(*) from story_reactions r
          where r.story_id = s.id and r.user_id <> s.user_id) * 2.0) as heat
    from stories s
    where s.created_at > now() - interval '24 hours'
      and coalesce(s.audience, 'everyone') = 'everyone'
    order by s.user_id, heat desc
  ) x
  where x.views >= 10 and x.reactions >= 1
  order by heat desc
  limit 6;
$function$
;

CREATE OR REPLACE FUNCTION public.record_ad_event(p_promo_id uuid, p_kind text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  insert into ad_events (promo_id, user_id, kind)
  values (p_promo_id, auth.uid(), p_kind)
  on conflict (promo_id, user_id, kind) do nothing;
$function$
;

CREATE OR REPLACE FUNCTION public.record_call_event(p_call_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid; v_receiver_id uuid; v_conversation_id uuid;
  v_is_group boolean;
  v_is_video boolean; v_status text; v_duration_sec integer;
  v_call_type text; v_type_label text; v_msg_text text; v_meta_json text;
  v_existing_id uuid; v_dur_h integer; v_dur_m integer; v_dur_s integer; v_dur_str text;
begin
  select cs.initiator_id, cs.receiver_id, cs.conversation_id, coalesce(cs.is_group_call, false),
         coalesce(cs.is_video, false), cs.status, coalesce(cs.duration_sec, 0)
    into v_caller_id, v_receiver_id, v_conversation_id, v_is_group, v_is_video, v_status, v_duration_sec
  from call_sessions cs where cs.id = p_call_id;
  if v_caller_id is null then return; end if;
  if v_status not in ('ended', 'missed', 'declined') then return; end if;

  if not v_is_group and v_receiver_id is not null then
    v_conversation_id := coalesce(
      resolve_personal_conversation(v_caller_id, v_receiver_id),
      v_conversation_id);
  end if;
  if v_conversation_id is null then return; end if;

  select m.id into v_existing_id from messages m
  where m.conversation_id = v_conversation_id and m.media_type = 'call_event'
    and m.media_url like '%' || p_call_id::text || '%' limit 1;
  if v_existing_id is not null then return; end if;

  if v_is_video then v_call_type := 'video'; v_type_label := 'Video';
  else v_call_type := 'voice'; v_type_label := 'Voice'; end if;

  if v_status = 'missed' then v_msg_text := 'Missed ' || v_call_type || ' call';
  elsif v_status = 'declined' then v_msg_text := 'Declined ' || v_call_type || ' call';
  elsif v_status = 'ended' and v_duration_sec > 0 then
    v_dur_h := v_duration_sec / 3600; v_dur_m := (v_duration_sec % 3600) / 60; v_dur_s := v_duration_sec % 60;
    if v_dur_h > 0 then v_dur_str := v_dur_h::text || ':' || lpad(v_dur_m::text, 2, '0') || ':' || lpad(v_dur_s::text, 2, '0');
    else v_dur_str := lpad(v_dur_m::text, 2, '0') || ':' || lpad(v_dur_s::text, 2, '0'); end if;
    v_msg_text := v_type_label || ' call · ' || v_dur_str;
  else v_msg_text := v_type_label || ' call'; end if;

  v_meta_json := jsonb_build_object('call_id', p_call_id::text, 'call_type', v_call_type,
    'status', v_status, 'duration_secs', v_duration_sec)::text;

  insert into messages (conversation_id, sender_id, receiver_id, text, media_type, media_url, is_system_message)
  values (v_conversation_id, v_caller_id, v_receiver_id, v_msg_text, 'call_event', v_meta_json, true);

  update conversations
  set last_message = case when v_is_video then '📹 ' else '📞 ' end || v_msg_text,
      last_message_time = now()
  where id = v_conversation_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_meeting_join(p_meeting_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_part_id uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  insert into public.meeting_participants(meeting_id, user_id, joined_at)
  values (p_meeting_id, v_user, now())
  returning id into v_part_id;

  return v_part_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_meeting_leave(p_participant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.meeting_participants
     set left_at = now()
   where id = p_participant_id and user_id = auth.uid() and left_at is null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_video_view(p_post_id uuid, p_viewer_id uuid, p_session text, p_duration integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prev integer;
  v_now  integer;
  v_first_for_viewer boolean;
begin
  select duration_sec into v_prev
  from post_video_views
  where post_id = p_post_id and session_id = p_session;

  insert into post_video_views (post_id, viewer_id, session_id, duration_sec)
  values (p_post_id, p_viewer_id, p_session, greatest(coalesce(p_duration, 0), 0))
  on conflict (post_id, session_id) do update
    set duration_sec = greatest(post_video_views.duration_sec, excluded.duration_sec),
        viewed_at    = now()
  returning duration_sec into v_now;

  -- Only act when this session has just crossed the three second threshold.
  if coalesce(v_prev, 0) >= 3 or v_now < 3 then
    return;
  end if;

  if p_viewer_id is null then
    v_first_for_viewer := true;
  else
    v_first_for_viewer := not exists (
      select 1 from post_video_views
      where post_id = p_post_id
        and viewer_id = p_viewer_id
        and session_id <> p_session
        and duration_sec >= 3
    );
  end if;

  if v_first_for_viewer then
    update posts set views_count = coalesce(views_count, 0) + 1 where id = p_post_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_user_interests()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
delete from user_interests;
insert into user_interests (user_id, topic, score, updated_at)
select uid, topic, ln(1 + sum(pts)), now()
from (
  select pl.user_id as uid, p.category as topic, 3.0 as pts
  from post_likes pl join posts p on p.id = pl.post_id
  where pl.created_at > now() - interval '30 days' and p.category is not null
  union all
  select c.user_id, p.category, 4.0
  from post_comments c join posts p on p.id = c.post_id
  where c.created_at > now() - interval '30 days' and p.category is not null
  union all
  select r.user_id, p.category, 4.0
  from post_reposts r join posts p on p.id = r.post_id
  where r.created_at > now() - interval '30 days' and p.category is not null
  union all
  select b.user_id, p.category, 5.0
  from post_bookmarks b join posts p on p.id = b.post_id
  where b.created_at > now() - interval '30 days' and p.category is not null
  union all
  select s.user_id, p.category, 0.5
  from post_seen s join posts p on p.id = s.post_id
  where s.seen_at > now() - interval '30 days' and p.category is not null
) x
group by uid, topic;
$function$
;

CREATE OR REPLACE FUNCTION public.refuse_blocked_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.contains_blocked(coalesce(new.content, '') || ' ' || coalesce(new.body, '')) then
    raise exception 'This content contains language that is not allowed on Platinum Circles.';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_business_member(p_business_id uuid, p_member_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owners int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_business_owner(p_business_id) and auth.uid() <> p_member_id then
    raise exception 'Only an owner can remove other members';
  end if;

  select count(*) into v_owners
  from business_members where business_id = p_business_id and role = 'owner';

  if v_owners <= 1 and exists (
       select 1 from business_members
       where business_id = p_business_id and member_id = p_member_id and role = 'owner') then
    raise exception 'A business must keep at least one owner';
  end if;

  delete from business_members
  where business_id = p_business_id and member_id = p_member_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_community_post(p_post uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_comm uuid;
begin
  select community_id into v_comm from posts where id = p_post;
  if v_comm is null then raise exception 'Not a community post'; end if;
  if not exists (select 1 from community_members m where m.community_id = v_comm and m.user_id = auth.uid() and m.role in ('owner','moderator')) then
    raise exception 'Only the owner and moderators remove posts';
  end if;
  delete from posts where id = p_post;
end $function$
;

CREATE OR REPLACE FUNCTION public.remove_follower(p_follower_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from follows where follower_id = p_follower_id and following_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.repair_call_record_resolution()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
begin
  return 'run the two statements below separately';
end $function$
;

CREATE OR REPLACE FUNCTION public.reply_channel_message(p_message uuid, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid; ch channels%rowtype; rid uuid;
begin
  uid := auth.uid();
  select c.* into ch from channels c join channel_messages m on m.channel_id = c.id where m.id = p_message;
  if not found then raise exception 'Message not found'; end if;
  if not ch.replies_enabled then raise exception 'Replies are off for this channel'; end if;
  if not exists (select 1 from channel_members cm where cm.channel_id = ch.id and cm.user_id = uid) then
    raise exception 'Join the channel to reply';
  end if;
  if coalesce(trim(p_content),'') = '' then raise exception 'Reply is empty'; end if;
  insert into channel_replies (message_id, user_id, content) values (p_message, uid, trim(p_content)) returning id into rid;
  update channel_messages set reply_count = reply_count + 1 where id = p_message;
  return rid;
end $function$
;

CREATE OR REPLACE FUNCTION public.resolve_join_request(p_community uuid, p_user uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from community_members m where m.community_id = p_community and m.user_id = auth.uid() and m.role in ('owner','moderator')) then
    raise exception 'Only the owner and moderators review requests';
  end if;
  if not exists (select 1 from community_join_requests where community_id = p_community and user_id = p_user) then
    raise exception 'No such request';
  end if;
  delete from community_join_requests where community_id = p_community and user_id = p_user;
  if p_approve then
    insert into community_members (community_id, user_id, role) values (p_community, p_user, 'member')
    on conflict (community_id, user_id) do nothing;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.resolve_personal_conversation(a uuid, b uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id from conversations c
  where c.type = 'direct'
    and coalesce(c.context, 'personal') = 'personal'
    and ((c.user_1 = a and c.user_2 = b) or (c.user_1 = b and c.user_2 = a))
  order by c.created_at asc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.respond_follow_request(p_request_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_requester_id uuid;
  v_target_id uuid;
  v_status text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if p_action not in ('accept', 'reject') then raise exception 'Action must be accept or reject'; end if;

  select requester_id, target_id, status into v_requester_id, v_target_id, v_status
  from follow_requests where id = p_request_id;

  if v_requester_id is null then raise exception 'Follow request not found'; end if;
  if v_caller != v_target_id then raise exception 'Not authorized to respond to this request'; end if;
  if v_status != 'pending' then raise exception 'Request already handled'; end if;

  if p_action = 'accept' then
    insert into follows (follower_id, following_id)
    values (v_requester_id, v_target_id) on conflict do nothing;
    update follow_requests set status = 'accepted', updated_at = now() where id = p_request_id;
    return jsonb_build_object('action', 'accepted', 'follower_id', v_requester_id);
  else
    update follow_requests set status = 'rejected', updated_at = now() where id = p_request_id;
    return jsonb_build_object('action', 'rejected', 'follower_id', v_requester_id);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.respond_offer(p_offer_id uuid, p_action text, p_counter_amount numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_o record; v_conv uuid; v_meta text; v_other uuid; v_new uuid;
begin
  select * into v_o from listing_offers where id = p_offer_id;
  if v_o.id is null then raise exception 'offer not found'; end if;
  if v_o.status <> 'pending' then raise exception 'offer already resolved'; end if;
  if auth.uid() not in (v_o.buyer_id, v_o.seller_id) then raise exception 'not your offer'; end if;
  if p_action = 'withdrawn' and auth.uid() <> v_o.proposer_id then raise exception 'only the proposer withdraws'; end if;
  if p_action in ('accepted','declined','countered') and auth.uid() = v_o.proposer_id then
    raise exception 'the other side responds to this offer';
  end if;
  if p_action not in ('accepted','declined','countered','withdrawn') then raise exception 'bad action'; end if;

  update listing_offers set status = p_action, responded_at = now() where id = p_offer_id;

  v_other := case when auth.uid() = v_o.buyer_id then v_o.seller_id else v_o.buyer_id end;
  select start_dm_ctx(v_other, 'market', v_o.listing_id) into v_conv;

  if p_action = 'countered' then
    if p_counter_amount is null or p_counter_amount <= 0 then raise exception 'counter needs an amount'; end if;
    insert into listing_offers (listing_id, buyer_id, seller_id, proposer_id, amount, currency)
    values (v_o.listing_id, v_o.buyer_id, v_o.seller_id, auth.uid(), p_counter_amount, v_o.currency)
    returning id into v_new;
    v_meta := jsonb_build_object('offer_id', v_new, 'listing_id', v_o.listing_id,
      'listing_title', (select title from marketplace_listings where id = v_o.listing_id),
      'amount', p_counter_amount, 'currency', v_o.currency, 'status', 'pending',
      'counter_of', p_offer_id)::text;
    insert into messages (conversation_id, sender_id, receiver_id, text, media_type, media_url)
    values (v_conv, auth.uid(), v_other,
      'Counter-offer: ' || v_o.currency || ' ' || p_counter_amount::text, 'offer', v_meta);
  else
    insert into messages (conversation_id, sender_id, receiver_id, text, media_type, is_system_message)
    values (v_conv, auth.uid(), v_other,
      case p_action when 'accepted' then '✅ Offer accepted'
                    when 'declined' then 'Offer declined'
                    else 'Offer withdrawn' end, null, true);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_push_token(p_user_id uuid, p_token text, p_device_name text DEFAULT NULL::text, p_platform text DEFAULT 'ios'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Remove this token from any other user
  DELETE FROM user_push_tokens
  WHERE expo_push_token = p_token
  AND user_id != p_user_id;

  -- Upsert for current user
  INSERT INTO user_push_tokens (user_id, expo_push_token, device_name, platform, updated_at)
  VALUES (p_user_id, p_token, p_device_name, p_platform, NOW())
  ON CONFLICT (expo_push_token)
  DO UPDATE SET
    user_id = p_user_id,
    device_name = p_device_name,
    platform = p_platform,
    updated_at = NOW();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_voip_token(p_expo_token text, p_voip_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update user_push_tokens
     set voip_token = p_voip_token, updated_at = now()
   where user_id = auth.uid()
     and (expo_push_token = p_expo_token or p_expo_token is null or p_expo_token = '');
  if not found then
    insert into user_push_tokens (user_id, expo_push_token, voip_token, platform)
    values (auth.uid(), coalesce(nullif(p_expo_token, ''), 'voip-only'), p_voip_token, 'ios');
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.search_articles(p_q text, p_limit integer DEFAULT 6)
 RETURNS TABLE(post_id uuid, article_title text, read_minutes integer, created_at timestamp with time zone, author_name text, author_username text, author_avatar text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select p.id, coalesce(p.article_title, left(p.content, 80)), p.read_minutes, p.created_at,
       pr.full_name, pr.username, pr.avatar_url
from posts p
join profiles pr on pr.id = p.user_id
where (p.channel = 'article' or p.article_title is not null)
  and (p.article_title ilike '%' || p_q || '%'
       or p.content ilike '%' || p_q || '%'
       or p.body ilike '%' || p_q || '%')
  and (coalesce(p.audience, 'everyone') = 'everyone' or p.user_id = auth.uid())
  and not exists (select 1 from blocked_users b
                  where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                     or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
  and not exists (select 1 from profiles px
                  where px.id = p.user_id and px.profile_visibility = 'private'
                    and px.id <> auth.uid()
                    and not exists (select 1 from follows f
                                    where f.follower_id = auth.uid() and f.following_id = p.user_id))
order by p.created_at desc
limit least(coalesce(p_limit, 6), 12);
$function$
;

CREATE OR REPLACE FUNCTION public.search_jobs_fts(p_q text, p_limit integer DEFAULT 20)
 RETURNS SETOF jobs
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select j.* from jobs j
  where j.search_tsv @@ websearch_to_tsquery('simple', p_q)
  order by (ts_rank_cd(j.search_tsv, websearch_to_tsquery('simple', p_q), 32)
    * (case when position(lower(p_q) in lower(coalesce(j.title,'') || ' ' || coalesce(j.company,''))) > 0 then 3.0 else 1.0 end)) desc,
    j.created_at desc
  limit least(coalesce(p_limit, 20), 40);
$function$
;

CREATE OR REPLACE FUNCTION public.search_listings_fts(p_q text, p_limit integer DEFAULT 20)
 RETURNS SETOF marketplace_listings
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.* from marketplace_listings m
  where m.status = 'available' and m.hidden_at is null
    and m.search_tsv @@ websearch_to_tsquery('simple', p_q)
  order by (ts_rank_cd(m.search_tsv, websearch_to_tsquery('simple', p_q), 32)
    * (case when position(lower(p_q) in lower(coalesce(m.title,''))) > 0 then 3.0 else 1.0 end)) desc,
    m.created_at desc
  limit least(coalesce(p_limit, 20), 40);
$function$
;

CREATE OR REPLACE FUNCTION public.search_media(p_q text, p_limit integer DEFAULT 18)
 RETURNS TABLE(post_id uuid, url text, media_type text, width integer, height integer, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select p.id, m.url, m.media_type, m.width, m.height, p.created_at
from post_media m
join posts p on p.id = m.post_id
where (p.content ilike '%' || p_q || '%'
       or p.body ilike '%' || p_q || '%'
       or p.article_title ilike '%' || p_q || '%'
       or m.alt_text ilike '%' || p_q || '%')
  and (coalesce(p.audience, 'everyone') = 'everyone' or p.user_id = auth.uid())
  and not exists (select 1 from blocked_users b
                  where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                     or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
  and not exists (select 1 from profiles px
                  where px.id = p.user_id and px.profile_visibility = 'private'
                    and px.id <> auth.uid()
                    and not exists (select 1 from follows f
                                    where f.follower_id = auth.uid() and f.following_id = p.user_id))
order by p.created_at desc
limit least(coalesce(p_limit, 18), 36);
$function$
;

CREATE OR REPLACE FUNCTION public.search_people(p_q text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, full_name text, username text, avatar_url text, is_verified boolean, verified_tier text, rank real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid;
  qn text;
begin
  uid := auth.uid();
  qn := lower(trim(coalesce(p_q,'')));
  if qn = '' then return; end if;
  return query
  select pr.id, pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.verified_tier,
         ((case when lower(pr.username) = qn then 1000.0
                when lower(pr.username) like qn || '%' then 500.0
                when lower(coalesce(pr.full_name,'')) = qn then 400.0
                when lower(coalesce(pr.full_name,'')) like qn || '%' then 250.0
                else 0.0 end)
          + greatest(similarity(coalesce(pr.username,''), qn), similarity(coalesce(pr.full_name,''), qn)) * 100.0
          + ts_rank_cd(pr.search_tsv, websearch_to_tsquery('simple', p_q), 32) * 10.0
         )::real as rnk
  from profiles pr
  where (lower(pr.username) like qn || '%'
         or lower(coalesce(pr.full_name,'')) like '%' || qn || '%'
         or similarity(coalesce(pr.username,''), qn) > 0.3
         or similarity(coalesce(pr.full_name,''), qn) > 0.3
         or pr.search_tsv @@ websearch_to_tsquery('simple', p_q))
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = uid and b.blocked_id = pr.id)
                       or (b.blocker_id = pr.id and b.blocked_id = uid))
  order by rnk desc
  limit least(coalesce(p_limit, 20), 40);
end $function$
;

CREATE OR REPLACE FUNCTION public.search_places(p_q text)
 RETURNS TABLE(name text, kind text, hits integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select name, kind, count(*)::int as hits from (
  select j.location as name, 'jobs' as kind from jobs j
  where j.location ilike '%' || p_q || '%'
  union all
  select l.location_city, 'market' from marketplace_listings l
  where l.status = 'available' and l.location_city ilike '%' || p_q || '%'
  union all
  select pr.location, 'people' from profiles pr
  where pr.location ilike '%' || p_q || '%'
) x
where name is not null and btrim(name) <> ''
group by name, kind
order by hits desc
limit 6;
$function$
;

CREATE OR REPLACE FUNCTION public.search_posts(p_q text, p_mode text DEFAULT 'top'::text, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(post_id uuid, content text, body text, article_title text, created_at timestamp with time zone, author_id uuid, author_name text, author_username text, author_avatar text, likes_count integer, comments_count integer, media jsonb, rank real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q tsquery;
  uid uuid;
begin
  uid := auth.uid();
  if coalesce(trim(p_q),'') = '' then return; end if;
  q := websearch_to_tsquery('simple', p_q);
  return query
  select p.id, p.content, p.body, p.article_title, p.created_at,
         pr.id, pr.full_name, pr.username, pr.avatar_url,
         p.likes_count, p.comments_count,
         coalesce((select jsonb_agg(jsonb_build_object('url', pm.url, 'media_type', pm.media_type, 'width', pm.width, 'height', pm.height) order by pm.sort_order nulls last)
                   from post_media pm where pm.post_id = p.id), '[]'::jsonb) as media,
         (ts_rank_cd(p.search_tsv, q, 32)
           * (case when position(lower(p_q) in lower(coalesce(p.content,'') || ' ' || coalesce(p.body,'') || ' ' || coalesce(p.article_title,''))) > 0 then 3.0 else 1.0 end)
           * (case when p_mode = 'top' then (1.0 + 2.0 / (1.0 + extract(epoch from (now() - p.created_at)) / 604800.0)) else 1.0 end)
         )::real as rnk
  from posts p
  join profiles pr on pr.id = p.user_id
  where p.search_tsv @@ q
    and p.community_id is null
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = uid and b.blocked_id = p.user_id)
                       or (b.blocker_id = p.user_id and b.blocked_id = uid))
    and (p.user_id = uid
         or coalesce(pr.profile_visibility, 'public') <> 'private'
         or exists (select 1 from follows f where f.follower_id = uid and f.following_id = p.user_id))
    and (coalesce(p.audience, 'everyone') = 'everyone'
         or p.user_id = uid
         or (p.audience = 'followers' and exists (select 1 from follows f where f.following_id = p.user_id and f.follower_id = uid))
         or (p.audience = 'verified' and exists (select 1 from profiles vp where vp.id = uid and vp.is_verified)))
    and (p_mode <> 'latest' or p_cursor is null or (p.created_at, p.id) < (p_cursor, coalesce(p_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by (case when p_mode = 'latest' then p.created_at end) desc nulls last,
           (case when p_mode = 'latest' then p.id end) desc nulls last,
           rnk desc, p.created_at desc
  limit least(coalesce(p_limit, 20), 50);
end $function$
;

CREATE OR REPLACE FUNCTION public.search_typeahead(p_q text, p_limit integer DEFAULT 8)
 RETURNS TABLE(kind text, id uuid, label text, sublabel text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'person'::text, pr.id, coalesce(pr.full_name, '@' || pr.username), '@' || pr.username, pr.avatar_url
  from profiles pr
  where lower(pr.username) like lower(trim(p_q)) || '%'
     or lower(coalesce(pr.full_name,'')) like lower(trim(p_q)) || '%'
  order by (case when lower(pr.username) = lower(trim(p_q)) then 0 else 1 end),
           length(pr.username)
  limit least(coalesce(p_limit, 8), 12);
$function$
;

CREATE OR REPLACE FUNCTION public.set_business_member_role(p_business_id uuid, p_member_id uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owners int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_business_owner(p_business_id) then
    raise exception 'Only an owner can change roles';
  end if;
  if p_role not in ('owner', 'manager', 'contributor') then
    raise exception 'Role must be owner, manager or contributor';
  end if;

  select count(*) into v_owners
  from business_members where business_id = p_business_id and role = 'owner';

  if p_role <> 'owner' and v_owners <= 1 and exists (
       select 1 from business_members
       where business_id = p_business_id and member_id = p_member_id and role = 'owner') then
    raise exception 'A business must keep at least one owner';
  end if;

  update business_members set role = p_role
  where business_id = p_business_id and member_id = p_member_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_business_review(p_business_id uuid, p_rating smallint, p_body text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_bp uuid;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1 to 5'; end if;

  -- Nobody reviews their own business. The rating is worthless otherwise.
  if is_business_member(p_business_id) then
    raise exception 'You cannot review a business you manage';
  end if;

  select id into v_bp from business_profiles where profile_id = p_business_id;
  if v_bp is null then raise exception 'That profile is not a business'; end if;

  insert into business_reviews (business_id, user_id, rating, body)
  values (v_bp, v_me, p_rating, nullif(trim(p_body), ''))
  on conflict (user_id, business_id) do update
    set rating = excluded.rating, body = excluded.body, updated_at = now();

  return jsonb_build_object(
    'rating', p_rating,
    'avg_rating', (select avg_rating from business_profiles where id = v_bp),
    'review_count', (select review_count from business_profiles where id = v_bp));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_channel_notifications(p_channel uuid, p_level text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_level not in ('all','highlights','mute') then raise exception 'Bad level'; end if;
  update channel_members
     set notification_level = p_level, muted = (p_level = 'mute')
   where channel_id = p_channel and user_id = auth.uid();
  if not found then raise exception 'Join the channel first'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_channel_role(p_channel uuid, p_user uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner uuid;
begin
  select owner_id into v_owner from channels where id = p_channel;
  if v_owner is null then raise exception 'No such channel'; end if;
  if v_owner <> auth.uid() then raise exception 'Only the owner manages roles'; end if;
  if p_user = v_owner then raise exception 'The owner role cannot change'; end if;
  if p_role = 'remove' then
    delete from channel_members where channel_id = p_channel and user_id = p_user;
    return;
  end if;
  if p_role not in ('collaborator','moderator','member') then raise exception 'Bad role'; end if;
  insert into channel_members (channel_id, user_id, role, notification_level)
  values (p_channel, p_user, p_role, 'all')
  on conflict (channel_id, user_id) do update set role = excluded.role;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_comment_reaction(p_comment_id uuid, p_value smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_existing smallint;
  v_final smallint;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_value not in (-1, 1) then raise exception 'value must be 1 or -1'; end if;

  select value into v_existing from comment_reactions
  where comment_id = p_comment_id and user_id = v_me;

  if v_existing is null then
    insert into comment_reactions (comment_id, user_id, value)
    values (p_comment_id, v_me, p_value);
    v_final := p_value;
  elsif v_existing = p_value then
    delete from comment_reactions where comment_id = p_comment_id and user_id = v_me;
    v_final := 0;
  else
    update comment_reactions set value = p_value
    where comment_id = p_comment_id and user_id = v_me;
    v_final := p_value;
  end if;

  return jsonb_build_object(
    'value', v_final,
    'likes',    (select likes_count    from post_comments where id = p_comment_id),
    'dislikes', (select dislikes_count from post_comments where id = p_comment_id)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_community_role(p_community uuid, p_user uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner uuid;
begin
  select owner_id into v_owner from communities where id = p_community;
  if v_owner is null then raise exception 'No such community'; end if;
  if v_owner <> auth.uid() then raise exception 'Only the owner manages roles'; end if;
  if p_user = v_owner then raise exception 'The owner role cannot change'; end if;
  if p_role = 'remove' then
    delete from community_members where community_id = p_community and user_id = p_user;
    return;
  end if;
  if p_role not in ('moderator','member') then raise exception 'Bad role'; end if;
  insert into community_members (community_id, user_id, role) values (p_community, p_user, p_role)
  on conflict (community_id, user_id) do update set role = excluded.role;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_disappearing_messages(p_conversation_id uuid, p_seconds integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from conversations c
    where c.id = p_conversation_id
      and (c.user_1 = auth.uid() or c.user_2 = auth.uid()
           or exists (select 1 from conversation_members m
                      where m.conversation_id = c.id and m.user_id = auth.uid()))
  ) then
    raise exception 'Not a participant in this conversation';
  end if;

  update conversations
     set disappearing_seconds = p_seconds,
         disappearing_set_by = auth.uid(),
         disappearing_set_at = now()
   where id = p_conversation_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_pinned_message(p_conversation_id uuid, p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from conversations c
    where c.id = p_conversation_id
      and (
        c.user_1 = auth.uid() or c.user_2 = auth.uid()
        or exists (select 1 from conversation_members cm where cm.conversation_id = c.id and cm.user_id = auth.uid())
        or public.is_business_member(c.user_1) or public.is_business_member(c.user_2)
      )
  ) then raise exception 'not a participant'; end if;
  if p_message_id is not null and not exists (
    select 1 from messages m where m.id = p_message_id and m.conversation_id = p_conversation_id
  ) then raise exception 'message not in conversation'; end if;
  update conversations set pinned_message_id = p_message_id where id = p_conversation_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_post_products(p_post_id uuid, p_products jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_author uuid;
  v_count int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select user_id into v_author from posts where id = p_post_id;
  if v_author is null then raise exception 'Post not found'; end if;
  if not can_act_as(v_author) then
    raise exception 'Only the author can set products';
  end if;

  delete from post_products where post_id = p_post_id;

  insert into post_products (post_id, sort_order, title, subtitle, price, currency,
                             image_url, listing_id, link_url, cta_label)
  select p_post_id,
         coalesce((elem->>'sort_order')::int, ord - 1),
         elem->>'title',
         nullif(elem->>'subtitle', ''),
         nullif(elem->>'price', '')::numeric,
         coalesce(nullif(elem->>'currency', ''), 'USD'),
         nullif(elem->>'image_url', ''),
         nullif(elem->>'listing_id', '')::uuid,
         nullif(elem->>'link_url', ''),
         coalesce(nullif(elem->>'cta_label', ''), 'View')
  from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) with ordinality as t(elem, ord);

  select count(*) into v_count from post_products where post_id = p_post_id;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.stamp_conversation_account_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.account_type IS NULL THEN
    IF NEW.is_group = false AND NEW.user_1 IS NOT NULL THEN
      SELECT COALESCE(account_type, 'public') INTO NEW.account_type
      FROM profiles WHERE id = NEW.user_1;
    ELSIF NEW.created_by IS NOT NULL THEN
      SELECT COALESCE(account_type, 'public') INTO NEW.account_type
      FROM profiles WHERE id = NEW.created_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.stamp_follow_account_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.account_type IS NULL THEN
    SELECT COALESCE(account_type, 'public') INTO NEW.account_type
    FROM profiles WHERE id = NEW.follower_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.stamp_notification_account_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.account_type IS NULL THEN
    SELECT COALESCE(account_type, 'public') INTO NEW.account_type
    FROM profiles WHERE id = NEW.recipient_id;

    IF NEW.account_type IS NULL AND NEW.actor_id IS NOT NULL THEN
      SELECT COALESCE(account_type, 'public') INTO NEW.account_type
      FROM profiles WHERE id = NEW.actor_id;
    END IF;

    IF NEW.account_type IS NULL THEN
      NEW.account_type := 'public';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.stamp_post_account_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.account_type is null then
    select account_type into new.account_type
    from public.profiles where id = new.user_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.start_dm_ctx(p_receiver_id uuid, p_context text DEFAULT 'personal'::text, p_ref_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; a uuid; b uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_receiver_id = auth.uid() then raise exception 'cannot message yourself'; end if;
  a := least(auth.uid(), p_receiver_id);
  b := greatest(auth.uid(), p_receiver_id);

  select id into v_id from public.conversations
   where type = 'direct' and coalesce(is_group, false) = false
     and ((user_1 = a and user_2 = b) or (user_1 = b and user_2 = a))
     and coalesce(context, 'personal') = p_context
   order by created_at asc
   limit 1;

  if v_id is not null then
    if p_ref_id is not null then
      update public.conversations set context_ref_id = p_ref_id where id = v_id;
    end if;
    return v_id;
  end if;

  insert into public.conversations (user_1, user_2, type, is_group, context, context_ref_id, last_message, last_message_time)
  values (a, b, 'direct', false, p_context, p_ref_id, '', now())
  returning id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.start_group_call(p_conversation_id uuid, p_is_video boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid := gen_random_uuid();
begin
  perform sweep_dead_calls();
  if not is_conversation_member(p_conversation_id, auth.uid()) then
    raise exception 'not a member of this group';
  end if;
  if exists (select 1 from call_sessions
             where conversation_id = p_conversation_id
               and status in ('ringing', 'active')) then
    raise exception 'a call is already running in this group';
  end if;

  insert into call_sessions (id, conversation_id, initiator_id, call_type, status, is_video, is_group_call, agora_channel)
  values (v_id, p_conversation_id, auth.uid(), case when p_is_video then 'video' else 'voice' end, 'ringing', p_is_video, true, v_id::text);

  insert into call_participants (call_session_id, user_id, status, joined_at)
  select v_id, cm.user_id,
         case when cm.user_id = auth.uid() then 'joined' else 'invited' end,
         case when cm.user_id = auth.uid() then now() else null end
  from conversation_members cm
  where cm.conversation_id = p_conversation_id;

  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_add_ad(p_campaign uuid, p_post_id uuid, p_label text DEFAULT 'Sponsored'::text, p_total_cap integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; v_id uuid;
begin
  perform studio_require(array['owner','admin','editor']);
  select * into c from studio_campaigns where id = p_campaign and owner_id = auth.uid();
  if c is null then raise exception 'No such campaign'; end if;
  if c.status in ('ended') then raise exception 'Campaign has ended'; end if;
  if not exists (select 1 from posts where id = p_post_id and user_id = auth.uid()) then raise exception 'Only your own posts can be promoted'; end if;
  if exists (select 1 from promoted_posts where campaign_id = p_campaign and post_id = p_post_id) then raise exception 'That post is already in this campaign'; end if;
  insert into promoted_posts (post_id, advertiser_id, label, status, starts_at, ends_at, total_cap, campaign_id)
  values (p_post_id, auth.uid(), coalesce(nullif(trim(p_label),''),'Sponsored'), case when c.status = 'live' then 'active' else 'paused' end, coalesce(c.starts_at, now()), c.ends_at, p_total_cap, p_campaign)
  returning id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_add_note(p_application uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_member uuid;
begin
  perform studio_require(array['owner','admin','recruiter']);
  if not exists (select 1 from job_applications a join jobs j on j.id = a.job_id where a.id = p_application and j.posted_by = auth.uid()) then raise exception 'Not your application'; end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'Empty note'; end if;
  select member_id into v_member from studio_session_members where session_id = auth.jwt() ->> 'session_id';
  insert into studio_applicant_notes (application_id, owner_id, author_member_id, body) values (p_application, auth.uid(), v_member, trim(p_body)) returning id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_ads_watch()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; n int := 0;
begin
  for r in
    select pp.id, pp.advertiser_id, pp.ends_at, pp.total_cap, pp.impressions_count, pp.notified_ending, pp.status, pp.campaign_id, c.name as cname, left(coalesce(p.content, p.body, 'your ad'), 60) as snippet
    from promoted_posts pp left join studio_campaigns c on c.id = pp.campaign_id left join posts p on p.id = pp.post_id
    where pp.status = 'active'
  loop
    if (r.ends_at is not null and r.ends_at <= now()) or (r.total_cap is not null and r.impressions_count >= r.total_cap) then
      update promoted_posts set status = 'ended' where id = r.id;
      insert into notifications (recipient_id, actor_id, type, message, data)
      values (r.advertiser_id, null, 'ad_ended', 'Your ad finished: ' || coalesce(r.cname, r.snippet) || case when r.total_cap is not null and r.impressions_count >= r.total_cap then ' reached its impression cap.' else ' reached its end date.' end,
        jsonb_build_object('promo_id', r.id, 'campaign_id', r.campaign_id));
      n := n + 1;
    elsif not r.notified_ending and ((r.ends_at is not null and r.ends_at <= now() + interval '48 hours') or (r.total_cap is not null and r.impressions_count >= r.total_cap * 0.9)) then
      update promoted_posts set notified_ending = true where id = r.id;
      insert into notifications (recipient_id, actor_id, type, message, data)
      values (r.advertiser_id, null, 'ad_ending', 'Your ad is about to finish: ' || coalesce(r.cname, r.snippet) || '. Extend it in Studio if you want it to keep running.',
        jsonb_build_object('promo_id', r.id, 'campaign_id', r.campaign_id));
      n := n + 1;
    end if;
  end loop;
  update studio_campaigns c set status = 'ended', updated_at = now()
  where c.status in ('live','paused','approved') and c.ends_at is not null and c.ends_at <= now();
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_applicants(p_job uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','recruiter']);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'status', studio_stage(a.status), 'applied_at', a.applied_at, 'updated_at', a.updated_at,
    'cover_note', a.cover_note, 'cover_letter', a.cover_letter, 'cv_url', a.cv_url, 'cv_name', a.cv_name,
    'phone', a.applicant_phone, 'portfolio_url', a.portfolio_url, 'interview_at', a.interview_at, 'interview_location', a.interview_location,
    'applicant_id', p.id, 'name', coalesce(p.full_name, p.username, 'Applicant'), 'username', p.username, 'avatar_url', p.avatar_url, 'bio', p.bio, 'location', p.location,
    'tags', coalesce((select jsonb_agg(t.tag order by t.tag) from studio_applicant_tags t where t.application_id = a.id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at, 'author', m.display_name) order by n.created_at)
                       from studio_applicant_notes n left join business_access_members m on m.id = n.author_member_id where n.application_id = a.id), '[]'::jsonb)
  ) order by a.applied_at desc)
  from job_applications a join jobs j on j.id = a.job_id join profiles p on p.id = a.applicant_id
  where j.id = p_job and j.posted_by = auth.uid()), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_audience(p_q text DEFAULT NULL::text, p_label text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', coalesce(p.full_name, p.username, 'Member'), 'username', p.username, 'avatar_url', p.avatar_url, 'location', p.location,
    'followed_at', f.created_at, 'label', l.label, 'note', l.note,
    'paid', (select count(*) from chat_payments cp where cp.sender_id = p.id and cp.recipient_id = auth.uid() and cp.completed_at is not null),
    'messages', (select count(*) from messages m where m.sender_id = p.id and m.receiver_id = auth.uid())
  ) order by f.created_at desc), '[]'::jsonb)
  from (select follower_id, created_at from follows where following_id = auth.uid() order by created_at desc limit least(coalesce(p_limit,200), 1000)) f
  join profiles p on p.id = f.follower_id
  left join studio_contact_labels l on l.owner_id = auth.uid() and l.contact_id = p.id
  where (p_label is null or l.label = p_label)
    and (p_q is null or trim(p_q) = '' or p.full_name ilike '%' || trim(p_q) || '%' or p.username ilike '%' || trim(p_q) || '%');
$function$
;

CREATE OR REPLACE FUNCTION public.studio_audience_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'followers', (select count(*) from follows where following_id = auth.uid()),
    'new_30d', (select count(*) from follows where following_id = auth.uid() and created_at > now() - interval '30 days'),
    'customers', (select count(distinct sender_id) from chat_payments where recipient_id = auth.uid() and completed_at is not null),
    'labels', coalesce((select jsonb_object_agg(label, n) from (select label, count(*) as n from studio_contact_labels where owner_id = auth.uid() group by label) x), '{}'::jsonb),
    'top_cities', coalesce((select jsonb_agg(jsonb_build_object('city', city, 'n', n) order by n desc) from (
        select coalesce(nullif(trim(p.location),''), 'Unknown') as city, count(*) as n from follows f join profiles p on p.id = f.follower_id where f.following_id = auth.uid() group by 1 order by n desc limit 6) c), '[]'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION public.studio_bind_member(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_sid text; v_hash text; m record;
begin
  if not exists (select 1 from profiles where id = auth.uid() and account_type = 'business') then raise exception 'Not a business session'; end if;
  v_sid := auth.jwt() ->> 'session_id';
  if v_sid is null then raise exception 'No session id in token'; end if;
  v_hash := upper(encode(digest(trim(p_code), 'sha256'), 'hex'));
  select id, role, display_name into m from business_access_members
  where business_id = auth.uid() and active and upper(code_hash) in (v_hash, upper(encode(digest(upper(trim(p_code)), 'sha256'), 'hex')));
  if m is null then raise exception 'Code not recognised'; end if;
  insert into studio_session_members (session_id, business_id, member_id) values (v_sid, auth.uid(), m.id)
  on conflict (session_id) do update set member_id = excluded.member_id, business_id = excluded.business_id, bound_at = now();
  update business_access_members set last_sign_in_at = now() where id = m.id;
  return jsonb_build_object('member_id', m.id, 'role', m.role, 'display_name', m.display_name);
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_business_info()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('id', id, 'full_name', full_name, 'username', username, 'avatar_url', avatar_url, 'bio', bio, 'is_verified', is_verified) from profiles where id = auth.uid()),
    'business', (select to_jsonb(b) - 'owner_id' from business_profiles b where b.profile_id = auth.uid() limit 1),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'role', role, 'active', active, 'last_sign_in_at', last_sign_in_at, 'created_at', created_at) order by created_at) from business_access_members where business_id = auth.uid()), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'device_id', device_id, 'label', label, 'status', status, 'created_at', created_at, 'approved_at', approved_at) order by created_at desc) from business_devices where business_id = auth.uid()), '[]'::jsonb),
    'signins', coalesce((select jsonb_agg(jsonb_build_object('member_name', member_name, 'device_id', device_id, 'created_at', created_at) order by created_at desc) from (select * from business_signin_log where business_id = auth.uid() order by created_at desc limit 20) s), '[]'::jsonb),
    'role', studio_role());
$function$
;

CREATE OR REPLACE FUNCTION public.studio_campaigns()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','editor']);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'objective', c.objective, 'budget', c.budget, 'currency', c.currency, 'payment_method', c.payment_method,
    'payment_ref', c.payment_ref, 'paid_amount', c.paid_amount, 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'status', c.status,
    'review_note', c.review_note, 'created_at', c.created_at,
    'impressions', coalesce((select sum(impressions_count) from promoted_posts pp where pp.campaign_id = c.id), 0),
    'clicks', coalesce((select sum(clicks_count) from promoted_posts pp where pp.campaign_id = c.id), 0),
    'ads', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pp.id, 'post_id', pp.post_id, 'label', pp.label, 'status', pp.status, 'total_cap', pp.total_cap,
        'impressions', pp.impressions_count, 'clicks', pp.clicks_count, 'starts_at', pp.starts_at, 'ends_at', pp.ends_at,
        'content', left(coalesce(p.content, p.body, ''), 140),
        'thumb', (select m.url from post_media m where m.post_id = p.id order by m.sort_order nulls last limit 1),
        'products', (select count(*) from post_products x where x.post_id = p.id)
      ) order by pp.impressions_count desc) from promoted_posts pp join posts p on p.id = pp.post_id where pp.campaign_id = c.id), '[]'::jsonb)
  ) order by case c.status when 'live' then 0 when 'approved' then 1 when 'submitted' then 2 when 'paused' then 3 when 'draft' then 4 when 'rejected' then 5 else 6 end, c.created_at desc)
  from studio_campaigns c where c.owner_id = auth.uid()), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_cancel_post(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update studio_scheduled_posts set status = 'cancelled', updated_at = now()
  where id = p_id and owner_id = auth.uid() and status in ('scheduled','draft','failed');
$function$
;

CREATE OR REPLACE FUNCTION public.studio_catalog()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'title', l.title, 'price', l.price, 'currency', l.currency, 'category', l.category, 'condition', l.condition,
    'images', l.images, 'status', l.status, 'hidden', l.hidden_at is not null, 'created_at', l.created_at,
    'delivery_available', l.delivery_available, 'delivery_fee', l.delivery_fee,
    'pending_offers', (select count(*) from listing_offers o where o.listing_id = l.id and o.status = 'pending' and o.proposer_id <> auth.uid()),
    'sold_count', (select count(*) from chat_payments p where p.listing_id = l.id and p.recipient_id = auth.uid() and p.completed_at is not null),
    'in_posts', (select count(*) from post_products pp where pp.listing_id = l.id)
  ) order by case l.status when 'available' then 0 when 'sold' then 1 else 2 end, l.created_at desc), '[]'::jsonb)
  from marketplace_listings l where l.seller_id = auth.uid() and l.status <> 'removed';
$function$
;

CREATE OR REPLACE FUNCTION public.studio_close_job(p_job uuid, p_close boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','recruiter']);
  update jobs set deadline = case when p_close then now() else null end, updated_at = now() where id = p_job and posted_by = auth.uid();
  if not found then raise exception 'Not your job'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_create_member(p_name text, p_role text DEFAULT 'admin'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_result jsonb; v_code text;
begin
  perform studio_require(array['owner']);
  if p_role not in ('owner','admin','editor','recruiter','support') then raise exception 'Bad role'; end if;
  v_result := create_business_access_member(p_name);
  v_code := v_result->>'code';
  if v_code is null then raise exception 'Could not create the access code'; end if;
  update business_access_members set role = p_role where business_id = auth.uid() and display_name = p_name and created_at > now() - interval '1 minute';
  return v_code;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_delete_lead(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from studio_leads where id = p_id and owner_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.studio_delete_post(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from studio_scheduled_posts where id = p_id and owner_id = auth.uid() and status <> 'publishing';
$function$
;

CREATE OR REPLACE FUNCTION public.studio_delete_reply(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from studio_saved_replies where id = p_id and owner_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.studio_get_auto_replies()
 RETURNS SETOF studio_auto_replies
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from studio_auto_replies where owner_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.studio_get_business()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('full_name', full_name, 'username', username, 'bio', bio, 'avatar_url', avatar_url, 'is_verified', is_verified) from profiles where id = auth.uid()),
    'business', (select jsonb_build_object('id', id, 'category', category, 'location', location, 'address', address, 'phone', phone, 'email', email, 'website', website,
        'social_links', coalesce(social_links, '{}'::jsonb), 'hours', hours, 'is_verified', is_verified, 'avg_rating', avg_rating, 'review_count', review_count)
      from business_profiles where profile_id = auth.uid() limit 1),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'role', role, 'active', active, 'last_sign_in_at', last_sign_in_at, 'created_at', created_at) order by created_at) from business_access_members where business_id = auth.uid()), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'device_id', device_id, 'label', label, 'status', status, 'created_at', created_at, 'approved_at', approved_at) order by created_at desc) from business_devices where business_id = auth.uid()), '[]'::jsonb),
    'signins', coalesce((select jsonb_agg(jsonb_build_object('member_name', member_name, 'device_id', device_id, 'created_at', created_at) order by created_at desc) from (select * from business_signin_log where business_id = auth.uid() order by created_at desc limit 20) s), '[]'::jsonb),
    'role', studio_role()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.studio_get_storefront()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select to_jsonb(s) from studio_storefront s where s.owner_id = auth.uid()),
    jsonb_build_object('owner_id', auth.uid(), 'tagline', null, 'featured_listing_ids', '[]'::jsonb, 'delivery_default', false, 'delivery_fee_default', null, 'delivery_note_default', null));
$function$
;

CREATE OR REPLACE FUNCTION public.studio_get_threads()
 RETURNS SETOF studio_thread_state
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from studio_thread_state where owner_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.studio_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); t0 timestamptz := now() - interval '7 days'; t1 timestamptz := now() - interval '14 days';
  v_bp uuid; todos jsonb; nowm jsonb; prevm jsonb; pays jsonb; recent jsonb; best jsonb;
  c_un int := 0; c_off int := 0; c_app int := 0; c_ads int := 0; c_rev int := 0; c_sch int := 0; c_fail int := 0;
  n_posts int := 0; n_likes int := 0; n_comm int := 0; n_rep int := 0; n_views int := 0; n_fol int := 0; n_msg int := 0; n_imp int := 0; n_clk int := 0;
  p_posts int := 0; p_likes int := 0; p_comm int := 0; p_rep int := 0; p_views int := 0; p_fol int := 0; p_msg int := 0; p_imp int := 0; p_clk int := 0;
begin
  select id into v_bp from business_profiles where profile_id = me limit 1;
  begin
    select count(*) into c_un from conversations c
    where (c.user_1 = me or c.user_2 = me) and c.last_message_sender_id is not null and c.last_message_sender_id <> me
      and c.last_message_time > now() - interval '14 days'
      and not exists (select 1 from studio_thread_state s where s.owner_id = me and s.conversation_id = c.id and s.done);
  exception when others then c_un := 0; end;
  begin select count(*) into c_off from listing_offers where seller_id = me and proposer_id <> me and status = 'pending'; exception when others then c_off := 0; end;
  begin select count(*) into c_app from job_applications a join jobs j on j.id = a.job_id where j.posted_by = me and a.status = 'applied'; exception when others then c_app := 0; end;
  begin
    select count(*) into c_ads from promoted_posts where advertiser_id = me and status = 'active'
      and ((ends_at is not null and ends_at < now() + interval '3 days') or (total_cap is not null and impressions_count >= total_cap * 0.9));
  exception when others then c_ads := 0; end;
  begin select count(*) into c_rev from business_reviews where business_id = v_bp and created_at > now() - interval '30 days'; exception when others then c_rev := 0; end;
  select count(*) filter (where status = 'scheduled' and publish_at::date = current_date), count(*) filter (where status = 'failed')
    into c_sch, c_fail from studio_scheduled_posts where owner_id = me;
  todos := jsonb_build_object('unanswered', c_un, 'offers', c_off, 'applicants', c_app, 'ads_ending', c_ads, 'reviews', c_rev, 'scheduled_today', c_sch, 'failed_posts', c_fail);

  select count(*) filter (where created_at >= t0), count(*) filter (where created_at >= t1 and created_at < t0),
         coalesce(sum(views_count) filter (where created_at >= t0),0), coalesce(sum(views_count) filter (where created_at >= t1 and created_at < t0),0)
    into n_posts, p_posts, n_views, p_views from posts where user_id = me and created_at >= t1;
  begin
    select count(*) filter (where l.created_at >= t0), count(*) filter (where l.created_at >= t1 and l.created_at < t0) into n_likes, p_likes
    from post_likes l join posts p on p.id = l.post_id where p.user_id = me and l.created_at >= t1;
  exception when others then n_likes := 0; p_likes := 0; end;
  begin
    select count(*) filter (where c.created_at >= t0), count(*) filter (where c.created_at >= t1 and c.created_at < t0) into n_comm, p_comm
    from post_comments c join posts p on p.id = c.post_id where p.user_id = me and c.created_at >= t1;
  exception when others then n_comm := 0; p_comm := 0; end;
  begin
    select count(*) filter (where r.created_at >= t0), count(*) filter (where r.created_at >= t1 and r.created_at < t0) into n_rep, p_rep
    from post_reposts r join posts p on p.id = r.post_id where p.user_id = me and r.created_at >= t1;
  exception when others then n_rep := 0; p_rep := 0; end;
  begin select count(*) filter (where created_at >= t0), count(*) filter (where created_at >= t1 and created_at < t0) into n_fol, p_fol from follows where following_id = me and created_at >= t1; exception when others then n_fol := 0; p_fol := 0; end;
  begin select count(*) filter (where created_at >= t0), count(*) filter (where created_at >= t1 and created_at < t0) into n_msg, p_msg from messages where receiver_id = me and sender_id <> me and created_at >= t1; exception when others then n_msg := 0; p_msg := 0; end;
  begin
    select count(*) filter (where e.kind = 'impression' and e.created_at >= t0), count(*) filter (where e.kind = 'impression' and e.created_at >= t1 and e.created_at < t0),
           count(*) filter (where e.kind = 'click' and e.created_at >= t0), count(*) filter (where e.kind = 'click' and e.created_at >= t1 and e.created_at < t0)
      into n_imp, p_imp, n_clk, p_clk
    from ad_events e join promoted_posts pp on pp.id = e.promo_id where pp.advertiser_id = me and e.created_at >= t1;
  exception when others then n_imp := 0; p_imp := 0; n_clk := 0; p_clk := 0; end;
  nowm := jsonb_build_object('posts', n_posts, 'likes', n_likes, 'comments', n_comm, 'reposts', n_rep, 'views', n_views, 'followers', n_fol, 'messages', n_msg, 'ad_impressions', n_imp, 'ad_clicks', n_clk);
  prevm := jsonb_build_object('posts', p_posts, 'likes', p_likes, 'comments', p_comm, 'reposts', p_rep, 'views', p_views, 'followers', p_fol, 'messages', p_msg, 'ad_impressions', p_imp, 'ad_clicks', p_clk);

  begin
    select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'total', total, 'count', n)), '[]'::jsonb) into pays
    from (select currency, sum(amount) as total, count(*) as n from chat_payments where recipient_id = me and completed_at >= t0 group by currency) x;
  exception when others then pays := '[]'::jsonb; end;

  select coalesce(jsonb_agg(jsonb_build_object('post_id', id, 'content', content, 'body', body, 'created_at', created_at,
           'likes_count', coalesce(likes_count,0), 'comments_count', coalesce(comments_count,0), 'reposts_count', coalesce(reposts_count,0), 'views_count', coalesce(views_count,0)) order by created_at desc), '[]'::jsonb)
    into recent from (select * from posts where user_id = me order by created_at desc limit 5) r;

  begin
    select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'score', n) order by n desc), '[]'::jsonb) into best
    from (select extract(hour from l.created_at)::int as h, count(*) as n
          from post_likes l join posts p on p.id = l.post_id
          where p.user_id = me and l.created_at > now() - interval '90 days'
          group by 1 order by n desc limit 3) b;
  exception when others then best := '[]'::jsonb; end;

  return jsonb_build_object('todos', todos, 'now', nowm, 'prev', prevm, 'payments', pays, 'recent', recent, 'best_hours', best);
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_inbox(p_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_bp uuid; out jsonb;
begin
  select id into v_bp from business_profiles where profile_id = me limit 1;
  with dms as (
    select 'dm' as kind, c.id, c.id as ref, o.id as other_id, coalesce(o.full_name, o.username, 'Member') as title, o.username, o.avatar_url,
           c.last_message as preview, c.last_message_time as at, c.context,
           (select count(*)::int from messages m where m.conversation_id = c.id and m.receiver_id = me and m.read_at is null and m.deleted_at is null) as unread,
           (c.last_message_sender_id is not null and c.last_message_sender_id <> me) as waiting, null::numeric as amount, null::text as currency, null::text as status
    from conversations c
    join profiles o on o.id = case when c.user_1 = me then c.user_2 else c.user_1 end
    where (c.user_1 = me or c.user_2 = me) and coalesce(c.is_group,false) = false and c.last_message_time is not null
      and (p_filter in ('all','dm'))
    order by c.last_message_time desc limit least(p_limit, 200)
  ),
  offers as (
    select 'offer' as kind, o.id, o.listing_id as ref, b.id as other_id, coalesce(b.full_name, b.username, 'Buyer') as title, b.username, b.avatar_url,
           ('Offer ' || o.currency || ' ' || o.amount::text || ' on ' || l.title) as preview, o.created_at as at, 'market'::text as context,
           0 as unread, (o.proposer_id <> me) as waiting, o.amount, o.currency, o.status
    from listing_offers o join marketplace_listings l on l.id = o.listing_id join profiles b on b.id = o.buyer_id
    where o.seller_id = me and o.status = 'pending' and (p_filter in ('all','offer'))
    order by o.created_at desc limit 100
  ),
  apps as (
    select 'applicant' as kind, a.id, a.job_id as ref, p.id as other_id, coalesce(p.full_name, p.username, 'Applicant') as title, p.username, p.avatar_url,
           (j.title || case when a.cover_note is not null then ' · ' || left(a.cover_note, 120) else '' end) as preview, coalesce(a.applied_at, a.updated_at) as at, 'jobs'::text as context,
           0 as unread, (a.status = 'applied') as waiting, null::numeric, null::text, a.status
    from job_applications a join jobs j on j.id = a.job_id join profiles p on p.id = a.applicant_id
    where j.posted_by = me and a.status not in ('rejected','hired','withdrawn') and (p_filter in ('all','applicant'))
    order by a.applied_at desc limit 100
  ),
  revs as (
    select 'review' as kind, r.id, r.id as ref, p.id as other_id, coalesce(p.full_name, p.username, 'Customer') as title, p.username, p.avatar_url,
           (repeat('★', r.rating::int) || case when r.body is not null then ' ' || left(r.body, 140) else '' end) as preview, r.created_at as at, 'reviews'::text as context,
           0 as unread, (r.created_at > now() - interval '30 days') as waiting, null::numeric, null::text, r.rating::text
    from business_reviews r join profiles p on p.id = r.user_id
    where v_bp is not null and r.business_id = v_bp and (p_filter in ('all','review'))
    order by r.created_at desc limit 100
  ),
  allrows as (select * from dms union all select * from offers union all select * from apps union all select * from revs)
  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', a.kind, 'id', a.id, 'ref', a.ref, 'other_id', a.other_id, 'title', a.title, 'username', a.username, 'avatar_url', a.avatar_url,
      'preview', a.preview, 'at', a.at, 'context', a.context, 'unread', a.unread, 'waiting', a.waiting,
      'amount', a.amount, 'currency', a.currency, 'status', a.status,
      'label', s.label, 'assignee', s.assignee_member_id, 'done', coalesce(s.done,false), 'note', s.note
    ) order by coalesce(s.done,false) asc, a.at desc), '[]'::jsonb)
  into out
  from allrows a left join studio_thread_state s on s.owner_id = me and s.conversation_id = a.id;
  return out;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_insights(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); today date := (now() at time zone 'Africa/Harare')::date; d0 date; d1 date; series jsonb; cur jsonb; prev jsonb; top jsonb; funnel jsonb;
begin
  d0 := today - greatest(p_days,7); d1 := today - 2 * greatest(p_days,7);
  select coalesce(jsonb_agg(to_jsonb(s) order by s.day), '[]'::jsonb) into series from studio_daily_stats s where s.owner_id = me and s.day >= d0 and s.day < today;
  select jsonb_build_object('posts', coalesce(sum(posts),0), 'impressions', coalesce(sum(impressions),0), 'reach', coalesce(sum(reach),0), 'engagements', coalesce(sum(engagements),0),
    'messages', coalesce(sum(messages),0), 'market_chats', coalesce(sum(market_chats),0), 'offers', coalesce(sum(offers),0), 'payments', coalesce(sum(payments),0),
    'paid_usd', coalesce(sum(paid_usd),0), 'paid_zwg', coalesce(sum(paid_zwg),0), 'applications', coalesce(sum(applications),0), 'ad_impressions', coalesce(sum(ad_impressions),0), 'ad_clicks', coalesce(sum(ad_clicks),0),
    'followers_end', coalesce((select followers from studio_daily_stats where owner_id = me and day < today order by day desc limit 1), 0),
    'followers_start', coalesce((select followers from studio_daily_stats where owner_id = me and day < d0 order by day desc limit 1), 0))
    into cur from studio_daily_stats where owner_id = me and day >= d0 and day < today;
  select jsonb_build_object('posts', coalesce(sum(posts),0), 'impressions', coalesce(sum(impressions),0), 'reach', coalesce(sum(reach),0), 'engagements', coalesce(sum(engagements),0),
    'messages', coalesce(sum(messages),0), 'market_chats', coalesce(sum(market_chats),0), 'offers', coalesce(sum(offers),0), 'payments', coalesce(sum(payments),0),
    'paid_usd', coalesce(sum(paid_usd),0), 'paid_zwg', coalesce(sum(paid_zwg),0), 'applications', coalesce(sum(applications),0), 'ad_impressions', coalesce(sum(ad_impressions),0), 'ad_clicks', coalesce(sum(ad_clicks),0))
    into prev from studio_daily_stats where owner_id = me and day >= d1 and day < d0;
  select coalesce(jsonb_agg(jsonb_build_object('post_id', p.id, 'content', left(coalesce(p.content, p.body, ''), 120), 'created_at', p.created_at,
    'likes', coalesce(p.likes_count,0), 'comments', coalesce(p.comments_count,0), 'reposts', coalesce(p.reposts_count,0), 'views', coalesce(p.views_count,0),
    'score', coalesce(p.likes_count,0) + 2.5 * coalesce(p.comments_count,0) + 2 * coalesce(p.reposts_count,0),
    'thumb', (select m.url from post_media m where m.post_id = p.id order by m.sort_order nulls last limit 1),
    'products', (select count(*) from post_products x where x.post_id = p.id)) order by (coalesce(p.likes_count,0) + 2.5 * coalesce(p.comments_count,0) + 2 * coalesce(p.reposts_count,0)) desc), '[]'::jsonb)
    into top from (select * from posts where user_id = me and created_at >= d0 order by (coalesce(likes_count,0) + 2.5 * coalesce(comments_count,0) + 2 * coalesce(reposts_count,0)) desc limit 8) p;
  funnel := jsonb_build_object(
    'commerce', jsonb_build_object('chats', coalesce((cur->>'market_chats')::int,0), 'offers', coalesce((cur->>'offers')::int,0), 'payments', coalesce((cur->>'payments')::int,0)),
    'recruiting', jsonb_build_object(
      'applications', coalesce((select count(*) from job_applications a join jobs j on j.id = a.job_id where j.posted_by = me and a.applied_at >= d0), 0),
      'interviews', coalesce((select count(*) from job_applications a join jobs j on j.id = a.job_id where j.posted_by = me and a.applied_at >= d0 and studio_stage(a.status) in ('interview','offer','hired')), 0),
      'hired', coalesce((select count(*) from job_applications a join jobs j on j.id = a.job_id where j.posted_by = me and a.applied_at >= d0 and studio_stage(a.status) = 'hired'), 0)));
  return jsonb_build_object('days', greatest(p_days,7), 'series', series, 'current', cur, 'previous', prev, 'top_posts', top, 'funnel', funnel);
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_is_open_now(p_business uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare h jsonb; d text; r jsonb; t time; nowl timestamp;
begin
  select hours into h from business_profiles where profile_id = p_business limit 1;
  if h is null or h = '{}'::jsonb then return true; end if;
  nowl := (now() at time zone 'Africa/Harare');
  d := lower(to_char(nowl, 'Dy'));
  t := nowl::time;
  if not (h ? d) or jsonb_array_length(coalesce(h -> d, '[]'::jsonb)) = 0 then return false; end if;
  for r in select * from jsonb_array_elements(h -> d) loop
    if (r->>0)::time <= (r->>1)::time then
      if t >= (r->>0)::time and t < (r->>1)::time then return true; end if;
    else
      if t >= (r->>0)::time or t < (r->>1)::time then return true; end if;
    end if;
  end loop;
  return false;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_jobs()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','recruiter']);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', j.id, 'title', j.title, 'company', j.company, 'location', j.location, 'category', j.category, 'job_type', j.job_type,
    'remote_type', j.remote_type, 'deadline', j.deadline, 'created_at', j.created_at, 'urgent', j.urgent,
    'closed', (j.deadline is not null and j.deadline < now()),
    'counts', (select jsonb_build_object(
        'total', count(*),
        'applied', count(*) filter (where studio_stage(a.status) = 'applied'),
        'screening', count(*) filter (where studio_stage(a.status) = 'screening'),
        'interview', count(*) filter (where studio_stage(a.status) = 'interview'),
        'offer', count(*) filter (where studio_stage(a.status) = 'offer'),
        'hired', count(*) filter (where studio_stage(a.status) = 'hired'),
        'rejected', count(*) filter (where studio_stage(a.status) = 'rejected'))
      from job_applications a where a.job_id = j.id)
  ) order by (j.deadline is not null and j.deadline < now()) asc, j.created_at desc)
  from jobs j where j.posted_by = auth.uid()), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_leads()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'contact_id', l.contact_id, 'name', l.name, 'phone', l.phone, 'email', l.email, 'source', l.source, 'note', l.note,
    'status', l.status, 'created_at', l.created_at, 'username', p.username, 'avatar_url', p.avatar_url)
    order by case l.status when 'new' then 0 when 'contacted' then 1 when 'converted' then 2 else 3 end, l.created_at desc), '[]'::jsonb)
  from studio_leads l left join profiles p on p.id = l.contact_id where l.owner_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.studio_list_members()
 RETURNS TABLE(id uuid, display_name text, role text, active boolean, last_sign_in_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin']);
  return query select b.id, b.display_name, b.role, b.active, b.last_sign_in_at, b.created_at
  from business_access_members b where b.business_id = auth.uid() order by b.created_at;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_list_posts(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS SETOF studio_scheduled_posts
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from studio_scheduled_posts
  where owner_id = auth.uid() and (p_status is null or status = p_status)
  order by case status when 'scheduled' then 0 when 'draft' then 1 when 'failed' then 2 else 3 end, coalesce(publish_at, updated_at) asc
  limit least(coalesce(p_limit, 50), 200);
$function$
;

CREATE OR REPLACE FUNCTION public.studio_list_replies()
 RETURNS SETOF studio_saved_replies
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from studio_saved_replies where owner_id = auth.uid() order by shortcut;
$function$
;

CREATE OR REPLACE FUNCTION public.studio_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p record; v_sid text; m record; v_is_biz boolean; v_has_members boolean; v_role text;
begin
  select id, full_name, username, avatar_url, account_type into p from profiles where id = auth.uid();
  if p is null then return jsonb_build_object('is_business', false, 'bound', false, 'needs_code', false); end if;
  v_is_biz := p.account_type = 'business';
  v_has_members := exists (select 1 from business_access_members where business_id = auth.uid() and active);
  v_sid := auth.jwt() ->> 'session_id';
  select bam.id, bam.role, bam.display_name into m
  from studio_session_members s join business_access_members bam on bam.id = s.member_id
  where s.session_id = v_sid and s.business_id = auth.uid() and bam.active;
  v_role := studio_role();
  return jsonb_build_object(
    'is_business', v_is_biz,
    'bound', (m is not null) or not v_has_members or not v_is_biz,
    'needs_code', v_is_biz and v_has_members and m is null,
    'member_id', m.id, 'role', v_role, 'display_name', m.display_name,
    'business_name', p.full_name, 'username', p.username, 'avatar_url', p.avatar_url
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_my_posts_for_ads(p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'content', left(coalesce(p.content, p.body, ''), 140), 'created_at', p.created_at,
    'thumb', (select m.url from post_media m where m.post_id = p.id order by m.sort_order nulls last limit 1),
    'products', (select count(*) from post_products x where x.post_id = p.id), 'likes', coalesce(p.likes_count,0)) order by p.created_at desc), '[]'::jsonb)
  from (select * from posts where user_id = auth.uid() and community_id is null order by created_at desc limit least(coalesce(p_limit,40),100)) p;
$function$
;

CREATE OR REPLACE FUNCTION public.studio_orders(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'amount', p.amount, 'currency', p.currency, 'status', p.status, 'note', p.note, 'tx_id', p.tx_id,
    'created_at', p.created_at, 'completed_at', p.completed_at, 'conversation_id', p.conversation_id,
    'payer_id', pr.id, 'payer_name', coalesce(pr.full_name, pr.username, 'Customer'), 'payer_username', pr.username, 'payer_avatar', pr.avatar_url,
    'listing_id', l.id, 'listing_title', l.title, 'listing_image', case when l.images is not null and array_length(l.images,1) > 0 then l.images[1] else null end
  ) order by p.created_at desc), '[]'::jsonb)
  from (select * from chat_payments where recipient_id = auth.uid() order by created_at desc limit least(coalesce(p_limit,200), 1000)) p
  left join profiles pr on pr.id = p.sender_id
  left join marketplace_listings l on l.id = p.listing_id;
$function$
;

CREATE OR REPLACE FUNCTION public.studio_publish_due()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; n int := 0;
begin
  for v_id in select id from studio_scheduled_posts where status = 'scheduled' and publish_at <= now() order by publish_at limit 50 loop
    perform studio_publish_row(v_id);
    n := n + 1;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_publish_now(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','editor']);
  if not exists (select 1 from studio_scheduled_posts where id = p_id and owner_id = auth.uid() and status in ('draft','scheduled','failed')) then
    raise exception 'Not found or already published';
  end if;
  return studio_publish_row(p_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_publish_row(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_post uuid; m jsonb; pr jsonb; i int := 0;
begin
  select * into r from studio_scheduled_posts where id = p_id for update;
  if r is null then return null; end if;
  update studio_scheduled_posts set status = 'publishing', updated_at = now() where id = p_id;
  begin
    insert into posts (user_id, content, body, category, community_id)
    values (r.owner_id, nullif(trim(coalesce(r.content,'')),''), nullif(trim(coalesce(r.body,'')),''), r.category, r.community_id)
    returning id into v_post;
    for m in select * from jsonb_array_elements(coalesce(r.media,'[]'::jsonb)) loop
      insert into post_media (post_id, url, media_type, width, height, sort_order)
      values (v_post, m->>'url', coalesce(m->>'media_type','image'), (m->>'width')::int, (m->>'height')::int, i);
      i := i + 1;
    end loop;
    i := 0;
    for pr in select * from jsonb_array_elements(coalesce(r.products,'[]'::jsonb)) loop
      insert into post_products (post_id, sort_order, title, subtitle, price, currency, image_url, listing_id, link_url, cta_label)
      values (v_post, i, pr->>'title', pr->>'subtitle', (pr->>'price')::numeric, coalesce(pr->>'currency','USD'), pr->>'image_url',
              nullif(pr->>'listing_id','')::uuid, nullif(pr->>'link_url',''), coalesce(pr->>'cta_label','View'));
      i := i + 1;
    end loop;
    update studio_scheduled_posts set status = 'published', published_post_id = v_post, error = null, updated_at = now() where id = p_id;
    return v_post;
  exception when others then
    update studio_scheduled_posts set status = 'failed', error = sqlerrm, updated_at = now() where id = p_id;
    return null;
  end;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_remove_ad(p_promo uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','editor']);
  delete from promoted_posts where id = p_promo and advertiser_id = auth.uid() and campaign_id is not null;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_reply_review(p_review uuid, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bp uuid;
begin
  perform studio_require(array['owner','admin','editor','support']);
  select id into v_bp from business_profiles where profile_id = auth.uid() limit 1;
  if not exists (select 1 from business_reviews where id = p_review and business_id = v_bp) then raise exception 'Not your review'; end if;
  if coalesce(trim(p_body),'') = '' then delete from studio_review_replies where review_id = p_review; return; end if;
  insert into studio_review_replies (review_id, owner_id, body) values (p_review, auth.uid(), trim(p_body))
  on conflict (review_id) do update set body = excluded.body, updated_at = now();
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_require(p_roles text[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r text;
begin
  r := studio_role();
  if r is null then raise exception 'Enter your Studio access code first'; end if;
  if not (r = any(p_roles)) then raise exception 'Your Studio role (%) cannot do this', r; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_reviews()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bp uuid;
begin
  select id into v_bp from business_profiles where profile_id = auth.uid() limit 1;
  return jsonb_build_object(
    'average', coalesce((select round(avg(rating)::numeric, 2) from business_reviews where business_id = v_bp), 0),
    'count', coalesce((select count(*) from business_reviews where business_id = v_bp), 0),
    'distribution', coalesce((select jsonb_object_agg(rating, n) from (select rating, count(*) as n from business_reviews where business_id = v_bp group by rating) d), '{}'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'rating', r.rating, 'body', r.body, 'created_at', r.created_at, 'helpful_count', r.helpful_count,
        'user_id', p.id, 'name', coalesce(p.full_name, p.username, 'Customer'), 'username', p.username, 'avatar_url', p.avatar_url,
        'reply', rr.body, 'replied_at', rr.updated_at) order by r.created_at desc)
      from business_reviews r join profiles p on p.id = r.user_id left join studio_review_replies rr on rr.review_id = r.id where r.business_id = v_bp), '[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sid text; v_role text;
begin
  if auth.uid() is null then return null; end if;
  if not exists (select 1 from profiles where id = auth.uid() and account_type = 'business') then return 'owner'; end if;
  if not exists (select 1 from business_access_members where business_id = auth.uid() and active) then return 'owner'; end if;
  v_sid := auth.jwt() ->> 'session_id';
  if v_sid is null then return null; end if;
  select m.role into v_role
  from studio_session_members s join business_access_members m on m.id = s.member_id
  where s.session_id = v_sid and s.business_id = auth.uid() and m.active;
  return v_role;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_rollup(p_days integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o uuid; d int; n int := 0; today date := (now() at time zone 'Africa/Harare')::date;
begin
  for o in select id from profiles where account_type = 'business' loop
    for d in 1..greatest(p_days,1) loop
      perform studio_rollup_day(o, today - d);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_rollup_day(p_owner uuid, p_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t0 timestamptz := (p_day::timestamp at time zone 'Africa/Harare'); t1 timestamptz;
  v_posts int := 0; v_imp int := 0; v_reach int := 0; v_eng int := 0; v_fol int := 0; v_pv int := 0; v_msg int := 0; v_mc int := 0; v_off int := 0;
  v_pay int := 0; v_usd numeric := 0; v_zwg numeric := 0; v_app int := 0; v_adi int := 0; v_adc int := 0; x int;
begin
  t1 := t0 + interval '1 day';
  select count(*) into v_posts from posts where user_id = p_owner and created_at >= t0 and created_at < t1;
  begin
    select count(*), count(distinct s.user_id) into v_imp, v_reach from post_seen s join posts p on p.id = s.post_id where p.user_id = p_owner and s.created_at >= t0 and s.created_at < t1;
  exception when others then v_imp := 0; v_reach := 0; end;
  begin select count(*) into x from post_likes l join posts p on p.id = l.post_id where p.user_id = p_owner and l.created_at >= t0 and l.created_at < t1; v_eng := v_eng + x; exception when others then null; end;
  begin select count(*) into x from post_comments c join posts p on p.id = c.post_id where p.user_id = p_owner and c.created_at >= t0 and c.created_at < t1; v_eng := v_eng + x; exception when others then null; end;
  begin select count(*) into x from post_reposts r join posts p on p.id = r.post_id where p.user_id = p_owner and r.created_at >= t0 and r.created_at < t1; v_eng := v_eng + x; exception when others then null; end;
  begin select count(*) into x from post_bookmarks b join posts p on p.id = b.post_id where p.user_id = p_owner and b.created_at >= t0 and b.created_at < t1; v_eng := v_eng + x; exception when others then null; end;
  begin select count(*) into v_fol from follows where following_id = p_owner and created_at < t1; exception when others then v_fol := 0; end;
  begin select coalesce(view_count,0) into v_pv from business_profiles where profile_id = p_owner limit 1; exception when others then v_pv := 0; end;
  begin select count(*) into v_msg from messages where receiver_id = p_owner and sender_id <> p_owner and created_at >= t0 and created_at < t1; exception when others then v_msg := 0; end;
  begin select count(*) into v_mc from conversations where (user_1 = p_owner or user_2 = p_owner) and context = 'market' and created_at >= t0 and created_at < t1; exception when others then v_mc := 0; end;
  begin select count(*) into v_off from listing_offers where seller_id = p_owner and proposer_id <> p_owner and created_at >= t0 and created_at < t1; exception when others then v_off := 0; end;
  begin
    select count(*), coalesce(sum(amount) filter (where currency = 'USD'),0), coalesce(sum(amount) filter (where currency = 'ZWG'),0) into v_pay, v_usd, v_zwg
    from chat_payments where recipient_id = p_owner and completed_at >= t0 and completed_at < t1;
  exception when others then v_pay := 0; v_usd := 0; v_zwg := 0; end;
  begin select count(*) into v_app from job_applications a join jobs j on j.id = a.job_id where j.posted_by = p_owner and a.applied_at >= t0 and a.applied_at < t1; exception when others then v_app := 0; end;
  begin
    select count(*) filter (where e.kind = 'impression'), count(*) filter (where e.kind = 'click') into v_adi, v_adc
    from ad_events e join promoted_posts pp on pp.id = e.promo_id where pp.advertiser_id = p_owner and e.created_at >= t0 and e.created_at < t1;
  exception when others then v_adi := 0; v_adc := 0; end;
  insert into studio_daily_stats (owner_id, day, reach, impressions, engagements, followers, profile_views, messages, storefront_views, posts, market_chats, offers, payments, paid_usd, paid_zwg, applications, ad_impressions, ad_clicks)
  values (p_owner, p_day, v_reach, v_imp, v_eng, v_fol, v_pv, v_msg, 0, v_posts, v_mc, v_off, v_pay, v_usd, v_zwg, v_app, v_adi, v_adc)
  on conflict (owner_id, day) do update set reach = excluded.reach, impressions = excluded.impressions, engagements = excluded.engagements, followers = excluded.followers,
    profile_views = excluded.profile_views, messages = excluded.messages, posts = excluded.posts, market_chats = excluded.market_chats, offers = excluded.offers,
    payments = excluded.payments, paid_usd = excluded.paid_usd, paid_zwg = excluded.paid_zwg, applications = excluded.applications, ad_impressions = excluded.ad_impressions, ad_clicks = excluded.ad_clicks;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_save_campaign(p_id uuid, p_name text, p_objective text, p_budget numeric, p_currency text, p_payment_method text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  perform studio_require(array['owner','admin']);
  if coalesce(trim(p_name),'') = '' then raise exception 'Give the campaign a name'; end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at <= p_starts_at then raise exception 'End must be after start'; end if;
  if p_id is null then
    insert into studio_campaigns (owner_id, name, objective, budget, currency, payment_method, starts_at, ends_at)
    values (auth.uid(), trim(p_name), coalesce(p_objective,'reach'), coalesce(p_budget,0), coalesce(p_currency,'USD'), p_payment_method, p_starts_at, p_ends_at)
    returning id into v_id;
  else
    update studio_campaigns set name = trim(p_name), objective = coalesce(p_objective, objective), budget = coalesce(p_budget, budget), currency = coalesce(p_currency, currency),
      payment_method = coalesce(p_payment_method, payment_method), starts_at = p_starts_at, ends_at = p_ends_at, updated_at = now(),
      status = case when status in ('rejected') then 'draft' else status end
    where id = p_id and owner_id = auth.uid() and status in ('draft','rejected','paused','approved') returning id into v_id;
    if v_id is null then raise exception 'Campaign cannot be edited in its current state'; end if;
    update promoted_posts set starts_at = coalesce(p_starts_at, now()), ends_at = p_ends_at where campaign_id = v_id;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_save_lead(p_id uuid, p_name text, p_phone text, p_email text, p_note text, p_status text DEFAULT 'new'::text, p_source text DEFAULT 'manual'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  perform studio_require(array['owner','admin','editor','support']);
  if coalesce(trim(p_name),'') = '' then raise exception 'Lead needs a name'; end if;
  if p_status not in ('new','contacted','converted','lost') then raise exception 'Bad status'; end if;
  if p_id is null then
    insert into studio_leads (owner_id, name, phone, email, note, status, source) values (auth.uid(), trim(p_name), nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_email,'')),''), p_note, p_status, coalesce(p_source,'manual')) returning id into v_id;
  else
    update studio_leads set name = trim(p_name), phone = nullif(trim(coalesce(p_phone,'')),''), email = nullif(trim(coalesce(p_email,'')),''), note = p_note, status = p_status, updated_at = now()
    where id = p_id and owner_id = auth.uid() returning id into v_id;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_save_post(p_id uuid DEFAULT NULL::uuid, p_content text DEFAULT NULL::text, p_body text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_community uuid DEFAULT NULL::uuid, p_media jsonb DEFAULT '[]'::jsonb, p_products jsonb DEFAULT '[]'::jsonb, p_publish_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_status text;
begin
  if coalesce(trim(p_content),'') = '' and coalesce(trim(p_body),'') = '' and jsonb_array_length(coalesce(p_media,'[]'::jsonb)) = 0 then
    raise exception 'A post needs text or media';
  end if;
  v_status := case when p_publish_at is null then 'draft' else 'scheduled' end;
  if p_publish_at is not null and p_publish_at < now() - interval '1 minute' then raise exception 'Publish time is in the past'; end if;
  if p_id is null then
    insert into studio_scheduled_posts (owner_id, status, publish_at, content, body, category, community_id, media, products)
    values (auth.uid(), v_status, p_publish_at, p_content, p_body, p_category, p_community, coalesce(p_media,'[]'::jsonb), coalesce(p_products,'[]'::jsonb))
    returning id into v_id;
  else
    update studio_scheduled_posts set status = v_status, publish_at = p_publish_at, content = p_content, body = p_body,
      category = p_category, community_id = p_community, media = coalesce(p_media,'[]'::jsonb), products = coalesce(p_products,'[]'::jsonb),
      error = null, updated_at = now()
    where id = p_id and owner_id = auth.uid() and status in ('draft','scheduled','failed','cancelled')
    returning id into v_id;
    if v_id is null then raise exception 'Not found or already published'; end if;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_schedule_interview(p_application uuid, p_at timestamp with time zone, p_location text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record;
begin
  perform studio_require(array['owner','admin','recruiter']);
  select a1.*, j.title as job_title into a from job_applications a1 join jobs j on j.id = a1.job_id where a1.id = p_application and j.posted_by = auth.uid();
  if a is null then raise exception 'Not your application'; end if;
  update job_applications set interview_at = p_at, interview_location = nullif(trim(coalesce(p_location,'')),''),
    status = case when p_at is null then status else 'interview' end, updated_at = now() where id = p_application;
  if p_at is not null then
    insert into notifications (recipient_id, actor_id, type, message, data)
    values (a.applicant_id, auth.uid(), 'job_interview',
      'Interview for ' || a.job_title || ' on ' || to_char(p_at at time zone 'Africa/Harare', 'Dy DD Mon HH24:MI') || coalesce(' at ' || nullif(trim(coalesce(p_location,'')),''), ''),
      jsonb_build_object('job_id', a.job_id, 'application_id', a.id, 'interview_at', p_at, 'location', p_location));
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_auto_replies(p_welcome_enabled boolean, p_welcome_text text, p_away_enabled boolean, p_away_text text, p_faq jsonb DEFAULT '[]'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into studio_auto_replies (owner_id, welcome_enabled, welcome_text, away_enabled, away_text, faq, updated_at)
  values (auth.uid(), coalesce(p_welcome_enabled,false), p_welcome_text, coalesce(p_away_enabled,false), p_away_text, coalesce(p_faq,'[]'::jsonb), now())
  on conflict (owner_id) do update set welcome_enabled = excluded.welcome_enabled, welcome_text = excluded.welcome_text,
    away_enabled = excluded.away_enabled, away_text = excluded.away_text, faq = excluded.faq, updated_at = now();
$function$
;

CREATE OR REPLACE FUNCTION public.studio_set_business(p_bio text, p_category text, p_location text, p_address text, p_phone text, p_email text, p_website text, p_social jsonb, p_hours jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin']);
  update profiles set bio = coalesce(p_bio, bio) where id = auth.uid();
  update business_profiles set category = coalesce(nullif(trim(p_category),''), category), location = p_location, address = p_address, phone = p_phone, email = p_email, website = p_website,
    social_links = coalesce(p_social, social_links), hours = coalesce(p_hours, hours), updated_at = now()
  where profile_id = auth.uid();
  if not found then raise exception 'No business record for this session'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_campaign_status(p_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  perform studio_require(array['owner','admin']);
  select * into c from studio_campaigns where id = p_id and owner_id = auth.uid();
  if c is null then raise exception 'No such campaign'; end if;
  if p_status = 'live' then
    if c.status not in ('approved','paused') then raise exception 'Campaign must be approved before it goes live'; end if;
    update studio_campaigns set status = 'live', updated_at = now() where id = p_id;
    update promoted_posts set status = 'active' where campaign_id = p_id and status = 'paused' and (ends_at is null or ends_at > now());
  elsif p_status = 'paused' then
    if c.status <> 'live' then raise exception 'Only live campaigns pause'; end if;
    update studio_campaigns set status = 'paused', updated_at = now() where id = p_id;
    update promoted_posts set status = 'paused' where campaign_id = p_id and status = 'active';
  elsif p_status = 'ended' then
    update studio_campaigns set status = 'ended', updated_at = now() where id = p_id;
    update promoted_posts set status = 'ended' where campaign_id = p_id and status in ('active','paused');
  else raise exception 'Bad status'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_contact(p_user uuid, p_label text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','editor','support']);
  if p_label is null and p_note is null then
    delete from studio_contact_labels where owner_id = auth.uid() and user_id = p_user;
  else
    insert into studio_contact_labels (owner_id, user_id, label, note, updated_at) values (auth.uid(), p_user, coalesce(p_label,'contact'), p_note, now())
    on conflict (owner_id, user_id) do update set label = coalesce(p_label, studio_contact_labels.label), note = coalesce(p_note, studio_contact_labels.note), updated_at = now();
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_contact_label(p_contact uuid, p_label text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','editor','support']);
  if p_label is null then delete from studio_contact_labels where owner_id = auth.uid() and contact_id = p_contact; return; end if;
  insert into studio_contact_labels (owner_id, contact_id, label, note) values (auth.uid(), p_contact, p_label, p_note)
  on conflict (owner_id, contact_id) do update set label = excluded.label, note = coalesce(excluded.note, studio_contact_labels.note), updated_at = now();
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_device(p_device uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin']);
  if p_action = 'approve' then update business_devices set status = 'approved', approved_at = now() where id = p_device and business_id = auth.uid();
  elsif p_action = 'remove' then delete from business_devices where id = p_device and business_id = auth.uid();
  else raise exception 'Bad action'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_listing(p_id uuid, p_status text DEFAULT NULL::text, p_price numeric DEFAULT NULL::numeric, p_delivery_available boolean DEFAULT NULL::boolean, p_delivery_fee numeric DEFAULT NULL::numeric, p_delivery_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','editor']);
  if p_status is not null and p_status not in ('available','sold','removed') then raise exception 'Bad status'; end if;
  if p_price is not null and p_price < 0 then raise exception 'Price cannot be negative'; end if;
  update marketplace_listings set
    status = coalesce(p_status, status),
    price = coalesce(p_price, price),
    delivery_available = coalesce(p_delivery_available, delivery_available),
    delivery_fee = coalesce(p_delivery_fee, delivery_fee),
    delivery_note = coalesce(p_delivery_note, delivery_note),
    updated_at = now()
  where id = p_id and seller_id = auth.uid();
  if not found then raise exception 'Not your listing'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_member_active(p_member uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner']);
  update business_access_members set active = p_active where id = p_member and business_id = auth.uid();
  if not found then raise exception 'No such member'; end if;
  if not p_active then delete from studio_session_members where member_id = p_member; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_member_role(p_member uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner']);
  if p_role not in ('owner','admin','editor','recruiter','support') then raise exception 'Bad role'; end if;
  update business_access_members set role = p_role where id = p_member and business_id = auth.uid();
  if not found then raise exception 'No such member'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_stage(p_application uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; v_title text;
begin
  perform studio_require(array['owner','admin','recruiter']);
  if p_status not in ('applied','screening','interview','offer','hired','rejected') then raise exception 'Bad stage'; end if;
  select a1.*, j.title as job_title into a from job_applications a1 join jobs j on j.id = a1.job_id where a1.id = p_application and j.posted_by = auth.uid();
  if a is null then raise exception 'Not your application'; end if;
  update job_applications set status = p_status, updated_at = now() where id = p_application;
  if p_status in ('offer','hired','rejected') then
    v_title := case p_status when 'offer' then 'You have an offer for ' || a.job_title
                             when 'hired' then 'Congratulations, you were hired for ' || a.job_title
                             else 'Update on your application for ' || a.job_title end;
    insert into notifications (recipient_id, actor_id, type, message, data)
    values (a.applicant_id, auth.uid(), 'job_status', v_title, jsonb_build_object('job_id', a.job_id, 'application_id', a.id, 'status', p_status));
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_storefront(p_tagline text, p_featured uuid[], p_delivery_default boolean, p_delivery_fee numeric, p_delivery_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','editor']);
  insert into studio_storefront (owner_id, tagline, featured_listing_ids, delivery_default, delivery_fee_default, delivery_note_default, updated_at)
  values (auth.uid(), nullif(trim(coalesce(p_tagline,'')),''), coalesce(p_featured, '{}'), coalesce(p_delivery_default,false), p_delivery_fee, nullif(trim(coalesce(p_delivery_note,'')),''), now())
  on conflict (owner_id) do update set tagline = excluded.tagline, featured_listing_ids = excluded.featured_listing_ids,
    delivery_default = excluded.delivery_default, delivery_fee_default = excluded.delivery_fee_default, delivery_note_default = excluded.delivery_note_default, updated_at = now();
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_tags(p_application uuid, p_tags text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform studio_require(array['owner','admin','recruiter']);
  if not exists (select 1 from job_applications a join jobs j on j.id = a.job_id where a.id = p_application and j.posted_by = auth.uid()) then raise exception 'Not your application'; end if;
  delete from studio_applicant_tags where application_id = p_application;
  insert into studio_applicant_tags (application_id, owner_id, tag)
  select p_application, auth.uid(), lower(trim(t)) from unnest(coalesce(p_tags, '{}')) t where trim(t) <> '' on conflict do nothing;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_set_thread(p_conversation uuid, p_label text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_done boolean DEFAULT NULL::boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into studio_thread_state (owner_id, conversation_id, label, assignee_member_id, done, note, updated_at)
  values (auth.uid(), p_conversation, p_label, p_assignee, coalesce(p_done,false), p_note, now())
  on conflict (owner_id, conversation_id) do update set
    label = coalesce(p_label, studio_thread_state.label),
    assignee_member_id = coalesce(p_assignee, studio_thread_state.assignee_member_id),
    done = coalesce(p_done, studio_thread_state.done),
    note = coalesce(p_note, studio_thread_state.note),
    updated_at = now();
$function$
;

CREATE OR REPLACE FUNCTION public.studio_stage(p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_status when 'viewed' then 'applied' when 'shortlisted' then 'screening' when 'accepted' then 'hired' else coalesce(p_status,'applied') end;
$function$
;

CREATE OR REPLACE FUNCTION public.studio_submit_campaign(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  perform studio_require(array['owner','admin']);
  select * into c from studio_campaigns where id = p_id and owner_id = auth.uid();
  if c is null then raise exception 'No such campaign'; end if;
  if c.status not in ('draft','rejected') then raise exception 'Only drafts are submitted'; end if;
  if c.payment_method is null then raise exception 'Choose Crisp or IntoBank as the payment method'; end if;
  if c.budget <= 0 then raise exception 'Set a budget'; end if;
  if not exists (select 1 from promoted_posts where campaign_id = p_id) then raise exception 'Add at least one ad'; end if;
  update studio_campaigns set status = 'submitted', review_note = null, updated_at = now() where id = p_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_team()
 RETURNS TABLE(id uuid, display_name text, role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select b.id, b.display_name, b.role from business_access_members b where b.business_id = auth.uid() and b.active order by b.created_at;
$function$
;

CREATE OR REPLACE FUNCTION public.studio_upsert_lead(p_id uuid, p_name text, p_phone text, p_email text, p_source text, p_note text, p_status text, p_contact uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  perform studio_require(array['owner','admin','editor','support']);
  if coalesce(trim(p_name),'') = '' then raise exception 'A lead needs a name'; end if;
  if p_status is not null and p_status not in ('new','contacted','converted','lost') then raise exception 'Bad status'; end if;
  if p_id is null then
    insert into studio_leads (owner_id, contact_id, name, phone, email, source, note, status) values (auth.uid(), p_contact, trim(p_name), p_phone, p_email, p_source, p_note, coalesce(p_status,'new')) returning id into v_id;
  else
    update studio_leads set name = trim(p_name), phone = p_phone, email = p_email, source = p_source, note = p_note, status = coalesce(p_status, status), contact_id = coalesce(p_contact, contact_id), updated_at = now()
    where id = p_id and owner_id = auth.uid() returning id into v_id;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_upsert_reply(p_id uuid DEFAULT NULL::uuid, p_shortcut text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_body text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_short text;
begin
  v_short := lower(regexp_replace(coalesce(p_shortcut, p_title, ''), '[^a-z0-9_]', '', 'gi'));
  if v_short = '' or coalesce(trim(p_body),'') = '' then raise exception 'Shortcut and reply text are required'; end if;
  if p_id is null then
    insert into studio_saved_replies (owner_id, shortcut, title, body) values (auth.uid(), v_short, coalesce(p_title, v_short), p_body)
    on conflict (owner_id, shortcut) do update set title = excluded.title, body = excluded.body
    returning id into v_id;
  else
    update studio_saved_replies set shortcut = v_short, title = coalesce(p_title, v_short), body = p_body
    where id = p_id and owner_id = auth.uid() returning id into v_id;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.submit_sticker_response(p_story_id uuid, p_sticker_id text, p_response_type text, p_text_value text DEFAULT NULL::text, p_number_value numeric DEFAULT NULL::numeric, p_option_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result story_sticker_responses;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.viewer_can_see_story(p_story_id) THEN
    RAISE EXCEPTION 'Cannot access this story';
  END IF;

  IF p_response_type NOT IN ('question', 'slider', 'quiz') THEN
    RAISE EXCEPTION 'Invalid response type';
  END IF;

  IF p_response_type = 'slider' AND (p_number_value IS NULL OR p_number_value < 0 OR p_number_value > 1) THEN
    RAISE EXCEPTION 'Slider value must be between 0 and 1';
  END IF;

  IF p_response_type = 'question' AND (p_text_value IS NULL OR length(trim(p_text_value)) < 1) THEN
    RAISE EXCEPTION 'Answer cannot be empty';
  END IF;

  INSERT INTO story_sticker_responses (story_id, sticker_id, user_id, response_type, text_value, number_value, option_id)
  VALUES (p_story_id, p_sticker_id, auth.uid(), p_response_type, p_text_value, p_number_value, p_option_id)
  ON CONFLICT (story_id, sticker_id, user_id)
  DO UPDATE SET
    text_value = COALESCE(p_text_value, story_sticker_responses.text_value),
    number_value = COALESCE(p_number_value, story_sticker_responses.number_value),
    option_id = COALESCE(p_option_id, story_sticker_responses.option_id),
    created_at = now()
  RETURNING * INTO v_result;

  RETURN row_to_json(v_result);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.suggest_follows(p_limit integer DEFAULT 10)
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, is_verified boolean, mutuals integer, followers integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with viewer as (select auth.uid() as uid),
mine as (select following_id from follows where follower_id = (select uid from viewer)),
second_degree as (
  select f2.following_id as cand, count(distinct f2.follower_id) as mutuals
  from follows f2
  where f2.follower_id in (select following_id from mine)
    and f2.following_id <> (select uid from viewer)
    and f2.following_id not in (select following_id from mine)
  group by f2.following_id
),
pop as (select following_id, count(*)::int as n from follows group by following_id)
select pr.id, pr.full_name, pr.username, pr.avatar_url, pr.is_verified,
       sd.mutuals::int, coalesce(pop.n, 0)
from second_degree sd
join profiles pr on pr.id = sd.cand
left join pop on pop.following_id = sd.cand
where not exists (select 1 from blocked_users b
                  where (b.blocker_id = (select uid from viewer) and b.blocked_id = sd.cand)
                     or (b.blocker_id = sd.cand and b.blocked_id = (select uid from viewer)))
  and not exists (select 1 from follow_requests fr
                  where fr.requester_id = (select uid from viewer)
                    and fr.target_id = sd.cand
                    and fr.status = 'pending')
order by sd.mutuals desc, coalesce(pop.n, 0) desc
limit least(coalesce(p_limit, 10), 30);
$function$
;

CREATE OR REPLACE FUNCTION public.sweep_dead_calls()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update call_participants set status = 'left', left_at = now()
  where status = 'joined' and last_seen_at is not null
    and last_seen_at < now() - interval '120 seconds';

  update call_sessions set status = 'missed'
  where status = 'ringing' and expires_at is not null and expires_at < now();

  update call_sessions cs set status = 'ended'
  where cs.status = 'active'
    and not exists (select 1 from call_participants cp
      where cp.call_session_id = cs.id and cp.status = 'joined')
    and cs.created_at < now() - interval '2 minutes';

  update call_sessions cs set status = 'ended'
  where cs.status = 'active' and cs.is_group_call = true
    and cs.created_at < now() - interval '10 minutes'
    and not exists (select 1 from call_participants cp
      where cp.call_session_id = cs.id and cp.status = 'joined'
        and cp.last_seen_at > now() - interval '120 seconds');
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_application_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if TG_OP = 'INSERT' then
    update jobs set application_count = coalesce(application_count, 0) + 1
    where id = NEW.job_id;
  elsif TG_OP = 'DELETE' then
    update jobs set application_count = greatest(0, coalesce(application_count, 0) - 1)
    where id = OLD.job_id;
  end if;
  return coalesce(NEW, OLD);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_club_to_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_comment_reaction_counts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_comment uuid;
begin
  v_comment := coalesce(new.comment_id, old.comment_id);
  update post_comments c
     set likes_count    = (select count(*) from comment_reactions r
                            where r.comment_id = v_comment and r.value = 1),
         dislikes_count = (select count(*) from comment_reactions r
                            where r.comment_id = v_comment and r.value = -1)
   where c.id = v_comment;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_community_to_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_conversation_preview()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_job_application_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if TG_OP = 'INSERT' then
    update jobs set applications_count = applications_count + 1 where id = NEW.job_id;
  elsif TG_OP = 'DELETE' then
    update jobs set applications_count = greatest(0, applications_count - 1) where id = OLD.job_id;
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_mentee_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'UPDATE' then
    -- Going from non-accepted → accepted: increment
    if OLD.status != 'accepted' and NEW.status = 'accepted' then
      update mentorship_profiles
      set current_mentees = current_mentees + 1,
          is_accepting    = (current_mentees + 1 < max_mentees),
          updated_at      = now()
      where user_id = NEW.mentor_id;
    end if;

    -- Going from accepted → non-accepted: decrement
    if OLD.status = 'accepted' and NEW.status != 'accepted' then
      update mentorship_profiles
      set current_mentees = greatest(0, current_mentees - 1),
          is_accepting    = true,
          updated_at      = now()
      where user_id = NEW.mentor_id;
    end if;
  end if;

  -- After any update, re-sync is_accepting precisely
  update mentorship_profiles
  set is_accepting = (current_mentees < max_mentees)
  where user_id = coalesce(NEW.mentor_id, OLD.mentor_id);

  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_message_mentions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.text is null or position('@' in new.text) = 0 then return new; end if;

  insert into public.message_mentions (message_id, mentioned_user_id)
  select distinct new.id, p.id
  from regexp_matches(coalesce(new.text, ''), '@([A-Za-z0-9_\.]{2,30})', 'g') as m(u)
  join public.profiles p on lower(p.username) = lower(m.u[1])
  where p.id <> new.sender_id
    and exists (
      select 1 from conversations c
      where c.id = new.conversation_id
        and (c.user_1 = p.id or c.user_2 = p.id
             or is_conversation_member(c.id, p.id))
    )
  on conflict do nothing;

  insert into public.notifications (recipient_id, actor_id, type, message, data)
  select mm.mentioned_user_id, new.sender_id, 'mention',
         'mentioned you in a chat',
         jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id)
  from public.message_mentions mm
  where mm.message_id = new.id;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_post_bookmark_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'INSERT' then
    update posts
    set bookmarks_count = (
      select count(*) from post_bookmarks where post_id = new.post_id
    )
    where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update posts
    set bookmarks_count = (
      select count(*) from post_bookmarks where post_id = old.post_id
    )
    where id = old.post_id;
    return old;
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_post_bookmarks_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  update posts set bookmarks_count = (
    select count(*) from post_bookmarks where post_id = coalesce(NEW.post_id, OLD.post_id)
  ) where id = coalesce(NEW.post_id, OLD.post_id);
  return coalesce(NEW, OLD);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_post_comment_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'INSERT' then
    update posts
    set comments_count = (
      select count(*) from post_comments where post_id = new.post_id
    )
    where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update posts
    set comments_count = (
      select count(*) from post_comments where post_id = old.post_id
    )
    where id = old.post_id;
    return old;
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_post_comments_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- Only count top-level comments (not replies)
  update posts set comments_count = (
    select count(*) from post_comments
    where post_id = coalesce(NEW.post_id, OLD.post_id)
    and parent_comment_id is null
  ) where id = coalesce(NEW.post_id, OLD.post_id);
  return coalesce(NEW, OLD);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_post_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts
    SET likes_count = COALESCE(likes_count, 0) + 1
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts
    SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0)
    WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_post_likes_count_exact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_post_id uuid;
BEGIN
  v_post_id := COALESCE(NEW.post_id, OLD.post_id);

  UPDATE public.posts
  SET likes_count = (
    SELECT COUNT(*)::int
    FROM public.post_likes
    WHERE post_id = v_post_id
  )
  WHERE id = v_post_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_post_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_url text;
begin
  v_url := substring(coalesce(new.content, '') from 'https?://[^\s<>"]+');
  new.link_url := v_url;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_post_mentions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.post_mentions WHERE post_id = NEW.id;

  INSERT INTO public.post_mentions (post_id, mentioned_user_id, mentioned_username, created_at)
  SELECT DISTINCT
    NEW.id,
    p.id,
    p.username,
    COALESCE(NEW.created_at, now())
  FROM regexp_matches(COALESCE(NEW.content, ''), '@([A-Za-z0-9_\.]{2,30})', 'g') AS m(username_match)
  JOIN public.profiles p
    ON lower(p.username) = lower(m.username_match[1])
  WHERE p.id <> NEW.user_id
  ON CONFLICT (post_id, mentioned_user_id) DO UPDATE
    SET mentioned_username = EXCLUDED.mentioned_username;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_post_reposts_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.posts
  SET reposts_count = (
    SELECT COUNT(*) FROM public.post_reposts
    WHERE post_id = COALESCE(NEW.post_id, OLD.post_id)
  )
  WHERE id = COALESCE(NEW.post_id, OLD.post_id);
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_community_member_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    update communities set member_count = member_count + 1 where id = new.community_id;
    return new;
  elsif tg_op = 'DELETE' then
    update communities set member_count = greatest(member_count - 1, 0) where id = old.community_id;
    return old;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.tg_listing_report_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count int;
begin
  select count(*) into v_count from public.listing_reports where listing_id = new.listing_id;
  update public.marketplace_listings
     set report_count = v_count,
         hidden_at = case when v_count >= 3 and hidden_at is null then now() else hidden_at end,
         status = case when v_count >= 3 then 'under_review' else status end
   where id = new.listing_id;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.tg_posts_community_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.community_id is not null and auth.uid() is not null then
    if not exists (select 1 from community_members m where m.community_id = new.community_id and m.user_id = auth.uid()) then
      raise exception 'Join the community before posting in it';
    end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.tg_posts_community_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.community_id is not null then
    update communities set last_activity_at = now() where id = new.community_id;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_existing boolean;
  v_count integer;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Lock target post so count reconciliation is stable.
  PERFORM 1
  FROM public.posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.post_likes
    WHERE post_id = p_post_id
      AND user_id = v_user_id
  ) INTO v_existing;

  IF v_existing THEN
    DELETE FROM public.post_likes
    WHERE post_id = p_post_id
      AND user_id = v_user_id;

    -- Trigger updates posts.likes_count. Re-read final value.
    SELECT COALESCE(likes_count, 0)
    INTO v_count
    FROM public.posts
    WHERE id = p_post_id;

    RETURN jsonb_build_object(
      'post_id', p_post_id,
      'liked', false,
      'likes_count', v_count
    );
  ELSE
    INSERT INTO public.post_likes(post_id, user_id)
    VALUES (p_post_id, v_user_id)
    ON CONFLICT (post_id, user_id) DO NOTHING;

    -- Trigger updates posts.likes_count. Re-read final value.
    SELECT COALESCE(likes_count, 0)
    INTO v_count
    FROM public.posts
    WHERE id = p_post_id;

    RETURN jsonb_build_object(
      'post_id', p_post_id,
      'liked', true,
      'likes_count', v_count
    );
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.toggle_story_reaction(p_story_id uuid, p_emoji text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Try to delete existing reaction
  DELETE FROM story_reactions
  WHERE story_id = p_story_id
    AND user_id = v_uid
    AND emoji = p_emoji;

  IF FOUND THEN
    -- Reaction existed and was removed
    RETURN jsonb_build_object('reacted', false, 'emoji', p_emoji);
  END IF;

  -- No existing reaction, insert new one
  INSERT INTO story_reactions (story_id, user_id, emoji)
  VALUES (p_story_id, v_uid, p_emoji);

  RETURN jsonb_build_object('reacted', true, 'emoji', p_emoji);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notify_incoming_call()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  caller_name TEXT;
  call_type_label TEXT;
  recent_call_exists BOOLEAN;
  member RECORD;
BEGIN
  -- Only fire for ringing calls
  IF NEW.status <> 'ringing' THEN
    RETURN NEW;
  END IF;

  -- Get caller name
  SELECT full_name INTO caller_name
  FROM public.profiles
  WHERE id = NEW.initiator_id;

  IF caller_name IS NULL THEN
    caller_name := 'Someone';
  END IF;

  -- Build call type label
  IF NEW.is_video = true THEN
    call_type_label := 'video';
  ELSE
    call_type_label := 'voice';
  END IF;

  -- ── 1-on-1 calls ─────────────────────────────────────────────
  IF NEW.is_group_call = false AND NEW.receiver_id IS NOT NULL THEN
    -- Skip self-call
    IF NEW.receiver_id = NEW.initiator_id THEN
      RETURN NEW;
    END IF;

    -- Rate limit: skip if same caller called same receiver within 10s
    SELECT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE recipient_id = NEW.receiver_id
        AND actor_id = NEW.initiator_id
        AND type = 'incoming_call'
        AND created_at > NOW() - INTERVAL '10 seconds'
    ) INTO recent_call_exists;

    IF recent_call_exists THEN
      RETURN NEW;
    END IF;

    -- Insert notification (unique index prevents duplicates)
    BEGIN
      INSERT INTO public.notifications (
        recipient_id, actor_id, type, message, body_preview, data
      ) VALUES (
        NEW.receiver_id,
        NEW.initiator_id,
        'incoming_call',
        'Incoming ' || call_type_label || ' call from ' || caller_name,
        'Incoming ' || call_type_label || ' call',
        jsonb_build_object(
          'call_id', NEW.id,
          'channel_id', NEW.agora_channel,
          'is_video', NEW.is_video,
          'is_group_call', false,
          'caller_name', caller_name
        )
      );
    EXCEPTION WHEN unique_violation THEN
      -- Duplicate: already notified for this call_id
      NULL;
    END;
  END IF;

  -- ── Group calls ───────────────────────────────────────────────
  IF NEW.is_group_call = true AND NEW.conversation_id IS NOT NULL THEN
    FOR member IN
      SELECT user_id FROM public.conversation_members
      WHERE conversation_id = NEW.conversation_id
        AND user_id <> NEW.initiator_id
    LOOP
      -- Rate limit per member
      SELECT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE recipient_id = member.user_id
          AND actor_id = NEW.initiator_id
          AND type = 'incoming_call'
          AND created_at > NOW() - INTERVAL '10 seconds'
      ) INTO recent_call_exists;

      IF recent_call_exists THEN
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO public.notifications (
          recipient_id, actor_id, type, message, body_preview, data
        ) VALUES (
          member.user_id,
          NEW.initiator_id,
          'incoming_call',
          'Incoming group ' || call_type_label || ' call from ' || caller_name,
          'Incoming group ' || call_type_label || ' call',
          jsonb_build_object(
            'call_id', NEW.id,
            'channel_id', NEW.agora_channel,
            'is_video', NEW.is_video,
            'is_group_call', true,
            'caller_name', caller_name,
            'conversation_id', NEW.conversation_id
          )
        );
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_business_advert_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_business_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_business_id := OLD.business_id;
  ELSE
    v_business_id := NEW.business_id;
  END IF;

  UPDATE business_profiles
  SET advert_count = (
        SELECT COUNT(*)
        FROM business_posts
        WHERE business_id = v_business_id
      ),
      updated_at = now()
  WHERE id = v_business_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_business_info(p_business_id uuid, p_category text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_website text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_hours jsonb DEFAULT NULL::jsonb, p_social jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_row business_profiles;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_business_member(p_business_id) then
    raise exception 'You do not manage this business';
  end if;

  update business_profiles set
    category     = coalesce(nullif(trim(p_category), ''), category),
    phone        = coalesce(nullif(trim(p_phone), ''), phone),
    email        = coalesce(nullif(trim(p_email), ''), email),
    website      = coalesce(nullif(trim(p_website), ''), website),
    address      = coalesce(nullif(trim(p_address), ''), address),
    location     = coalesce(nullif(trim(p_location), ''), location),
    hours        = coalesce(p_hours, hours),
    social_links = coalesce(p_social, social_links),
    updated_at   = now()
  where profile_id = p_business_id
  returning * into v_row;

  if v_row.id is null then raise exception 'No business record for that profile'; end if;

  return jsonb_build_object(
    'category', v_row.category, 'phone', v_row.phone, 'email', v_row.email,
    'website', v_row.website, 'address', v_row.address, 'location', v_row.location,
    'hours', v_row.hours, 'social_links', v_row.social_links);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_business_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_business_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_business_id := OLD.business_id;
  ELSE
    v_business_id := NEW.business_id;
  END IF;

  UPDATE business_profiles
  SET avg_rating = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM business_reviews
        WHERE business_id = v_business_id
      ), 0),
      review_count = (
        SELECT COUNT(*)
        FROM business_reviews
        WHERE business_id = v_business_id
      ),
      updated_at = now()
  WHERE id = v_business_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_channel_settings(p_channel uuid, p_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_audience text DEFAULT NULL::text, p_replies_enabled boolean DEFAULT NULL::boolean, p_icon_url text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from channels c where c.id = p_channel and c.owner_id = auth.uid()) then
    raise exception 'Only the owner can edit channel settings';
  end if;
  if p_audience is not null and p_audience not in ('everyone','followers') then
    raise exception 'Bad audience';
  end if;
  update channels set
    name = coalesce(nullif(trim(p_name), ''), name),
    description = coalesce(p_description, description),
    audience = coalesce(p_audience, audience),
    replies_enabled = coalesce(p_replies_enabled, replies_enabled),
    icon_url = coalesce(p_icon_url, icon_url)
  where id = p_channel;
end $function$
;

CREATE OR REPLACE FUNCTION public.update_comment_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'INSERT' then
    update posts set comments_count = comments_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update posts set comments_count = comments_count - 1 where id = old.post_id;
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_comments_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    update public.posts set comments_count = comments_count + 1 where id = NEW.post_id;
  elsif TG_OP = 'DELETE' then
    update public.posts set comments_count = greatest(comments_count - 1, 0) where id = OLD.post_id;
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_community_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_TABLE_NAME = 'community_members' then
    update communities set member_count = (
      select count(*) from community_members where community_id = coalesce(NEW.community_id, OLD.community_id)
    ) where id = coalesce(NEW.community_id, OLD.community_id);
  elsif TG_TABLE_NAME = 'club_members' then
    update clubs set member_count = (
      select count(*) from club_members where club_id = coalesce(NEW.club_id, OLD.club_id)
    ) where id = coalesce(NEW.club_id, OLD.club_id);
  end if;
  return coalesce(NEW, OLD);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_community_settings(p_community uuid, p_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_join_mode text DEFAULT NULL::text, p_cover_color text DEFAULT NULL::text, p_rules text DEFAULT NULL::text, p_icon_url text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from communities c where c.id = p_community and c.owner_id = auth.uid()) then
    raise exception 'Only the owner can edit community settings';
  end if;
  if p_join_mode is not null and p_join_mode not in ('open','approval','invite') then
    raise exception 'Bad join mode';
  end if;
  update communities set
    name = coalesce(nullif(trim(p_name), ''), name),
    description = coalesce(p_description, description),
    category = coalesce(p_category, category),
    join_mode = coalesce(p_join_mode, join_mode),
    cover_color = coalesce(p_cover_color, cover_color),
    rules = coalesce(p_rules, rules),
    icon_url = coalesce(p_icon_url, icon_url)
  where id = p_community;
end $function$
;

CREATE OR REPLACE FUNCTION public.update_event_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    update public.events set attendees_count = attendees_count + 1 where id = NEW.event_id;
    update public.profiles set events_joined_count = events_joined_count + 1 where id = NEW.user_id;
  elsif TG_OP = 'DELETE' then
    update public.events set attendees_count = greatest(attendees_count - 1, 0) where id = OLD.event_id;
    update public.profiles set events_joined_count = greatest(events_joined_count - 1, 0) where id = OLD.user_id;
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_memory_book(p_album uuid, p_title text, p_cover_color text, p_audience text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
update memory_albums
set title = coalesce(nullif(trim(p_title), ''), 'Memories'),
    cover_color = coalesce(p_cover_color, 'blush'),
    audience = coalesce(p_audience, 'profile')
where id = p_album and user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.update_posts_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    update public.profiles set posts_count = posts_count + 1 where id = NEW.user_id;
  elsif TG_OP = 'DELETE' then
    update public.profiles set posts_count = greatest(posts_count - 1, 0) where id = OLD.user_id;
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_memory_album(p_title text, p_cover_color text, p_audience text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
insert into memory_albums (user_id, title, cover_color, audience, is_default)
values (auth.uid(), coalesce(p_title, 'Memories'), coalesce(p_cover_color, 'blush'), coalesce(p_audience, 'profile'), true)
on conflict (user_id) where is_default do update
set title = excluded.title, cover_color = excluded.cover_color, audience = excluded.audience;
$function$
;

CREATE OR REPLACE FUNCTION public.viewer_can_see_job(p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job_id
      and not exists (
        select 1 from public.blocked_users b
        where (b.blocker_id = auth.uid() and b.blocked_id = j.posted_by)
           or (b.blocker_id = j.posted_by and b.blocked_id = auth.uid())
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.viewer_can_see_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.can_view_post(p_post_id); $function$
;

CREATE OR REPLACE FUNCTION public.viewer_can_see_story(p_story_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.stories s
    where s.id = p_story_id
      and s.expires_at > now()
      and (
        s.user_id = auth.uid()
        or (
          auth.uid() is not null
          and (
            coalesce(s.audience, 'everyone') = 'everyone'
            or (s.audience = 'followers' and exists (
              select 1 from public.follows f
              where f.following_id = s.user_id and f.follower_id = auth.uid()))
            or (s.audience = 'close_friends' and exists (
              select 1 from public.close_friends cf
              where cf.owner_id = s.user_id and cf.friend_id = auth.uid()))
            or (s.audience = 'only_with' and exists (
              select 1 from public.story_shared_with sw
              where sw.story_id = s.id and sw.user_id = auth.uid()))
            or (s.audience = 'except' and not exists (
              select 1 from public.story_hidden_from hf
              where hf.story_id = s.id and hf.user_id = auth.uid()))
          )
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.vote_channel_poll(p_message uuid, p_option uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_channel uuid; v_ends timestamptz;
begin
  select m.channel_id, pl.ends_at into v_channel, v_ends
  from channel_messages m join channel_polls pl on pl.message_id = m.id
  where m.id = p_message;
  if v_channel is null then raise exception 'No poll on that message'; end if;
  if v_ends < now() then raise exception 'This poll has closed'; end if;
  if not exists (select 1 from channel_members where channel_id = v_channel and user_id = auth.uid()) then
    raise exception 'Join the channel to vote';
  end if;
  if not exists (select 1 from channel_poll_options o where o.id = p_option and o.message_id = p_message) then
    raise exception 'Bad option';
  end if;
  insert into channel_poll_votes (message_id, user_id, option_id)
  values (p_message, auth.uid(), p_option)
  on conflict (message_id, user_id) do update set option_id = excluded.option_id, created_at = now();
end $function$
;

CREATE OR REPLACE FUNCTION public.vote_poll(p_post_id uuid, p_option_id uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
insert into post_poll_votes (post_id, option_id, voter_id)
values (p_post_id, p_option_id, auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.vote_story_poll(p_poll_id uuid, p_option_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_option_poll_id uuid;
  v_story_id uuid;
BEGIN
  -- Verify option belongs to this poll
  SELECT poll_id INTO v_option_poll_id
  FROM story_poll_options
  WHERE id = p_option_id;

  IF v_option_poll_id IS NULL THEN
    RAISE EXCEPTION 'Option not found';
  END IF;

  IF v_option_poll_id != p_poll_id THEN
    RAISE EXCEPTION 'Option does not belong to this poll';
  END IF;

  -- Upsert vote
  INSERT INTO story_poll_votes (poll_id, option_id, user_id)
  VALUES (p_poll_id, p_option_id, auth.uid())
  ON CONFLICT (poll_id, user_id)
  DO UPDATE SET option_id = EXCLUDED.option_id, updated_at = now();

  -- Get story_id to return updated results
  SELECT story_id INTO v_story_id
  FROM story_polls WHERE id = p_poll_id;

  -- Return fresh results
  RETURN get_story_poll(v_story_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.vouch_for(p_user_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    declare
      v_me uuid := auth.uid();
      v_app uuid;
    begin
      if v_me is null then raise exception 'Not signed in'; end if;
      if v_me = p_user_id then return jsonb_build_object('error', 'own'); end if;
      if not exists (select 1 from profiles where id = v_me and is_verified = true) then
        return jsonb_build_object('error', 'not_verified');
      end if;
      select id into v_app from verification_applications
       where applicant_id = p_user_id and status in ('pending', 'submitted')
       order by created_at desc limit 1;
      if v_app is null then return jsonb_build_object('error', 'no_application'); end if;
      insert into verification_referrals (application_id, referrer_id, note)
      values (v_app, v_me, nullif(trim(coalesce(p_note, '')), ''))
      on conflict (application_id, referrer_id) do nothing;
      return jsonb_build_object('ok', true);
    end;
    $function$
;

CREATE OR REPLACE FUNCTION public.withdraw_mentorship_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.mentorship_requests
     set status = 'withdrawn', responded_at = now()
   where id = p_request_id and mentee_id = auth.uid() and status = 'pending';

  if not found then raise exception 'Request not found or not yours'; end if;
end;
$function$
;
