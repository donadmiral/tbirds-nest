-- Visual story sharing, replies and retry-safe publication.
-- Built on the already applied base story editor; no music migrations required.
-- Mentions provide navigation and attribution without overriding an author's
-- current visibility, block list, expiry or permission to reshare.
create or replace function public.viewer_can_see_story(p_story_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from public.stories s join public.profiles p on p.id=s.user_id
  where s.id=p_story_id and s.created_at<=now() and s.expires_at>now() and p.deactivated_at is null
  and not exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=s.user_id) or (b.blocker_id=s.user_id and b.blocked_id=auth.uid()))
  and (s.user_id=auth.uid() or (
   not exists(select 1 from public.story_hidden_from h where h.story_id=s.id and h.user_id=auth.uid())
   and (coalesce(p.profile_visibility,'public')<>'private'
    or exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=s.user_id)
    or exists(select 1 from public.story_mentions m where m.story_id=s.id and m.mentioned_user_id=auth.uid()))
   and (coalesce(s.audience,'everyone')='everyone'
    or (s.audience='followers' and exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=s.user_id))
    or (s.audience='close_friends' and exists(select 1 from public.close_friends f where f.friend_id=auth.uid() and f.owner_id=s.user_id))
    or (s.audience='only_with' and exists(select 1 from public.story_shared_with w where w.story_id=s.id and w.user_id=auth.uid()))
    or s.audience='except')
  ))
 );
$$;
revoke all on function public.viewer_can_see_story(uuid) from public,anon;
grant execute on function public.viewer_can_see_story(uuid) to authenticated;

