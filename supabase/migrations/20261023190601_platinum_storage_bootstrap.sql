-- Add missing buckets without changing visibility or limits of existing ones.
-- post/story/legacy content is authorized by content-media-sign. Chat retains
-- the stricter policies in chat_storage_cutover_and_reference_guards.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('post-media','post-media',false,104857600,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/mp4','audio/mpeg','audio/aac','application/pdf']),
 ('story-media','story-media',false,104857600,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/mp4','audio/x-caf','audio/mpeg','audio/aac','audio/webm','audio/ogg']),
 ('media','media',false,104857600,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/mp4','audio/mpeg','audio/aac','application/pdf']),
 ('chat-media','chat-media',false,104857600,array['image/*','video/*','audio/*']),
 ('chat-files','chat-files',false,26214400,null),
 ('avatars','avatars',true,10485760,array['image/jpeg','image/png','image/webp','image/gif']),
 ('market-media','market-media',true,10485760,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do nothing;

-- Extend only the story audio formats the supported recorders produce; leave
-- unrestricted buckets and their existing size/visibility choices untouched.
update storage.buckets b set allowed_mime_types=(
 select array_agg(distinct mime order by mime)
 from unnest(b.allowed_mime_types || array['audio/mp4','audio/x-caf','audio/mpeg','audio/aac','audio/webm','audio/ogg']) mime
) where b.id='story-media' and b.allowed_mime_types is not null;

create or replace function public.platinum_upload_path_allowed(p_bucket text,p_name text)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare actor text;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then return false; end if;
 if p_bucket not in ('post-media','story-media','media','avatars','market-media') then return false; end if;
 if p_name is null or length(p_name)>1024 or p_name !~ '^[A-Za-z0-9_. /-]+$'
   or p_name ~ '(^|/)\.\.?(/|$)|//' then return false; end if;
 actor:=case when p_bucket='market-media' and split_part(p_name,'/',1)='listings'
   then split_part(p_name,'/',2) else split_part(p_name,'/',1) end;
 if actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or position('/' in p_name)=0 then return false; end if;
 return public.can_act_as(actor::uuid);
end $$;
revoke all on function public.platinum_upload_path_allowed(text,text) from public,anon;
grant execute on function public.platinum_upload_path_allowed(text,text) to authenticated;

-- Restrictive rules also constrain old broad policies from the production
-- schema. No unrelated, channel, CV, or chat policy is removed or widened.
drop policy if exists platinum_content_anon_read_guard on storage.objects;
create policy platinum_content_anon_read_guard on storage.objects as restrictive for select to anon
 using(bucket_id not in ('post-media','story-media','media'));
drop policy if exists platinum_assets_anon_insert_guard on storage.objects;
create policy platinum_assets_anon_insert_guard on storage.objects as restrictive for insert to anon
 with check(bucket_id not in ('post-media','story-media','media','avatars','market-media'));
drop policy if exists platinum_assets_anon_update_guard on storage.objects;
create policy platinum_assets_anon_update_guard on storage.objects as restrictive for update to anon
 using(bucket_id not in ('post-media','story-media','media','avatars','market-media'))
 with check(bucket_id not in ('post-media','story-media','media','avatars','market-media'));
drop policy if exists platinum_assets_anon_delete_guard on storage.objects;
create policy platinum_assets_anon_delete_guard on storage.objects as restrictive for delete to anon
 using(bucket_id not in ('post-media','story-media','media','avatars','market-media'));

drop policy if exists platinum_content_owner_read_guard on storage.objects;
create policy platinum_content_owner_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id not in ('post-media','story-media','media') or coalesce(owner_id,owner::text)=(select auth.uid())::text);
drop policy if exists platinum_content_owner_read on storage.objects;
create policy platinum_content_owner_read on storage.objects for select to authenticated
 using(bucket_id in ('post-media','story-media','media') and coalesce(owner_id,owner::text)=(select auth.uid())::text);

drop policy if exists platinum_assets_insert_guard on storage.objects;
create policy platinum_assets_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id not in ('post-media','story-media','media','avatars','market-media') or (
 public.platinum_upload_path_allowed(bucket_id,name) and coalesce(owner_id,owner::text)=(select auth.uid())::text));
drop policy if exists platinum_assets_insert on storage.objects;
create policy platinum_assets_insert on storage.objects for insert to authenticated
 with check(bucket_id in ('post-media','story-media','media','avatars','market-media') and
 public.platinum_upload_path_allowed(bucket_id,name) and coalesce(owner_id,owner::text)=(select auth.uid())::text);

-- Published content is immutable. Replacement uses a new object name, so old
-- manifests and other viewers never silently change underneath a signed URL.
drop policy if exists platinum_content_immutable_guard on storage.objects;
create policy platinum_content_immutable_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id not in ('post-media','story-media','media')) with check(bucket_id not in ('post-media','story-media','media'));
drop policy if exists platinum_content_delete_guard on storage.objects;
create policy platinum_content_delete_guard on storage.objects as restrictive for delete to authenticated
 using(bucket_id not in ('post-media','story-media','media'));

-- Profile pictures and public catalog photos intentionally use public URLs.
-- Their owners may replace/delete them; nobody may claim another actor's path.
drop policy if exists platinum_public_asset_read on storage.objects;
create policy platinum_public_asset_read on storage.objects for select to anon,authenticated
 using(bucket_id in ('avatars','market-media'));
drop policy if exists platinum_public_asset_update_guard on storage.objects;
create policy platinum_public_asset_update_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id not in ('avatars','market-media') or coalesce(owner_id,owner::text)=(select auth.uid())::text)
 with check(bucket_id not in ('avatars','market-media') or (coalesce(owner_id,owner::text)=(select auth.uid())::text and public.platinum_upload_path_allowed(bucket_id,name)));
drop policy if exists platinum_public_asset_update on storage.objects;
create policy platinum_public_asset_update on storage.objects for update to authenticated
 using(bucket_id in ('avatars','market-media') and coalesce(owner_id,owner::text)=(select auth.uid())::text)
 with check(bucket_id in ('avatars','market-media') and coalesce(owner_id,owner::text)=(select auth.uid())::text and public.platinum_upload_path_allowed(bucket_id,name));
drop policy if exists platinum_public_asset_delete_guard on storage.objects;
create policy platinum_public_asset_delete_guard on storage.objects as restrictive for delete to authenticated
 using(bucket_id not in ('avatars','market-media') or coalesce(owner_id,owner::text)=(select auth.uid())::text);
drop policy if exists platinum_public_asset_delete on storage.objects;
create policy platinum_public_asset_delete on storage.objects for delete to authenticated
 using(bucket_id in ('avatars','market-media') and coalesce(owner_id,owner::text)=(select auth.uid())::text);
