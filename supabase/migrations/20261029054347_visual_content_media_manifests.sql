-- Visual media authorization only. This release does not install music rights,
-- reusable-sound publishing, soundtrack resolution, or audio signing.
-- Existing video files retain their recorded audio. Bucket visibility is unchanged.
create table if not exists public.content_media_bindings (
  entity_kind text not null check (entity_kind in ('post','story','story_draft')),
  entity_id uuid not null,
  bucket_id text not null check (bucket_id in ('post-media','story-media','media')),
  object_path text not null,
  uploader_id uuid not null,
  bound_at timestamptz not null default now(),
  primary key(entity_kind, entity_id, bucket_id, object_path)
);
alter table public.content_media_bindings enable row level security;
revoke all on public.content_media_bindings from public, anon, authenticated;

create or replace function public.content_media_strings(p_document jsonb)
returns setof text language sql immutable set search_path = '' as $$
  select distinct value #>> '{}' from jsonb_path_query(coalesce(p_document, '{}'::jsonb), 'lax $.** ? (@.type() == "string")') value;
$$;
revoke all on function public.content_media_strings(jsonb) from public, anon, authenticated;

-- Collections can intentionally retain a story beyond its 24-hour window.
-- Highlighted stories still respect their original audience; albums have their
-- own owner-selected audience and block list.
create or replace function public.content_story_audience_visible(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.stories s where s.id = p_id and (
    s.user_id = auth.uid() or coalesce(s.audience,'everyone') = 'everyone'
    or (s.audience = 'followers' and exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=s.user_id))
    or (s.audience = 'close_friends' and exists(select 1 from public.close_friends f where f.friend_id=auth.uid() and f.owner_id=s.user_id))
    or (s.audience = 'only_with' and exists(select 1 from public.story_shared_with f where f.user_id=auth.uid() and f.story_id=s.id))
    or (s.audience = 'except' and not exists(select 1 from public.story_hidden_from f where f.user_id=auth.uid() and f.story_id=s.id))
  ));
$$;
revoke all on function public.content_story_audience_visible(uuid) from public, anon, authenticated;

