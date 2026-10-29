-- Preserve existing reference-card authorization while canonicalizing voice and timing.
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
    -- Only canonical creator playback fields cross into the story card.
    -- A caller cannot replace the post's audio recipe or attach soundtrack data.
    'postMediaPlayback',jsonb_build_object(
      'speed',case when jsonb_typeof(m.edit->'speed')='number' then greatest(.25,least(3,(m.edit->>'speed')::numeric)) else 1 end,
      'voiceEffect',case when m.edit->>'voiceEffect' in ('chipmunk','deep') then m.edit->>'voiceEffect' else 'original' end,
      'muted',coalesce(m.edit->'muted'='true'::jsonb,false),
      'trimStart',case when jsonb_typeof(m.edit->'trimStart')='number' then greatest(0,least(86400,(m.edit->>'trimStart')::numeric)) else 0 end,
      'trimEnd',case when jsonb_typeof(m.edit->'trimEnd')='number' then greatest(0,least(86400,(m.edit->>'trimEnd')::numeric)) else null end),
    'postCreatedAt',p.created_at,'postLikes',p.likes_count,'postComments',p.comments_count,'postReposts',p.reposts_count
   ) into source
   from public.posts p join public.profiles author on author.id=p.user_id
   left join lateral (
    select pm.url,pm.media_type,pm.width,pm.height,pm.edit from public.post_media pm
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
