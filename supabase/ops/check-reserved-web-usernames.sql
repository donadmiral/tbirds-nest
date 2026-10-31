-- Read-only, safe before or after the route reservation migration.
with routes(name) as (select unnest(array[
 'about','account-deletion','ads','album','archive','business-login','businesses','calls','channels','communities','discover','explore',
 'forgot-password','home','jobs','login','market','messages','monetization','music','notifications','post','privacy','reset-password',
 'saved','search','settings','signup','story','studio','terms','topic','watch','write']))
select jsonb_build_object(
 'collisions',(select jsonb_object_agg(name,(select count(*) from public.profiles where lower(btrim(username))=routes.name)) from routes),
 'availability',(select jsonb_object_agg(name,public.is_username_available(name)) from routes),
 'profiles',(select count(*) from public.profiles),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'hash',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'search_path',p.proconfig,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'app_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by p.oid::regprocedure::text)
  from pg_proc p where p.oid=to_regprocedure('public.is_username_available(text)') or p.pronamespace=to_regnamespace('app_routes')),
 'trigger',(select jsonb_build_object('enabled',tgenabled,'definition',pg_get_triggerdef(oid)) from pg_trigger
  where tgrelid='public.profiles'::regclass and tgname='guard_reserved_web_username')
) evidence;
