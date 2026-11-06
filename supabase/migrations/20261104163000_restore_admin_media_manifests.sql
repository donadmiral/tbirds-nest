-- Restore only the dashboard/moderation media read contract missing in production.
-- These three definitions are byte-identical to the existing reviewed migration.
-- Preserve the production content document policy, all data, schema ACLs and
-- every app-role grant. Existing QA installations must match the known baseline.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $repair$
declare r record; installed integer; expected integer:=3; f pg_proc;
begin
 if current_user<>'postgres' or to_regnamespace('media_delivery') is null then
  raise exception 'ADMIN_MEDIA_REPAIR_UNEXPECTED_OWNER_OR_SCHEMA';
 end if;
 if md5(pg_get_functiondef(to_regprocedure('public.content_media_document(text,uuid)'))) is null
  or md5(pg_get_functiondef(to_regprocedure('public.content_media_document(text,uuid)'))) not in
   ('e663c86c78634eb16e0871f0007ef5a2','c596bc998164b6818c3c90f250e75539')
  or md5(pg_get_functiondef(to_regprocedure('public.content_media_strings(jsonb)'))) is distinct from '34bc7a6d60138c7ee4d2cddb643c800e'
 then raise exception 'ADMIN_MEDIA_REPAIR_UNEXPECTED_DOCUMENT_HELPERS';end if;
 for r in select * from (values
  ('public','posts','id','uuid'),
  ('public','posts','user_id','uuid'),
  ('public','posts','created_at','timestamptz'),
  ('public','stories','id','uuid'),
  ('public','stories','user_id','uuid'),
  ('public','stories','created_at','timestamptz'),
  ('public','content_media_bindings','entity_kind','text'),
  ('public','content_media_bindings','entity_id','uuid'),
  ('public','content_media_bindings','bucket_id','text'),
  ('public','content_media_bindings','object_path','text'),
  ('public','content_media_bindings','uploader_id','uuid'),
  ('content_media_legacy','snapshots','entity_kind','text'),
  ('content_media_legacy','snapshots','entity_id','uuid'),
  ('content_media_legacy','snapshots','author_id','uuid'),
  ('content_media_legacy','snapshots','publication_created_at','timestamptz'),
  ('content_media_legacy','snapshots','object_id','uuid'),
  ('content_media_legacy','snapshots','object_version','text'),
  ('content_media_legacy','snapshots','bucket_id','text'),
  ('content_media_legacy','snapshots','object_path','text'),
  ('content_media_legacy','snapshots','canonical_url','text'),
  ('content_media_legacy','snapshots','revoked_at','timestamptz'),
  ('storage','objects','id','uuid'),
  ('storage','objects','version','text'),
  ('storage','objects','bucket_id','text'),
  ('storage','objects','name','text'),
  ('storage','objects','owner_id','text'),
  ('storage','objects','owner','uuid')
 ) needed(schema_name,table_name,column_name,type_name) loop
  if not exists(select 1 from information_schema.columns c where c.table_schema=r.schema_name
   and c.table_name=r.table_name and c.column_name=r.column_name and c.udt_name=r.type_name) then
   raise exception 'ADMIN_MEDIA_REPAIR_MISSING_DEPENDENCY';
  end if;
 end loop;
 select count(*) into installed from (values
  ('media_delivery.admin_content_references(text,uuid[],text)','0dafb4cfe9959a2c302791260314f5eb',false),
  ('public.admin_bound_content_media_object(text,uuid,text,text,text)','ca1fcf0c422d54b85e90ec0f0fe06432',true),
  ('public.admin_bound_content_media_manifest(text,uuid[],text)','56134a88c42a1a1d3c0fe28dc4db0a35',true)
 ) known(signature,digest,service_access) where to_regprocedure(signature) is not null;
 if installed not in (0,expected) then raise exception 'ADMIN_MEDIA_REPAIR_PARTIAL_BASELINE';end if;
 if installed=expected then
  for r in select * from (values
  ('media_delivery.admin_content_references(text,uuid[],text)','0dafb4cfe9959a2c302791260314f5eb',false),
  ('public.admin_bound_content_media_object(text,uuid,text,text,text)','ca1fcf0c422d54b85e90ec0f0fe06432',true),
  ('public.admin_bound_content_media_manifest(text,uuid[],text)','56134a88c42a1a1d3c0fe28dc4db0a35',true)
  ) known(signature,digest,service_access) loop
   select * into f from pg_proc where oid=to_regprocedure(r.signature);
   if md5(pg_get_functiondef(f.oid)) is distinct from r.digest or pg_get_userbyid(f.proowner)<>'postgres'
    or not f.prosecdef or f.provolatile<>'s' or f.proconfig is distinct from array['search_path=""']
    or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
    or has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from r.service_access
   then raise exception 'ADMIN_MEDIA_REPAIR_UNEXPECTED_EXISTING_FUNCTION';end if;
  end loop;
  return;
 end if;
 execute $install_0$