create or replace function public.get_story_for_reshare(p_story_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('story_id',s.id,'user_id',s.user_id,'username',p.username,'full_name',p.full_name,
  'avatar_url',p.avatar_url,'media_url',s.media_url,'media_type',s.media_type,'thumbnail_url',s.thumbnail_url)
 from public.stories s join public.profiles p on p.id=s.user_id
 where s.id=p_story_id and public.viewer_can_see_story(s.id)
 and (s.user_id=auth.uid() or (
  coalesce(s.allow_sharing,true) and coalesce(s.audience,'everyone')='everyone' and coalesce(p.profile_visibility,'public')<>'private'
  and exists(select 1 from public.story_mentions m where m.story_id=s.id and m.mentioned_user_id=auth.uid() and m.allow_reshare)
 ));
$$;
revoke all on function public.get_story_for_reshare(uuid) from public,anon;
grant execute on function public.get_story_for_reshare(uuid) to authenticated;

create or replace function public.mark_story_reshared(p_story_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if public.get_story_for_reshare(p_story_id) is null then raise exception 'STORY_RESHARE_UNAVAILABLE' using errcode='42501'; end if;
 update public.story_mentions set reshared_at=now()
 where story_id=p_story_id and mentioned_user_id=auth.uid() and reshared_at is null;
end $$;
revoke all on function public.mark_story_reshared(uuid) from public,anon;
grant execute on function public.mark_story_reshared(uuid) to authenticated;

create or replace function public.guard_story_reference_cards()
returns trigger language plpgsql security definer set search_path='' as $$
declare sticker jsonb; source jsonb; cleaned jsonb:='[]'::jsonb;
begin
 if new.stickers_json is null then return new; end if;
 if jsonb_typeof(new.stickers_json)<>'array' then raise exception 'INVALID_STICKERS'; end if;
 for sticker in select value from jsonb_array_elements(new.stickers_json) loop
  if sticker->>'kind' in ('story','post') and (
   auth.uid() is null or not coalesce(public.can_act_as(new.user_id),false)
  ) then raise exception 'STORY_REFERENCE_FORBIDDEN' using errcode='42501'; end if;
  if sticker->>'kind'='story' then
   source:=public.get_story_for_reshare(nullif(sticker->>'storyId','')::uuid);
   if source is null then raise exception 'STORY_RESHARE_UNAVAILABLE' using errcode='42501'; end if;
   sticker:=sticker || jsonb_build_object(
    'storyId',source->'story_id','storyAuthorId',source->'user_id',
    'storyAuthorName',coalesce(source->>'full_name',source->>'username','Story'),
    'storyAuthorUsername',source->'username','storyAuthorAvatar',source->'avatar_url',
    'storyMediaUrl',source->'media_url','storyThumbUrl',source->'thumbnail_url','storyMediaType',source->'media_type');
  elsif sticker->>'kind'='post' then
   -- A public outer story cannot widen the source post's audience. Read and
   -- canonicalize from one authorized snapshot, including for the source owner.
   -- Gallery URLs remain source-post references, never new uploader bindings.
   select jsonb_build_object(
    'postId',p.id,'postAuthorId',p.user_id,
    'postAuthorName',coalesce(nullif(author.full_name,''),nullif(author.username,''),'Platinum Circles'),
    'postUsername',author.username,'postAuthorAvatar',author.avatar_url,
    'postVerified',coalesce(author.is_verified,false),'postVerifiedTier',author.verified_tier,
    'postText',coalesce(nullif(p.content,''),p.body,''),'postArticleTitle',p.article_title,
    'postMediaUrl',coalesce(nullif(m.url,''),nullif(p.media_url,''),nullif(p.image_url,'')),
    'postMediaType',case
      when nullif(m.url,'') is not null then m.media_type
      when coalesce(nullif(p.media_url,''),nullif(p.image_url,'')) is null then null
      when coalesce(nullif(p.media_url,''),nullif(p.image_url,'')) ~* '\.(mp4|mov|webm|m4v)([?#]|$)' then 'video'
      else 'image' end,
    'postMediaCount',greatest((select count(*) from public.post_media pm where pm.post_id=p.id),
      case when coalesce(nullif(m.url,''),nullif(p.media_url,''),nullif(p.image_url,'')) is null then 0 else 1 end),
    'postMediaWidth',m.width,'postMediaHeight',m.height,
    'postCreatedAt',p.created_at,'postLikes',p.likes_count,'postComments',p.comments_count,'postReposts',p.reposts_count
   ) into source
   from public.posts p join public.profiles author on author.id=p.user_id
   left join lateral (
    select pm.url,pm.media_type,pm.width,pm.height from public.post_media pm
    where pm.post_id=p.id order by pm.sort_order nulls last,pm.id limit 1
   ) m on true
   where p.id=nullif(sticker->>'postId','')::uuid
    and public.can_view_post(p.id)
    and coalesce(p.audience,'everyone')='everyone' and p.archived_at is null
    and not coalesce(p.is_exclusive,false) and p.community_id is null
    and author.deactivated_at is null and coalesce(author.profile_visibility,'public')='public'
    and exists(select 1 from public.profiles viewer where viewer.id=auth.uid() and viewer.deactivated_at is null)
    and not exists(select 1 from public.blocked_users b
      where (b.blocker_id=p.user_id and b.blocked_id in (auth.uid(),new.user_id))
        or (b.blocked_id=p.user_id and b.blocker_id in (auth.uid(),new.user_id)));
   if source is null then raise exception 'POST_RESHARE_UNAVAILABLE' using errcode='42501'; end if;
   sticker:=sticker || source;
  end if;
  cleaned:=cleaned || jsonb_build_array(sticker);
 end loop;
 new.stickers_json:=cleaned;
 return new;
end $$;
revoke all on function public.guard_story_reference_cards() from public,anon,authenticated;
create trigger guard_story_reference_cards before insert or update of stickers_json on public.stories for each row execute function public.guard_story_reference_cards();

create or replace function public.guard_story_mention_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 if tg_op='UPDATE' and (new.id,new.story_id,new.mentioned_by_user_id,new.mentioned_user_id)
  is distinct from (old.id,old.story_id,old.mentioned_by_user_id,old.mentioned_user_id) then raise exception 'STORY_MENTION_IDENTITY_IMMUTABLE'; end if;
 select user_id into owner_id from public.stories where id=new.story_id;
 -- The narrow mark RPC may set only the recipient's reshare receipt.
 if tg_op='UPDATE' and new.mentioned_user_id=auth.uid() and new.visible=old.visible and new.allow_reshare=old.allow_reshare
  and new.created_at=old.created_at and new.reshared_at is not distinct from now()
  and public.get_story_for_reshare(new.story_id) is not null then return new; end if;
 if owner_id is null or new.mentioned_by_user_id is distinct from owner_id or not public.can_act_as(owner_id) then
  raise exception 'STORY_MENTION_FORBIDDEN' using errcode='42501';
 end if;
 if new.mentioned_user_id=owner_id
  or not exists(select 1 from public.profiles where id=new.mentioned_user_id and deactivated_at is null)
  or exists(select 1 from public.blocked_users b where (b.blocker_id=owner_id and b.blocked_id=new.mentioned_user_id) or (b.blocker_id=new.mentioned_user_id and b.blocked_id=owner_id)) then return null; end if;
 return new;
end $$;
revoke all on function public.guard_story_mention_identity() from public,anon,authenticated;
create trigger guard_story_mention_identity before insert or update on public.story_mentions for each row execute function public.guard_story_mention_identity();

create or replace function public.trg_story_mention_notify()
returns trigger language plpgsql security definer set search_path='' as $$
declare preview text;
begin
 if new.mentioned_user_id=new.mentioned_by_user_id then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('story-mention:'||new.story_id::text||':'||new.mentioned_user_id::text,0));
 select nullif(left(coalesce(caption,''),100),'') into preview from public.stories where id=new.story_id;
 -- Re-adding a deleted mention refreshes its permissions without duplicating
 -- the notification or resetting a recipient's read state.
 update public.notifications set body_preview=preview,
  data=coalesce(data,'{}'::jsonb)||jsonb_build_object('story_id',new.story_id,'visible',new.visible,'allow_reshare',new.allow_reshare)
 where recipient_id=new.mentioned_user_id and actor_id=new.mentioned_by_user_id and type='story_mention' and data->>'story_id'=new.story_id::text;
 if not found then
  insert into public.notifications(recipient_id,actor_id,type,message,body_preview,data,account_type)
  values(new.mentioned_user_id,new.mentioned_by_user_id,'story_mention','mentioned you in their story',preview,
   jsonb_build_object('story_id',new.story_id,'visible',new.visible,'allow_reshare',new.allow_reshare),'personal');
 end if;
 return new;
end $$;
revoke all on function public.trg_story_mention_notify() from public,anon,authenticated;
drop trigger if exists trg_story_mention_notify on public.story_mentions;
create trigger trg_story_mention_notify after insert or update of visible,allow_reshare on public.story_mentions for each row execute function public.trg_story_mention_notify();

create or replace function public.guard_and_notify_media_tag()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid; preview text;
begin
 if tg_op='UPDATE' and (new.id,new.post_id,new.media_id,new.user_id) is distinct from (old.id,old.post_id,old.media_id,old.user_id) then raise exception 'MEDIA_TAG_IDENTITY_IMMUTABLE'; end if;
 select p.user_id,left(p.content,140) into owner_id,preview from public.posts p join public.post_media m on m.post_id=p.id where p.id=new.post_id and m.id=new.media_id;
 if owner_id is null or not public.can_act_as(owner_id) then raise exception 'MEDIA_TAG_FORBIDDEN' using errcode='42501'; end if;
 if new.nx is null or new.ny is null or new.nx not between 0 and 1 or new.ny not between 0 and 1 then raise exception 'INVALID_MEDIA_TAG_POSITION' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles where id=new.user_id and deactivated_at is null)
  or exists(select 1 from public.blocked_users b where (b.blocker_id=owner_id and b.blocked_id=new.user_id) or (b.blocker_id=new.user_id and b.blocked_id=owner_id)) then return null; end if;
 if tg_op='INSERT' and new.user_id<>owner_id then
  perform pg_advisory_xact_lock(hashtextextended('photo-tag:'||new.post_id::text||':'||new.user_id::text,0));
  if not exists(select 1 from public.notifications where recipient_id=new.user_id and actor_id=owner_id and type='mention' and data->>'post_id'=new.post_id::text and data->>'kind'='photo_tag') then
   insert into public.notifications(recipient_id,actor_id,type,message,body_preview,data,account_type)
   values(new.user_id,owner_id,'mention','tagged you in a post',preview,jsonb_build_object('post_id',new.post_id,'media_id',new.media_id,'kind','photo_tag'),'personal');
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_and_notify_media_tag() from public,anon,authenticated;
create trigger guard_and_notify_media_tag before insert or update on public.post_media_tags for each row execute function public.guard_and_notify_media_tag();
create policy post_media_tags_visible_guard on public.post_media_tags as restrictive for select to authenticated using(public.can_view_post(post_id));

