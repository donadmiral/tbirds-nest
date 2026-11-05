-- Read-only QA source snapshot, 2026-11-05. Body md5: 0ebaedeaded2112da609f33e07f91fa4
CREATE OR REPLACE FUNCTION media_delivery.issue(p_url text, p_kind text, p_id uuid, p_session uuid)
 RETURNS TABLE(bucket_id text, object_path text, token text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare loc text[];o storage.objects%rowtype; capability text; deadline timestamptz:=clock_timestamp()+interval '5 minutes';
begin
 loc:=regexp_match(p_url,'^https://[^/]+/storage/v1/object/public/(post-media|story-media|media|chat-media|chat-files)/([^?#]+)(?:[?]t=[0-9]+)?$');
 if loc is null or loc[2] ~ '(%|\\|(^|/)\.\.?(/|$)|//)' or length(loc[2])>1024 then return;end if;
 select * into o from storage.objects s where s.bucket_id=loc[1] and s.name=loc[2] and s.version is not null;
 if not found then return;end if;
 if p_kind not in ('upload','chat','chat_object') and not media_delivery.content_provenance(p_kind,p_id,p_url,o.bucket_id,o.name,coalesce(o.owner_id,o.owner::text)) then return;end if;
 capability:=encode(extensions.gen_random_bytes(32),'hex');
 insert into media_delivery.tickets(token_digest,user_id,session_id,object_id,object_version,object_owner,bucket_id,object_path,source_kind,source_id,source_url,expires_at)
 values(extensions.digest(capability,'sha256'),auth.uid(),p_session,o.id,o.version,coalesce(o.owner_id,o.owner::text),o.bucket_id,o.name,p_kind,p_id,p_url,deadline);
 return query select o.bucket_id,o.name,capability,deadline;
end $function$
;

-- Read-only QA source snapshot, 2026-11-05. Body md5: ad13482b7786c2279b8f1aac969a2a30
CREATE OR REPLACE FUNCTION public.resolve_media_delivery(p_token text, p_bucket text, p_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g media_delivery.tickets%rowtype; allowed boolean:=false;
 old_sub text:=coalesce(current_setting('request.jwt.claim.sub',true),'');
 old_role text:=coalesce(current_setting('request.jwt.claim.role',true),'');
 old_claims text:=coalesce(current_setting('request.jwt.claims',true),'');
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null;end if;
 select * into g from media_delivery.tickets where token_digest=extensions.digest(p_token,'sha256')
  and bucket_id=p_bucket and object_path=p_path and expires_at>clock_timestamp();
 if not found or not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=g.session_id and s.user_id=g.user_id
  and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()))
  or not exists(select 1 from storage.objects o where o.id=g.object_id and o.bucket_id=g.bucket_id and o.name=g.object_path
   and o.version=g.object_version and coalesce(o.owner_id,o.owner::text) is not distinct from g.object_owner) then return null;end if;
 perform set_config('request.jwt.claim.sub',g.user_id::text,true),set_config('request.jwt.claim.role','authenticated',true),
  set_config('request.jwt.claims',jsonb_build_object('sub',g.user_id,'role','authenticated','session_id',g.session_id,'is_anonymous',false)::text,true);
 if g.source_kind='upload' then
  select exists(select 1 from public.content_upload_manifest(jsonb_build_array(g.source_url)) m where m.media_url=g.source_url) into allowed;
 elsif g.source_kind='chat' then
  select exists(select 1 from public.chat_media_manifest(array[g.source_id]) m where m.view_limit is null and g.source_url in(m.media_url,m.thumbnail_url)) into allowed;
 elsif g.source_kind='chat_object' then
  allowed:=g.object_owner=g.user_id::text or (public.chat_locator_unrestricted(g.bucket_id||'/'||g.object_path)
   and (public.can_read_chat_object(g.bucket_id,g.object_path) or public.can_read_legacy_chat_object(g.bucket_id,g.object_path)));
 else
  select exists(select 1 from public.content_media_manifest(jsonb_build_array(jsonb_build_object('kind',g.source_kind,'id',g.source_id))) m where m.media_url=g.source_url) into allowed;
 end if;
 perform set_config('request.jwt.claim.sub',old_sub,true),set_config('request.jwt.claim.role',old_role,true),set_config('request.jwt.claims',old_claims,true);
 if not coalesce(allowed,false) or (exists(select 1 from business_auth.accounts where business_id=g.user_id) and not business_auth.session_allowed(g.user_id,g.session_id)) then return null;end if;
 return jsonb_build_object('bucket',g.bucket_id,'path',g.object_path,'version',g.object_version,'expiresAt',g.expires_at);
exception when others then
 perform set_config('request.jwt.claim.sub',old_sub,true),set_config('request.jwt.claim.role',old_role,true),set_config('request.jwt.claims',old_claims,true);
 return null;
end $function$
;
