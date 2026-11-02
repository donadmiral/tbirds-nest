select jsonb_build_object(
 'public_functions',(select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname not in ('issue_content_media_delivery','resolve_media_delivery')),
 'auth_functions',(select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' and p.prokind='f'),
 'storage_policies',(select coalesce(jsonb_agg(jsonb_build_object('name',polname,'relation',polrelid::regclass::text,'permissive',polpermissive,'roles',polroles,'command',polcmd,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polrelid,polname),'[]') from pg_policy where polrelid in ('storage.objects'::regclass,'storage.buckets'::regclass)),
 'bucket_visibility',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets)
) as preservation;
