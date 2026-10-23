-- Real web story soundtrack authoring; owner uploads or approved reusable sounds.
-- Does not grant Apple Music synchronization rights.
alter table public.story_drafts add column if not exists audio_draft jsonb;
create or replace function public.resolve_story_soundtrack(p_audio jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare chosen public.story_sounds; location text[]; duration integer; url text;
begin
 if p_audio is null or p_audio='null'::jsonb then return null; end if;
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in to attach audio' using errcode='42501'; end if;
 if jsonb_typeof(p_audio)<>'object' then raise exception 'INVALID_AUDIO' using errcode='22023'; end if;
 if p_audio->>'kind'='sound' then
  select * into chosen from public.story_sounds where id=(p_audio->>'soundId')::uuid and rights_status in ('creator_attested','licensed') for share;
  if not found then raise exception 'SOUND_UNAVAILABLE' using errcode='22023'; end if;
  return jsonb_build_object('url',chosen.url,'title',chosen.title,'source',chosen.source,'duration',chosen.duration_sec,'publish_sound',false);
 elsif p_audio->>'kind'='voiceover' then
  if (p_audio->>'rightsAttested')::boolean is distinct from true then raise exception 'AUDIO_RIGHTS_REQUIRED' using errcode='22023'; end if;
  duration:=(p_audio->>'durationSec')::integer; url:=p_audio->>'url';
  if duration is null or duration not between 1 and 30 then raise exception 'INVALID_AUDIO_DURATION' using errcode='22023'; end if;
  location:=regexp_match(url,'^https://[^/]+/storage/v1/object/public/(story-media)/([^?#]+)$');
  if location is null or location[2] ~ '(%|\\|(^|/)\.\.?(/|$)|//)' or not exists(
   select 1 from storage.objects o where o.bucket_id=location[1] and o.name=location[2] and coalesce(o.owner_id,o.owner::text)=auth.uid()::text
  ) then raise exception 'AUDIO_MUST_BELONG_TO_YOU' using errcode='42501'; end if;
  return jsonb_build_object('url',url,'title',coalesce(nullif(left(p_audio->>'title',200),''),'Original sound'),'source','voiceover','duration',duration,'publish_sound',coalesce((p_audio->>'addToSounds')::boolean,false));
 end if;
 raise exception 'INVALID_AUDIO_KIND' using errcode='22023';
end $$;
revoke all on function public.resolve_story_soundtrack(jsonb) from public,anon,authenticated;

create or replace function public.publish_story_v2(p_expected_user uuid,p_request_id uuid,p_story jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); old story_ops.publications; sid uuid:=gen_random_uuid();
 st jsonb; recipients uuid[]; filter text; media text; typ text; aud text;
 origin uuid; origin_sticker text; draft uuid; audio jsonb; mix_value jsonb;
begin
 if u is null or u is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_story) is distinct from 'object' then raise exception 'INVALID_STORY'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into old from story_ops.publications where request_id=p_request_id;
 if found then
  if old.user_id<>u or old.payload_hash<>md5(p_story::text) then raise exception 'PUBLICATION_CONFLICT'; end if;
  return old.story_id;
 end if;
 audio:=public.resolve_story_soundtrack(p_story->'audio_draft');
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
 insert into public.stories(id,user_id,media_url,media_type,caption,audience,filter_id,stickers_json,media_transform,text_background,duration_sec,audio_url,audio_title,audio_source,audio_duration_sec)
 values(sid,u,case when typ='text' then null else media end,typ,nullif(trim(p_story->>'caption'),''),aud,filter,
 coalesce(p_story->'stickers_json','[]'),nullif(p_story->'media_transform','null'::jsonb),nullif(p_story->'text_background','null'::jsonb),
 case when typ='video' then greatest(1,least(60,coalesce((p_story->>'duration_sec')::integer,10))) else null end,
 audio->>'url',audio->>'title',audio->>'source',(audio->>'duration')::integer);
 if (audio->>'publish_sound')::boolean then perform public.publish_story_sound(sid,true); end if;
 if aud='only_with' then insert into public.story_shared_with(story_id,user_id) select sid,r from unnest(recipients) r; end if;
 insert into public.story_mentions(story_id,mentioned_user_id,mentioned_by_user_id,visible)
 select sid,p.id,u,true from public.profiles p where p.id<>u and (
 lower(p.username) in (select lower(m[1]) from regexp_matches(coalesce(p_story->>'caption',''),'@([A-Za-z0-9_.]{2,30})','g') m)
 or p.id::text in (select value->>'mentionUserId' from jsonb_array_elements(coalesce(p_story->'stickers_json','[]')) where value->>'kind'='mention'));
 -- Join the source prompt in the same transaction as the new story.
 for st in select value from jsonb_array_elements(coalesce(p_story->'stickers_json','[]')) where value->>'kind'='addyours' and nullif(value->>'addYoursOriginStoryId','') is not null loop
  origin:=(st->>'addYoursOriginStoryId')::uuid; origin_sticker:=st->>'addYoursOriginStickerId';
  perform public.submit_sticker_response(origin,origin_sticker,'addyours',sid::text,null,null);
 end loop;
 if draft is not null then delete from public.story_drafts where id=draft and user_id=u; end if;
 insert into story_ops.publications values(p_request_id,u,md5(p_story::text),sid,now());
 return sid;
end; $$;
revoke all on function public.publish_story_v2(uuid,uuid,jsonb) from public,anon;
grant execute on function public.publish_story_v2(uuid,uuid,jsonb) to authenticated;