create or replace function public.content_media_document(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_document jsonb; v_article public.articles; v_blocks jsonb;
begin
  if p_kind = 'post' then
    select jsonb_build_object('media_url', p.media_url, 'image_url', p.image_url,
      'media', coalesce((select jsonb_agg(jsonb_build_object('url', m.url, 'edit', case when jsonb_typeof(m.edit) = 'object' then m.edit - 'soundtrack' else null end)) from public.post_media m where m.post_id = p.id), '[]'::jsonb),
      'products', coalesce((select jsonb_agg(jsonb_build_object('image_url', pp.image_url)) from public.post_products pp where pp.post_id = p.id), '[]'::jsonb))
      into v_document from public.posts p where p.id = p_id;
    select * into v_article from public.articles a where a.linked_post_id = p_id limit 1;
    if found then
      select coalesce(jsonb_agg(b.content), '[]'::jsonb) into v_blocks from public.article_blocks b where b.revision_id = v_article.current_revision_id;
      v_document := v_document || jsonb_build_object('article', v_blocks, 'assets', (
        select coalesce(jsonb_agg(jsonb_build_object('url', a.url, 'thumbnail_url', a.thumbnail_url)), '[]'::jsonb)
        from public.media_assets a where a.id = v_article.cover_asset_id or a.id::text in (select public.content_media_strings(v_blocks))
      ));
    end if;
  elsif p_kind = 'story' then
    select jsonb_build_object('media_url', s.media_url, 'thumbnail_url', s.thumbnail_url, 'dual_front_url', s.dual_front_url,
      'media_transform', s.media_transform,
      'stickers', coalesce((select jsonb_agg(jsonb_build_object('photoUrl', sticker->>'photoUrl'))
        from jsonb_array_elements(case when jsonb_typeof(s.stickers_json) = 'array' then s.stickers_json else '[]'::jsonb end) sticker), '[]'::jsonb))
      into v_document from public.stories s where s.id = p_id;
    -- postMediaUrl/entityImage are deliberately excluded. Their source content
    -- needs its own current authorization; a public outer story is insufficient.
  elsif p_kind = 'story_draft' then
    select jsonb_build_object('media_url', d.media_url, 'media_transform', d.media_transform,
      'stickers', coalesce((select jsonb_agg(jsonb_build_object('photoUrl', sticker->>'photoUrl'))
        from jsonb_array_elements(case when jsonb_typeof(d.stickers_json) = 'array' then d.stickers_json else '[]'::jsonb end) sticker), '[]'::jsonb))
      into v_document from public.story_drafts d where d.id = p_id;
  elsif p_kind = 'memory_album' then
    select jsonb_agg(jsonb_build_object('story', public.content_media_document('story', s.id), 'media_url', mp.media_url, 'thumbnail_url', mp.thumbnail_url))
      into v_document from public.memory_albums a join public.memory_pages mp on mp.album_id=a.id
      join public.stories s on s.id=mp.story_id and s.user_id=a.user_id where a.id=p_id;
  elsif p_kind = 'highlight' then
    select jsonb_build_object('cover_url', h.cover_url, 'stories', (
      select jsonb_agg(public.content_media_document('story', s.id)) from public.story_highlight_items hi
      join public.stories s on s.id=hi.story_id and s.user_id=h.user_id
      where hi.highlight_id=h.id and public.content_story_audience_visible(s.id)
    )) into v_document from public.story_highlights h where h.id=p_id;
  end if;
  return coalesce(v_document, '{}'::jsonb);
end $$;
revoke all on function public.content_media_document(text, uuid) from public, anon, authenticated;

create or replace function public.register_content_media(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_author uuid; v_url text; v_location text[]; v_owner text; v_uid uuid := auth.uid();
begin
  if p_kind = 'post' then select user_id into v_author from public.posts where id = p_id;
  elsif p_kind = 'story' then select user_id into v_author from public.stories where id = p_id;
  elsif p_kind = 'story_draft' then select user_id into v_author from public.story_drafts where id = p_id;
  end if;
  if v_author is null then return; end if;
  for v_url in select public.content_media_strings(public.content_media_document(p_kind, p_id)) loop
    v_location := regexp_match(v_url, '^https://[^/]+/storage/v1/object/public/(post-media|story-media|media)/([^?#]+)');
    if v_location is null then continue; end if;
    -- Uploaders use literal UUID/timestamp object paths. Encoded/traversing paths
    -- are not accepted as an alternate way to bind another storage object.
    if v_location[2] ~ '(%|\\|(^|/)\.\.?(/|$))' then
      if v_uid is not null then raise exception 'Invalid media object reference' using errcode = '22023'; end if;
      continue;
    end if;
    if exists (select 1 from public.content_media_bindings b where b.entity_kind = p_kind and b.entity_id = p_id and b.bucket_id = v_location[1] and b.object_path = v_location[2]) then continue; end if;
    select coalesce(o.owner_id, o.owner::text) into v_owner from storage.objects o where o.bucket_id = v_location[1] and o.name = v_location[2];
    if v_owner = coalesce(v_uid, v_author)::text then
      insert into public.content_media_bindings(entity_kind, entity_id, bucket_id, object_path, uploader_id)
        values (p_kind, p_id, v_location[1], v_location[2], coalesce(v_uid, v_author)) on conflict do nothing;
    elsif v_uid is not null then
      raise exception 'Media must belong to the publishing account' using errcode = '42501';
    end if;
    -- Backfill deliberately leaves ambiguous legacy ownership unbound.
  end loop;
end $$;
revoke all on function public.register_content_media(text, uuid) from public, anon, authenticated;

create or replace function public.register_content_media_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if tg_table_name = 'posts' then perform public.register_content_media('post', new.id);
  elsif tg_table_name in ('post_media','post_products') then perform public.register_content_media('post', new.post_id);
  elsif tg_table_name = 'stories' then perform public.register_content_media('story', new.id);
  elsif tg_table_name = 'story_drafts' then perform public.register_content_media('story_draft', new.id);
  elsif tg_table_name = 'articles' then perform public.register_content_media('post', new.linked_post_id);
  elsif tg_table_name = 'article_blocks' then
    select a.linked_post_id into v_id from public.articles a join public.article_revisions r on r.article_id = a.id where r.id = new.revision_id;
    if v_id is not null then perform public.register_content_media('post', v_id); end if;
  end if;
  return new;
end $$;
revoke all on function public.register_content_media_trigger() from public, anon, authenticated;
create trigger bind_post_media_objects after insert or update of media_url, image_url on public.posts for each row execute function public.register_content_media_trigger();
create trigger bind_post_gallery_objects after insert or update of url, edit on public.post_media for each row execute function public.register_content_media_trigger();
create trigger bind_post_product_objects after insert or update of image_url on public.post_products for each row execute function public.register_content_media_trigger();
create trigger bind_story_media_objects after insert or update of media_url, thumbnail_url, dual_front_url, stickers_json, media_transform on public.stories for each row execute function public.register_content_media_trigger();
create trigger bind_story_draft_objects after insert or update of media_url, stickers_json, media_transform on public.story_drafts for each row execute function public.register_content_media_trigger();
create trigger bind_article_media_objects after insert or update of current_revision_id, cover_asset_id on public.articles for each row execute function public.register_content_media_trigger();
create trigger bind_article_block_objects after insert or update of content on public.article_blocks for each row execute function public.register_content_media_trigger();

-- Only unambiguous storage-owner-to-author matches are backfilled automatically.
do $$ declare r record; begin
  for r in select id from public.posts loop perform public.register_content_media('post', r.id); end loop;
  for r in select id from public.stories loop perform public.register_content_media('story', r.id); end loop;
  for r in select id from public.story_drafts loop perform public.register_content_media('story_draft', r.id); end loop;
end $$;

create or replace function public.content_media_manifest(p_references jsonb)
returns table(entity_kind text, entity_id uuid, media_url text)
language plpgsql stable security definer set search_path = '' as $$
declare r record; v_author uuid; v_allowed boolean; v_url text; v_location text[];
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_references) is distinct from 'array' or jsonb_array_length(p_references) > 100 then raise exception 'At most 100 content references are allowed' using errcode = '22023'; end if;
  for r in select distinct x.kind, x.id from jsonb_to_recordset(p_references) x(kind text, id uuid) loop
    v_allowed := false; v_author := null;
    if r.kind = 'post' then
      select p.user_id, public.can_view_post(p.id)
      and (p.archived_at is null or p.user_id = auth.uid())
      and (not coalesce(p.is_exclusive, false) or public.can_act_as(p.user_id) or public.creator_has_active_subscription(p.user_id, auth.uid()))
      and (
        p.user_id = auth.uid() or coalesce(p.audience, 'everyone') = 'everyone'
        or (p.audience = 'followers' and exists(select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.user_id))
        or (p.audience = 'mentioned' and exists(select 1 from public.post_mentions m where m.post_id = p.id and m.mentioned_user_id = auth.uid()))
        or (p.audience = 'verified' and exists(select 1 from public.profiles v where v.id = auth.uid() and v.is_verified))
      ) into v_author, v_allowed from public.posts p where p.id = r.id;
    elsif r.kind = 'story' then
      select s.user_id, (s.user_id = auth.uid() or public.viewer_can_see_story(s.id)) into v_author, v_allowed from public.stories s where s.id = r.id;
    elsif r.kind = 'story_draft' then
      select d.user_id, d.user_id = auth.uid() into v_author, v_allowed from public.story_drafts d where d.id = r.id;
    elsif r.kind = 'memory_album' then
      select a.user_id, a.user_id=auth.uid() or (
        not exists(select 1 from public.memory_album_access x where x.owner_id=a.user_id and x.member_id=auth.uid() and x.kind='block') and (
          coalesce(a.audience,'profile')='profile'
          or (a.audience='followers' and exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=a.user_id))
          or (a.audience='custom' and exists(select 1 from public.memory_album_access x where x.owner_id=a.user_id and x.member_id=auth.uid() and x.kind='allow'))
        )
      ) into v_author,v_allowed from public.memory_albums a where a.id=r.id;
    elsif r.kind = 'highlight' then
      select h.user_id, true into v_author,v_allowed from public.story_highlights h where h.id=r.id;
    end if;
    if not coalesce(v_allowed, false) or exists(select 1 from public.blocked_users b where (b.blocker_id = auth.uid() and b.blocked_id = v_author) or (b.blocker_id = v_author and b.blocked_id = auth.uid())) then continue; end if;
    if v_author <> auth.uid() and exists(select 1 from public.profiles p where p.id = v_author and p.profile_visibility = 'private') and not exists(select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = v_author) then continue; end if;
    for v_url in select public.content_media_strings(public.content_media_document(r.kind, r.id)) loop
      v_location := regexp_match(v_url, '^https://[^/]+/storage/v1/object/public/(post-media|story-media|media)/([^?#]+)');
      if v_location is not null and (
        exists(select 1 from public.content_media_bindings b where b.entity_kind=r.kind and b.entity_id=r.id and b.bucket_id=v_location[1] and b.object_path=v_location[2])
        or (r.kind='memory_album' and exists(
          select 1 from public.memory_pages mp join public.stories s on s.id=mp.story_id and s.user_id=v_author
          join public.content_media_bindings b on b.entity_kind='story' and b.entity_id=s.id
          where mp.album_id=r.id and b.bucket_id=v_location[1] and b.object_path=v_location[2]))
        or (r.kind='highlight' and (exists(
          select 1 from public.story_highlight_items hi join public.stories s on s.id=hi.story_id and s.user_id=v_author
          join public.content_media_bindings b on b.entity_kind='story' and b.entity_id=s.id
          where hi.highlight_id=r.id and public.content_story_audience_visible(s.id) and b.bucket_id=v_location[1] and b.object_path=v_location[2])
          or exists(select 1 from public.story_highlights h join storage.objects o on o.bucket_id=v_location[1] and o.name=v_location[2]
            where h.id=r.id and h.cover_url=v_url and coalesce(o.owner_id,o.owner::text)=v_author::text)))
      ) then
        entity_kind := r.kind; entity_id := r.id; media_url := v_url; return next;
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.content_media_manifest(jsonb) from public, anon;
grant execute on function public.content_media_manifest(jsonb) to authenticated;
comment on table public.content_media_bindings is 'Verified publisher-to-object associations for gated visual post/story signing. No bucket visibility change in this staging migration.';
