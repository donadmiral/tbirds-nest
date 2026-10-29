-- Persist complete web story drafts; publish audience, stickers and mentions atomically.
begin;
set local lock_timeout='3s';
alter table public.story_drafts add column if not exists filter_id text;
alter table public.story_drafts add column if not exists stickers_json jsonb not null default '[]';
alter table public.story_drafts add column if not exists media_transform jsonb;
alter table public.story_drafts add column if not exists text_background jsonb;
create schema if not exists story_ops;
revoke all on schema story_ops from public,anon,authenticated;
create table story_ops.publications (
  request_id uuid primary key, user_id uuid not null, payload_hash text not null,
  story_id uuid not null, created_at timestamptz not null default now()
);
alter table story_ops.publications enable row level security;
revoke all on story_ops.publications from public,anon,authenticated;

create or replace function public.publish_story_v2(p_expected_user uuid,p_request_id uuid,p_story jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); old story_ops.publications; sid uuid:=gen_random_uuid();
 st jsonb; recipients uuid[]; filter text; media text; typ text; aud text;
 origin uuid; origin_sticker text; draft uuid;
begin
 if u is null or u is distinct from p_expected_user then raise exception 'ACCOUNT_CHANGED' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_story) is distinct from 'object' then raise exception 'INVALID_STORY'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into old from story_ops.publications where request_id=p_request_id;
 if found then
  if old.user_id<>u or old.payload_hash<>md5(p_story::text) then raise exception 'PUBLICATION_CONFLICT'; end if;
  return old.story_id;
 end if;
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
 insert into public.stories(id,user_id,media_url,media_type,caption,audience,filter_id,stickers_json,media_transform,text_background,duration_sec)
 values(sid,u,case when typ='text' then null else media end,typ,nullif(trim(p_story->>'caption'),''),aud,filter,
 coalesce(p_story->'stickers_json','[]'),nullif(p_story->'media_transform','null'::jsonb),nullif(p_story->'text_background','null'::jsonb),
 case when typ='video' then greatest(1,least(60,coalesce((p_story->>'duration_sec')::integer,10))) else null end);
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

-- Keep private answers private and validate against an actual visible sticker.
revoke insert,update on public.story_sticker_responses from anon,authenticated;
alter table public.story_sticker_responses enable row level security;
create policy story_response_private_read on public.story_sticker_responses as restrictive for select to authenticated using (user_id=(select auth.uid()) or exists(select 1 from public.stories s where s.id=story_id and s.user_id=(select auth.uid())));

create or replace function public.submit_sticker_response(p_story_id uuid,p_sticker_id text,p_response_type text,p_text_value text default null,p_number_value numeric default null,p_option_id text default null)
returns json language plpgsql security definer set search_path='' as $$
declare st jsonb; r public.story_sticker_responses; u uuid:=auth.uid();
begin
 if u is null or public.viewer_can_see_story(p_story_id) is not true then raise exception 'STORY_UNAVAILABLE' using errcode='42501'; end if;
 select value into st from public.stories s cross join lateral jsonb_array_elements(coalesce(s.stickers_json,'[]')) value where s.id=p_story_id and value->>'id'=p_sticker_id;
 if st is null or st->>'kind' is distinct from p_response_type or p_response_type not in ('question','slider','quiz','countdown','addyours','notify','magic') then raise exception 'INVALID_STICKER'; end if;
 if p_response_type='slider' and (p_number_value is null or p_number_value not between 0 and 1) then raise exception 'INVALID_SLIDER'; end if;
 if p_response_type='question' and (nullif(trim(p_text_value),'') is null or length(p_text_value)>1000) then raise exception 'INVALID_ANSWER'; end if;
 if p_response_type='quiz' and not exists(select 1 from jsonb_array_elements(st->'quizOptions') o where o->>'id'=p_option_id) then raise exception 'INVALID_OPTION'; end if;
 if length(coalesce(p_text_value,''))>1000 then raise exception 'ANSWER_TOO_LONG'; end if;
 if p_response_type='addyours' and not exists(select 1 from public.stories s where s.id::text=p_text_value and s.user_id=u) then raise exception 'STORY_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_story_id::text||p_sticker_id,1));
 select * into r from public.story_sticker_responses where story_id=p_story_id and sticker_id=p_sticker_id and user_id=u and (p_response_type<>'question' or text_value=trim(p_text_value)) order by created_at desc limit 1;
 if found then return row_to_json(r); end if;
 insert into public.story_sticker_responses(story_id,sticker_id,user_id,response_type,text_value,number_value,option_id)
 values(p_story_id,p_sticker_id,u,p_response_type,case when p_response_type in ('question','addyours') then trim(p_text_value) else null end,case when p_response_type='slider' then p_number_value else null end,case when p_response_type='quiz' then p_option_id else null end) returning * into r;
 return row_to_json(r);
end; $$;

create or replace function public.get_sticker_responses(p_story_id uuid,p_sticker_id text)
returns table(id uuid,story_id uuid,sticker_id text,user_id uuid,response_type text,text_value text,number_value numeric,option_id text,created_at timestamptz,full_name text,username text,avatar_url text)
language sql stable security definer set search_path='' as $$
 select r.id,r.story_id,r.sticker_id,r.user_id,r.response_type,r.text_value,r.number_value,r.option_id,r.created_at,p.full_name,p.username,p.avatar_url
 from public.story_sticker_responses r join public.profiles p on p.id=r.user_id
 where r.story_id=p_story_id and r.sticker_id=p_sticker_id
 and exists(select 1 from public.stories s where s.id=p_story_id and s.user_id=auth.uid()) order by r.created_at desc,r.id desc limit 200;
$$;
create or replace function public.get_my_sticker_response(p_story_id uuid,p_sticker_id text)
returns json language sql stable security definer set search_path='' as $$
 select row_to_json(r) from public.story_sticker_responses r where r.story_id=p_story_id and r.sticker_id=p_sticker_id and r.user_id=auth.uid() and public.viewer_can_see_story(p_story_id) order by r.created_at desc,r.id desc limit 1;
$$;
create or replace function public.get_story_sticker_summary(p_story_id uuid,p_sticker_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare own boolean; kind text; result jsonb;
begin
 select s.user_id=auth.uid(), st->>'kind' into own,kind from public.stories s cross join lateral jsonb_array_elements(coalesce(s.stickers_json,'[]')) st where s.id=p_story_id and st->>'id'=p_sticker_id;
 if auth.uid() is null or own is null or (not own and public.viewer_can_see_story(p_story_id) is not true) then raise exception 'STORY_UNAVAILABLE' using errcode='42501'; end if;
 if not own and kind not in ('quiz','slider','addyours') then raise exception 'PRIVATE_RESPONSES' using errcode='42501'; end if;
 select jsonb_build_object('count',count(*),'average',avg(number_value),'options',coalesce((select jsonb_object_agg(k,n) from (select option_id k,count(*) n from public.story_sticker_responses where story_id=p_story_id and sticker_id=p_sticker_id and option_id is not null group by option_id) o),'{}')) into result
 from public.story_sticker_responses where story_id=p_story_id and sticker_id=p_sticker_id;
 return result;
end; $$;
revoke all on function public.submit_sticker_response(uuid,text,text,text,numeric,text),public.get_sticker_responses(uuid,text),public.get_my_sticker_response(uuid,text),public.get_story_sticker_summary(uuid,text) from public,anon;
grant execute on function public.submit_sticker_response(uuid,text,text,text,numeric,text),public.get_sticker_responses(uuid,text),public.get_my_sticker_response(uuid,text),public.get_story_sticker_summary(uuid,text) to authenticated;
commit;
