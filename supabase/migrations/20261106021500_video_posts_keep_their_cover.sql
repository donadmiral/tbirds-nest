-- Every video post keeps a cover the apps can show.
--
-- A live clip published to the feed or a community stored its poster under edit.thumbnail, a name no app reads, so
-- those posts showed a placeholder tile on Discover. The publication now writes the poster as coverUrl as well, and
-- the clips already published get the same. A Studio-scheduled post dropped the media recipe on publication, so a
-- scheduled video never had a cover; the row now keeps the recipe the planner saved, including the cover captured at
-- upload. Both functions are patched in place, so their grants, owners and every other line stay as released.
do $install$
declare original text; changed text;
begin
  original := pg_get_functiondef('live_streams.clip_publish_one(uuid)'::regprocedure);
  changed := replace(original,
    'jsonb_build_object(''liveClipId'',c.id,''thumbnail'',thumbnail,''duration''',
    'jsonb_build_object(''liveClipId'',c.id,''thumbnail'',thumbnail,''coverUrl'',thumbnail,''duration''');
  if changed = original then raise exception 'LIVE_CLIP_PUBLISH_ANCHOR_MISSING'; end if;
  execute changed;

  original := pg_get_functiondef('public.studio_publish_row(uuid)'::regprocedure);
  changed := replace(original,
    'insert into post_media (post_id, url, media_type, width, height, sort_order)',
    'insert into post_media (post_id, url, media_type, width, height, sort_order, edit)');
  changed := replace(changed,
    '(m->>''width'')::int, (m->>''height'')::int, i);',
    '(m->>''width'')::int, (m->>''height'')::int, i, case when jsonb_typeof(m->''edit'') = ''object'' then m->''edit'' else null end);');
  if changed = original or position('sort_order, edit)' in changed) = 0 or position('m->''edit''' in changed) = 0 then raise exception 'STUDIO_PUBLISH_ANCHOR_MISSING'; end if;
  execute changed;
end $install$;

-- The clips already published: the poster they always had, under the name the apps read.
update public.post_media
   set edit = edit || jsonb_build_object('coverUrl', edit->>'thumbnail')
 where media_type = 'video' and jsonb_typeof(edit) = 'object' and edit ? 'thumbnail' and not (edit ? 'coverUrl')
   and edit->>'thumbnail' like '%/storage/v1/object/public/live-clips/%';
