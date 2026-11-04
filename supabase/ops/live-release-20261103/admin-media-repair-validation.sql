-- Read-only QA acceptance for the existing three admin media functions.
-- No identities, media objects, grants or application rows are created.
begin read only;
set local statement_timeout='30s';
do $verify$
declare
 origin text:='https://uaulhuelcfkjwojtymmw.supabase.co';
 unknown_id uuid:='00000000-0000-4000-8000-000000000001';
 ids uuid[]; manifest jsonb; item jsonb; proof jsonb; r record;
 checks text[]:=array[]::text[]; objects_checked integer:=0;
begin
 select array_agg(id) into ids from (select id from public.posts order by likes_count desc nulls last limit 12) p;
 ids:=coalesce(ids,array[unknown_id]);
 for r in select * from (values
  ('media_delivery.admin_content_references(text,uuid[],text)','0dafb4cfe9959a2c302791260314f5eb',false),
  ('public.admin_bound_content_media_object(text,uuid,text,text,text)','ca1fcf0c422d54b85e90ec0f0fe06432',true),
  ('public.admin_bound_content_media_manifest(text,uuid[],text)','56134a88c42a1a1d3c0fe28dc4db0a35',true)
 ) f(signature,digest,service_access) loop
  if md5(pg_get_functiondef(to_regprocedure(r.signature))) is distinct from r.digest
   or has_function_privilege('anon',r.signature,'EXECUTE')
   or has_function_privilege('authenticated',r.signature,'EXECUTE')
   or has_function_privilege('service_role',r.signature,'EXECUTE') is distinct from r.service_access
  then raise exception 'ADMIN_MEDIA_QA_DEFINITION_OR_ACL_MISMATCH';end if;
  checks:=array_append(checks,'definition_and_acl:'||r.signature);
 end loop;
 set local role service_role;
 manifest:=public.admin_bound_content_media_manifest('post',ids,origin);
 if jsonb_typeof(manifest) is distinct from 'array' or jsonb_array_length(manifest)>4000 then
  raise exception 'ADMIN_MEDIA_QA_MANIFEST_SHAPE';
 end if;
 for item in select value from jsonb_array_elements(manifest) loop
  if not((item->>'entity_id')::uuid=any(ids)) or item->>'bucket_id' not in ('post-media','story-media','media')
   or coalesce(length(item->>'object_path'),0) not between 1 and 1024 then
   raise exception 'ADMIN_MEDIA_QA_MANIFEST_SCOPE';
  end if;
 end loop;
 checks:=array_append(checks,'current_bounded_manifest');
 for item in select value from jsonb_array_elements(manifest) limit 8 loop
  proof:=public.admin_bound_content_media_object('post',(item->>'entity_id')::uuid,item->>'bucket_id',item->>'object_path',origin);
  if proof is null or coalesce(length(proof->>'object_version'),0)=0 or jsonb_typeof(proof->'object_id') is distinct from 'string' then
   raise exception 'ADMIN_MEDIA_QA_OBJECT_ROUND_TRIP';
  end if;
  objects_checked:=objects_checked+1;
 end loop;
 if public.admin_bound_content_media_manifest('post',array[unknown_id],origin)<>'[]'::jsonb then
  raise exception 'ADMIN_MEDIA_QA_UNKNOWN_ENTITY';
 end if;
 checks:=array_append(checks,'unknown_entity_has_no_media');
 if public.admin_bound_content_media_manifest('post',array_fill(unknown_id,array[200]),origin)<>'[]'::jsonb then
  raise exception 'ADMIN_MEDIA_QA_MAXIMUM_INPUT';
 end if;
 checks:=array_append(checks,'exact_200_entity_limit');
 if public.admin_bound_content_media_manifest('post',ids,'https://unrelated.invalid')<>'[]'::jsonb then
  raise exception 'ADMIN_MEDIA_QA_FOREIGN_ORIGIN';
 end if;
 checks:=array_append(checks,'foreign_origin_has_no_media');
 if public.admin_bound_content_media_object('post',unknown_id,'post-media','../sample.jpg',origin) is not null
  or public.admin_bound_content_media_object('post',unknown_id,'post-media','sample.jpg',origin) is not null then
  raise exception 'ADMIN_MEDIA_QA_INVALID_OBJECT';
 end if;
 checks:=array_append(checks,'missing_and_traversal_objects_denied');
 for r in select * from (values
  ('invalid_kind','bad'::text,array[unknown_id],origin),
  ('null_kind',null::text,array[unknown_id],origin),
  ('empty_ids','post',array[]::uuid[],origin),
  ('null_ids','post',null::uuid[],origin),
  ('null_id_entry','post',array[null::uuid],origin),
  ('over_200_ids','post',array_fill(unknown_id,array[201]),origin),
  ('null_origin','post',array[unknown_id],null::text),
  ('insecure_origin','post',array[unknown_id],'http://unrelated.invalid'),
  ('origin_path','post',array[unknown_id],'https://unrelated.invalid/path')
 ) invalid(label,kind,entity_ids,base) loop
  begin
   perform public.admin_bound_content_media_manifest(r.kind,r.entity_ids,r.base);
   raise exception 'ADMIN_MEDIA_QA_INVALID_INPUT_ACCEPTED';
  exception when invalid_parameter_value then
   checks:=array_append(checks,'rejects:'||r.label);
  end;
 end loop;
 begin
  perform media_delivery.admin_content_references('post',array[unknown_id],origin);
  raise exception 'ADMIN_MEDIA_QA_PRIVATE_HELPER_EXPOSED';
 exception when insufficient_privilege then
  checks:=array_append(checks,'service_cannot_call_private_helper');
 end;
 reset role;
 for r in select * from (values('anon'),('authenticated')) roles(name) loop
  execute format('set local role %I',r.name);
  begin
   perform public.admin_bound_content_media_manifest('post',array[unknown_id],origin);
   raise exception 'ADMIN_MEDIA_QA_MANIFEST_ROLE_EXPOSED';
  exception when insufficient_privilege then
   checks:=array_append(checks,r.name||'_manifest_denied');
  end;
  begin
   perform public.admin_bound_content_media_object('post',unknown_id,'post-media','sample.jpg',origin);
   raise exception 'ADMIN_MEDIA_QA_OBJECT_ROLE_EXPOSED';
  exception when insufficient_privilege then
   checks:=array_append(checks,r.name||'_object_denied');
  end;
  reset role;
 end loop;
 perform set_config('pc.admin_media_verification',jsonb_build_object(
  'scope','read-only QA function and authorization checks','checks',checks,'check_count',cardinality(checks),
  'selected_post_count',cardinality(ids),'manifest_rows',jsonb_array_length(manifest),'object_round_trips',objects_checked,
  'app_rows_written',0,'privileges_changed',0,'production_changes',0)::text,true);
end $verify$;
select current_setting('pc.admin_media_verification')::jsonb as verification;
rollback;
