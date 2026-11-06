-- Empty history capability checks need only the existing authentication and
-- size checks. Do not plan the card, visibility, profile or media query for no IDs.
-- The exact hosted body is required. All nonempty behavior and metadata remain.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $migration$
declare
 original pg_proc%rowtype;
 updated pg_proc%rowtype;
 body text;
 definition text;
 marker constant text := E'   return query \n';
 fast_return constant text := E'   if coalesce(cardinality(p_ids),0)=0 then return; end if;\n';
begin
 select * into strict original from pg_proc
 where oid='public.get_feed_rows_by_ids_v1(uuid[])'::regprocedure;
 if md5(original.prosrc)<>'45186117b2564f3321ba6cd2a718e9b0'
   or original.prosecdef or original.proisstrict or original.provolatile<>'s'
   or original.proconfig is distinct from array['search_path=public']::text[] then
   raise exception 'FEED_RESTORE_EMPTY_BASELINE_REQUIRED';
 end if;
 if position(marker in original.prosrc)=0 then
   raise exception 'FEED_RESTORE_EMPTY_ANCHOR_REQUIRED';
 end if;
 body:=replace(original.prosrc,marker,fast_return||marker);
 definition:=pg_get_functiondef(original.oid);
 execute replace(definition,original.prosrc,body);

 -- CREATE OR REPLACE retains identity, owner and ACL. The captured definition
 -- retains attributes, arguments, result and search_path. Assert all of them.
 select * into strict updated from pg_proc where oid=original.oid;
 if updated.prosrc is distinct from body
   or (to_jsonb(updated)-'prosrc') is distinct from (to_jsonb(original)-'prosrc') then
   raise exception 'FEED_RESTORE_EMPTY_METADATA_CHANGED';
 end if;
end $migration$;
notify pgrst,'reload schema';
commit;