create function media_delivery.admin_content_references(p_kind text,p_entity_ids uuid[],p_origin text)
returns table(entity_id uuid,bucket_id text,object_path text,object_id uuid,object_version text)
language sql stable security definer set search_path='' as $$
 with entities as materialized (
  select p.id,p.user_id author_id,p.created_at published_at from public.posts p
   where p_kind='post' and p.id=any(p_entity_ids)
  union all
  select s.id,s.user_id,s.created_at from public.stories s
   where p_kind='story' and s.id=any(p_entity_ids)
 ), urls as (
  select e.*,u.url from entities e
   cross join lateral public.content_media_strings(public.content_media_document(p_kind,e.id)) u(url)
 ), located as (
  select u.*,regexp_match(substring(u.url from length(p_origin)+1),
   '^/storage/v1/object/public/(post-media|story-media|media)/([^?#]+)(?:[?]t=[0-9]+)?$') loc
  from urls u where starts_with(u.url,p_origin||'/')
 )
 select distinct l.id,o.bucket_id,o.name,o.id,o.version
 from located l join storage.objects o on o.bucket_id=l.loc[1] and o.name=l.loc[2]
 where o.version is not null and length(o.name) between 1 and 1024
  and o.name !~ '(%|\\|(^|/)\.\.?(/|$)|//|^[ /]|/$|[[:cntrl:]])'
  and (
   exists(select 1 from public.content_media_bindings b where b.entity_kind=p_kind and b.entity_id=l.id
    and b.bucket_id=o.bucket_id and b.object_path=o.name and b.uploader_id::text=coalesce(o.owner_id,o.owner::text))
   or exists(select 1 from content_media_legacy.snapshots s where s.entity_kind=p_kind and s.entity_id=l.id
    and s.author_id=l.author_id and s.publication_created_at=l.published_at and s.object_id=o.id and s.object_version=o.version
    and s.bucket_id=o.bucket_id and s.object_path=o.name and s.canonical_url=l.url and s.revoked_at is null
    and (coalesce(o.owner_id,o.owner::text) is null or coalesce(o.owner_id,o.owner::text)=l.author_id::text))
  );
$$;
$install_0$;
 execute $install_1$
create function public.admin_bound_content_media_object(p_kind text,p_entity_id uuid,p_bucket text,p_path text,p_origin text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_kind is null or p_kind not in ('post','story') or p_entity_id is null
  or p_bucket is null or p_bucket not in ('post-media','story-media','media')
  or p_origin is null or p_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
  or p_path is null or length(p_path) not between 1 and 1024
  or p_path ~ '(%|\\|(^|/)\.\.?(/|$)|//|^/|/$|[[:cntrl:]])' then return null;end if;
 select jsonb_build_object('object_id',r.object_id,'object_version',r.object_version) into result
  from media_delivery.admin_content_references(p_kind,array[p_entity_id],p_origin) r
  where r.bucket_id=p_bucket and r.object_path=p_path;
 return result;
end $$;
$install_1$;
 execute $install_2$
create function public.admin_bound_content_media_manifest(p_kind text,p_entity_ids uuid[],p_origin text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_kind is null or p_kind not in ('post','story') or p_entity_ids is null
  or cardinality(p_entity_ids) not between 1 and 200 or array_position(p_entity_ids,null) is not null
  or p_origin is null or p_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
 then raise exception 'ADMIN_MEDIA_INVALID_REFERENCE' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.entity_id,'bucket_id',r.bucket_id,'object_path',r.object_path)
   order by r.entity_id,r.bucket_id,r.object_path),'[]'::jsonb) into result
 from (select * from media_delivery.admin_content_references(p_kind,p_entity_ids,p_origin)
  order by entity_id,bucket_id,object_path limit 4001) r;
 if jsonb_array_length(result)>4000 then raise exception 'ADMIN_MEDIA_TOO_LARGE' using errcode='54000';end if;
 return result;
end $$;
$install_2$;

 revoke all on function media_delivery.admin_content_references(text,uuid[],text) from public,anon,authenticated,service_role;
 revoke all on function public.admin_bound_content_media_object(text,uuid,text,text,text) from public,anon,authenticated;
 grant execute on function public.admin_bound_content_media_object(text,uuid,text,text,text) to service_role;
 revoke all on function public.admin_bound_content_media_manifest(text,uuid[],text) from public,anon,authenticated;
 grant execute on function public.admin_bound_content_media_manifest(text,uuid[],text) to service_role;
 for r in select * from (values
  ('media_delivery.admin_content_references(text,uuid[],text)','0dafb4cfe9959a2c302791260314f5eb',false),
  ('public.admin_bound_content_media_object(text,uuid,text,text,text)','ca1fcf0c422d54b85e90ec0f0fe06432',true),
  ('public.admin_bound_content_media_manifest(text,uuid[],text)','56134a88c42a1a1d3c0fe28dc4db0a35',true)
 ) known(signature,digest,service_access) loop
  select * into f from pg_proc where oid=to_regprocedure(r.signature);
  if md5(pg_get_functiondef(f.oid)) is distinct from r.digest or pg_get_userbyid(f.proowner)<>'postgres'
   or not f.prosecdef or f.provolatile<>'s' or f.proconfig is distinct from array['search_path=""']
   or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from r.service_access
  then raise exception 'ADMIN_MEDIA_REPAIR_POSTFLIGHT_FAILED';end if;
 end loop;
end $repair$;
notify pgrst,'reload schema';
commit;
