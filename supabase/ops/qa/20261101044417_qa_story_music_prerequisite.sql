-- QA-only prerequisite from the current tested visual publication source.
-- Only publish_story_v2 changes. Existing trigger/policy bodies and execution
-- privileges remain intact. The unchanged music migration runs next, disabled.
-- No historical audio exists in the reviewed QA baseline; reject any new audio
-- before changing the legacy publisher. No content, identity or Storage write.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=pg_catalog;
lock table public.stories,public.story_sounds,public.memory_albums,public.post_media in share row exclusive mode;
do $preflight$ begin
 if current_user<>'postgres' then raise exception 'STORY_MUSIC_POSTGRES_REQUIRED';end if;
 if to_regnamespace('music_library')is not null then raise exception 'STORY_MUSIC_ALREADY_ADVANCED';end if;
 if (select jsonb_agg(to_jsonb(f)order by f.signature)from(select p.oid::regprocedure::text as signature,md5(pg_get_functiondef(p.oid))as "definitionMd5",pg_get_userbyid(p.proowner)as owner,p.proacl::text as acl,p.proconfig as config,p.prosecdef as "securityDefiner"from pg_proc p where p.oid=any(array['public.get_story_for_reshare(uuid)','public.guard_and_notify_media_tag()','public.guard_story_mention_identity()','public.guard_story_reference_cards()','public.mark_story_reshared(uuid)','public.publish_story_v2(uuid,uuid,jsonb)','public.story_payload_mentions(jsonb)','public.trg_story_mention_notify()','public.viewer_can_see_story(uuid)']::regprocedure[])order by p.proname)f)is distinct from '[{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.get_story_for_reshare(uuid)","definitionMd5":"6d0f8034c4e07ebbd2eb83cfb9ce5800","securityDefiner":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.guard_and_notify_media_tag()","definitionMd5":"5f2928b1fd88da9ee597f94431be5734","securityDefiner":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.guard_story_mention_identity()","definitionMd5":"6b33213f3580e6a0972b20481aab643f","securityDefiner":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.guard_story_reference_cards()","definitionMd5":"a4f66bf3486959d65691e81548eff2a4","securityDefiner":true},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.mark_story_reshared(uuid)","definitionMd5":"2238445bcca82773913b98a8afe5ead8","securityDefiner":true},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.publish_story_v2(uuid,uuid,jsonb)","definitionMd5":"f915d1249e96ac5d72ba01b7daecca1a","securityDefiner":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.story_payload_mentions(jsonb)","definitionMd5":"294fe0309a8481c5b132c83c89207b5c","securityDefiner":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.trg_story_mention_notify()","definitionMd5":"71149fbf529296eb94b3e08f53f94d07","securityDefiner":true},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.viewer_can_see_story(uuid)","definitionMd5":"9b7dad58cef5e338dd10e1c4889a7464","securityDefiner":true}]'::jsonb then raise exception 'STORY_MUSIC_SOURCE_OR_ACL_DRIFT';end if;
 if (select count(*)from supabase_migrations.schema_migrations where name='qa_business_auth_08_activate_storage_surfaces_20261101'and cardinality(statements)=1 and octet_length(array_to_string(statements,E'\n'))=16058 and encode(sha256(convert_to(array_to_string(statements,E'\n'),'UTF8')),'hex')='d60f5b0e782295d770bb1cf0a4ec066c275b3a90fe0b26364c4226ac55f7b55d')<>1 then raise exception 'STORY_MUSIC_BUSINESS_ACTIVATION_REQUIRED';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.memory_albums'::regclass and attnum=9 and attname='soundtrack'and atttypid='jsonb'::regtype and not attnotnull and not attisdropped)then raise exception 'STORY_MUSIC_BOOK_BASELINE_DRIFT';end if;
 if exists(select 1 from public.story_sounds)or exists(select 1 from public.stories where audio_url is not null)
 or exists(select 1 from public.memory_albums where soundtrack is not null)
 or exists(select 1 from public.post_media pm where to_jsonb(pm)->'soundtrack'is not null and to_jsonb(pm)->'soundtrack'<>'null'::jsonb)then raise exception 'STORY_MUSIC_EXISTING_AUDIO_REVIEW';end if;