-- One interpretation of authored mention metadata for the atomic web publisher.
-- A removed/edited text handle is not silently converted into a hidden mention.
create or replace function public.story_payload_mentions(p_story jsonb)
returns table(user_id uuid,visible boolean)
language sql stable security definer set search_path='' as $$
 with stickers as (
  select value from jsonb_array_elements(case when jsonb_typeof(p_story->'stickers_json')='array' then p_story->'stickers_json' else '[]'::jsonb end)
 ), visible_people as (
  select p.id from public.profiles p
  where lower(p.username) in (
   select lower(m[1]) from regexp_matches(coalesce(p_story->>'caption',''),'(?:^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{2,30})(?![A-Za-z0-9_.])','g') m
  )
  union
  select p.id from stickers s join public.profiles p on p.id::text=s.value->>'mentionUserId'
  where s.value->>'kind'='mention'
  union
  select p.id from stickers s
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value->'mentions')='array' then s.value->'mentions' else '[]'::jsonb end) person
  join public.profiles p on p.id::text=person->>'id' and lower(p.username)=lower(person->>'username')
  where s.value->>'kind'='text' and lower(p.username) in (
   select lower(m[1]) from regexp_matches(coalesce(s.value->>'text',''),'(?:^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{2,30})(?![A-Za-z0-9_.])','g') m
  )
 ), selected as (
  select id,true as visible from visible_people
  union all
  select p.id,false from jsonb_array_elements(case when jsonb_typeof(p_story->'hidden_mentions')='array' then p_story->'hidden_mentions' else '[]'::jsonb end) hidden
  join public.profiles p on p.id::text=case when jsonb_typeof(hidden)='string' then hidden#>>'{}' else hidden->>'id' end
 )
 select id,bool_or(selected.visible) from selected group by id;
$$;
revoke all on function public.story_payload_mentions(jsonb) from public,anon,authenticated;


-- Preserve the selected reply setting when saving drafts and publishing atomically.
-- Older clients omit it and retain the existing default: replies are allowed.
alter table public.story_drafts add column if not exists allow_replies boolean not null default true;

create or replace function public.publish_story_v2(p_expected_user uuid,p_request_id uuid,p_story jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
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
end; $$;
revoke all on function public.publish_story_v2(uuid,uuid,jsonb) from public,anon;
grant execute on function public.publish_story_v2(uuid,uuid,jsonb) to authenticated;

