BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $preflight$
DECLARE v record; p record;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Apply this repair as the database owner'; END IF;
  FOR v IN SELECT * FROM (VALUES
    ('publish_article(uuid,text,text,integer,text,integer,integer)', '34baf3199dbac5c94df9b2751b7058d6', 'postgres', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('publish_article(uuid,text,text,integer,text,integer,integer,jsonb)', 'a7d8df2ca7ad8eb04c670a2a568699bf', 'postgres', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
    ('can_act_as(uuid)', 'e4dd6da22fb2dd16b0a5c75750330e32', 'postgres', '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
  ) expected(signature, definition_hash, owner_name, acl) LOOP
    SELECT md5(pg_get_functiondef(oid)) hash, pg_get_userbyid(proowner) owner_name, proacl::text acl
      INTO p FROM pg_proc WHERE oid = to_regprocedure('public.' || v.signature);
    IF p.hash IS DISTINCT FROM v.definition_hash OR p.owner_name IS DISTINCT FROM v.owner_name
       OR p.acl IS DISTINCT FROM v.acl THEN
      RAISE EXCEPTION 'Function changed since review: %', v.signature;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.publish_article(p_user_id uuid, p_title text, p_body text, p_read_minutes integer, p_cover_url text DEFAULT NULL::text, p_cover_width integer DEFAULT NULL::integer, p_cover_height integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_post_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_user_id is null or public.can_act_as(p_user_id) is not true then
    raise exception 'You cannot publish as this profile' using errcode = '42501';
  end if;

  insert into public.posts (user_id, body, article_title, read_minutes)
  values (p_user_id, p_body, p_title, p_read_minutes)
  returning id into v_post_id;

  if p_cover_url is not null then
    insert into public.post_media (post_id, url, media_type, sort_order, role, width, height)
    values (v_post_id, p_cover_url, 'image', 0, 'cover', p_cover_width, p_cover_height);
  end if;

  return v_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_article(p_user_id uuid, p_title text, p_body text, p_read_minutes integer, p_cover_url text DEFAULT NULL::text, p_cover_width integer DEFAULT NULL::integer, p_cover_height integer DEFAULT NULL::integer, p_blocks jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_post_id uuid;
  v_article_id uuid;
  v_revision_id uuid;
  v_cover_asset_id uuid;
  v_block jsonb;
  v_pos integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_user_id is null or public.can_act_as(p_user_id) is not true then
    raise exception 'You cannot publish as this profile' using errcode = '42501';
  end if;

  insert into public.posts (user_id, body, article_title, read_minutes)
  values (p_user_id, p_body, p_title, p_read_minutes)
  returning id into v_post_id;

  if p_cover_url is not null then
    insert into public.post_media (post_id, url, media_type, sort_order, role, width, height)
    values (v_post_id, p_cover_url, 'image', 0, 'cover', p_cover_width, p_cover_height);
  end if;

  if p_blocks is not null then
    if p_cover_url is not null then
      insert into public.media_assets (owner_id, kind, url, width, height)
      values (p_user_id, 'image', p_cover_url, p_cover_width, p_cover_height)
      returning id into v_cover_asset_id;
    end if;

    insert into public.articles (author_id, title, excerpt, cover_asset_id, status, linked_post_id, published_at)
    values (p_user_id, p_title, left(p_body, 200), v_cover_asset_id, 'published', v_post_id, now())
    returning id into v_article_id;

    insert into public.article_revisions (article_id, revision_number, editor_id, published_at)
    values (v_article_id, 1, p_user_id, now())
    returning id into v_revision_id;

    for v_block in select * from jsonb_array_elements(p_blocks)
    loop
      insert into public.article_blocks (revision_id, block_type, position, content)
      values (v_revision_id, v_block->>'type', v_pos, v_block);
      v_pos := v_pos + 1;
    end loop;

    update public.articles set current_revision_id = v_revision_id where id = v_article_id;
  end if;

  return v_post_id;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.publish_article(uuid,text,text,integer,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_article(uuid,text,text,integer,text,integer,integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.publish_article(uuid,text,text,integer,text,integer,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_article(uuid,text,text,integer,text,integer,integer,jsonb) TO authenticated, service_role;
COMMIT;
