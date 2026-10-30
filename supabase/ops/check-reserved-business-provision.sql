-- Read-only: no passwords, emails, tokens, reserved identity IDs or payloads.
select jsonb_build_object(
 'hash',md5(pg_get_functiondef(p.oid)),
 'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'searchPath',p.proconfig,
 'routeGuard',position('app_routes.is_reserved_username(username_value)' in pg_get_functiondef(p.oid))>0,
 'reservedPending',(select count(*) from admin_ops.provisions where kind='business' and completed_at is null
  and app_routes.is_reserved_username(snapshot->>'desired_username')),
 'reservations',(select count(*) from admin_ops.provisions),
 'authUsers',(select count(*) from auth.users),
 'profiles',(select count(*) from public.profiles)
) evidence from pg_proc p where p.oid='public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)'::regprocedure;