end $preflight$;
CREATE OR REPLACE FUNCTION public.publish_story_v2(p_expected_user uuid, p_request_id uuid, p_story jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 u uuid:=auth.uid(); old story_ops.publications; sid uuid:=gen_random_uuid();
 st jsonb; recipients uuid[]; filter text; media text; typ text; aud text;
 origin uuid; origin_sticker text; draft uuid; mix_value jsonb;
begin
 if u is null or u is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_story) is distinct from 'object' then raise exception 'INVALID_STORY'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into old from story_ops.publications where request_id=p_request_id;
 if found then
  if old.user_id<>u or old.payload_hash<>md5(p_story::text) then raise exception 'PUBLICATION_CONFLICT'; end if;
  return old.story_id;
 end if;
 if p_story ? 'allow_replies' and jsonb_typeof(p_story->'allow_replies') is distinct from 'boolean' then
  raise exception 'INVALID_REPLY_SETTING' using errcode='22023';
 end if;
 -- This visual-only publisher never resolves, uploads, or registers added audio.
 -- Existing video sound and its saved playback volume remain part of the video.
 if p_story->'audio_draft' is not null and p_story->'audio_draft'<>'null'::jsonb then
  raise exception 'MUSIC_UNAVAILABLE' using errcode='22023';
 end if;
 for mix_value in select value from jsonb_each(coalesce(nullif(p_story#>'{media_transform,mix}','null'::jsonb),'{}'::jsonb)) loop
  if jsonb_typeof(mix_value)<>'number' or (mix_value#>>'{}')::numeric not between 0 and 100 then raise exception 'INVALID_AUDIO_MIX' using errcode='22023'; end if;
 end loop;
 typ:=p_story->>'media_type'; media:=p_story->>'media_url'; aud:=coalesce(p_story->>'audience','everyone');
 filter:=nullif(p_story->>'filter_id','');
 if typ is null or typ not in ('image','video','text') or aud not in ('everyone','followers','close_friends','only_with')
 or length(coalesce(p_story->>'caption',''))>120 or length(coalesce(filter,''))>50 then raise exception 'INVALID_STORY'; end if;
 if typ<>'text' and (media is null or media !~ '^https://[^/]+/storage/v1/object/public/story-media/' or split_part(media,'/story-media/',2) not like u::text||'/%') then raise exception 'INVALID_STORY_MEDIA'; end if;
 if typ='text' and jsonb_typeof(p_story->'text_background') is distinct from 'object' then raise exception 'TEXT_BACKGROUND_REQUIRED'; end if;
 if coalesce(jsonb_typeof(p_story->'stickers_json'),'array')<>'array' or coalesce(jsonb_array_length(p_story->'stickers_json'),0)>30 then raise exception 'INVALID_STICKERS'; end if;
 if octet_length(p_story::text)>131072 then raise exception 'STORY_TOO_LARGE'; end if;
 if p_story ? 'hidden_mentions' and (jsonb_typeof(p_story->'hidden_mentions') is distinct from 'array'
  or jsonb_array_length(p_story->'hidden_mentions')>200) then raise exception 'INVALID_HIDDEN_MENTIONS'; end if;
 for st in select value from jsonb_array_elements(coalesce(p_story->'stickers_json','[]')) loop
  if nullif(st->>'id','') is null or length(st->>'id')>128 or length(coalesce(st->>'text',''))>1000 then raise exception 'INVALID_STICKER'; end if;
  if st->>'nx' is null or st->>'ny' is null or (st->>'nx')::numeric not between 0 and 1 or (st->>'ny')::numeric not between 0 and 1 then raise exception 'INVALID_STICKER_POSITION'; end if;
  if st->>'kind'='link' and (st->>'url' is null or st->>'url' !~ '^https?://[^[:space:]]+$') then raise exception 'INVALID_LINK'; end if;
  if st->>'kind'='quiz' and (jsonb_typeof(st->'quizOptions') is distinct from 'array' or jsonb_array_length(st->'quizOptions') not between 2 and 4) then raise exception 'INVALID_QUIZ'; end if;
 end loop;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(coalesce(p_story->'stickers_json','[]'))) then raise exception 'DUPLICATE_STICKER'; end if;
 select array_agg(distinct value::uuid) into recipients from jsonb_array_elements_text(coalesce(p_story->'shared_with','[]'));
 if aud='only_with' and coalesce(cardinality(recipients),0)=0 then raise exception 'RECIPIENT_REQUIRED'; end if;
 if coalesce(cardinality(recipients),0)>200 or exists(select 1 from unnest(recipients) r where not exists(select 1 from public.profiles p where p.id=r)) then raise exception 'INVALID_RECIPIENT'; end if;
 draft:=nullif(p_story->>'draft_id','')::uuid;
 if draft is not null and not exists(select 1 from public.story_drafts d where d.id=draft and d.user_id=u) then raise exception 'DRAFT_NOT_FOUND'; end if;
 insert into public.stories(id,user_id,media_url,media_type,caption,audience,filter_id,stickers_json,media_transform,text_background,duration_sec,allow_replies)
 values(sid,u,case when typ='text' then null else media end,typ,nullif(trim(p_story->>'caption'),''),aud,filter,
 coalesce(p_story->'stickers_json','[]'),nullif(p_story->'media_transform','null'::jsonb),nullif(p_story->'text_background','null'::jsonb),
 case when typ='video' then greatest(1,least(60,coalesce((p_story->>'duration_sec')::integer,10))) else null end,
 coalesce((p_story->>'allow_replies')::boolean,true));
 if aud='only_with' then insert into public.story_shared_with(story_id,user_id) select sid,r from unnest(recipients) r; end if;
 insert into public.story_mentions(story_id,mentioned_user_id,mentioned_by_user_id,visible,allow_reshare)
 select sid,m.user_id,u,m.visible,coalesce((p_story->>'allow_mention_reshare')::boolean,true)
 from public.story_payload_mentions(p_story) m where m.user_id<>u;
 -- Join the source prompt in the same transaction as the new story.
 for st in select value from jsonb_array_elements(coalesce(p_story->'stickers_json','[]')) where value->>'kind'='addyours' and nullif(value->>'addYoursOriginStoryId','') is not null loop
  origin:=(st->>'addYoursOriginStoryId')::uuid; origin_sticker:=st->>'addYoursOriginStickerId';
  perform public.submit_sticker_response(origin,origin_sticker,'addyours',sid::text,null,null);
 end loop;
 if draft is not null then delete from public.story_drafts where id=draft and user_id=u; end if;
 insert into story_ops.publications values(p_request_id,u,md5(p_story::text),sid,now());
 return sid;
end; $function$
;
do $postcondition$ begin
 if (select jsonb_agg(to_jsonb(f)order by f.signature)from(select p.oid::regprocedure::text as signature,md5(pg_get_functiondef(p.oid))as "definitionMd5",pg_get_userbyid(p.proowner)as owner,p.proacl::text as acl,p.proconfig as config,p.prosecdef as "securityDefiner"from pg_proc p where p.oid=any(array['public.get_story_for_reshare(uuid)','public.guard_and_notify_media_tag()','public.guard_story_mention_identity()','public.guard_story_reference_cards()','public.mark_story_reshared(uuid)','public.publish_story_v2(uuid,uuid,jsonb)','public.story_payload_mentions(jsonb)','public.trg_story_mention_notify()','public.viewer_can_see_story(uuid)']::regprocedure[])order by p.proname)f)is distinct from '[{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.get_story_for_reshare(uuid)","definitionMd5":"6d0f8034c4e07ebbd2eb83cfb9ce5800","securityDefiner":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.guard_and_notify_media_tag()","definitionMd5":"5f2928b1fd88da9ee597f94431be5734","securityDefiner":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.guard_story_mention_identity()","definitionMd5":"6b33213f3580e6a0972b20481aab643f","securityDefiner":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.guard_story_reference_cards()","definitionMd5":"a4f66bf3486959d65691e81548eff2a4","securityDefiner":true},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.mark_story_reshared(uuid)","definitionMd5":"2238445bcca82773913b98a8afe5ead8","securityDefiner":true},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.publish_story_v2(uuid,uuid,jsonb)","definitionMd5":"a45f9673c681b1da88e2d790c652c7e0","securityDefiner":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.story_payload_mentions(jsonb)","definitionMd5":"294fe0309a8481c5b132c83c89207b5c","securityDefiner":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.trg_story_mention_notify()","definitionMd5":"71149fbf529296eb94b3e08f53f94d07","securityDefiner":true},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=\"\""],"signature":"public.viewer_can_see_story(uuid)","definitionMd5":"9b7dad58cef5e338dd10e1c4889a7464","securityDefiner":true}]'::jsonb then raise exception 'STORY_MUSIC_POSTCONDITION_FAILED';end if;
end $postcondition$;
notify pgrst,'reload schema';
commit;
