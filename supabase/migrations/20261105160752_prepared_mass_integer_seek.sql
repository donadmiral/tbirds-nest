-- Preserve the canonical numeric score while giving the private worker an
-- exact, leakproof integer cursor. Numeric comparisons remain above the RLS
-- barrier and repeatedly check visibility for already visited catalog rows.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$
declare f pg_proc%rowtype;
begin
 select * into f from pg_proc where oid='prepared_feed.select_page(text,double precision,uuid,integer)'::regprocedure;
 if md5(f.prosrc)<>'b563cb26f012861f068f7b2294bd0342' or f.prosecdef or f.provolatile<>'s'
   or f.prolang<>(select oid from pg_language where lanname='plpgsql')
   or f.proconfig is distinct from array['search_path=""']::text[]
   or not has_function_privilege('prepared_feed_reader',f.oid,'execute')
   or has_function_privilege('authenticated',f.oid,'execute')
   or has_function_privilege('anon',f.oid,'execute')
   or has_function_privilege('service_role',f.oid,'execute')
   or not (select relrowsecurity from pg_class where oid='feed_ranking.catalog'::regclass)
   or exists(select 1 from pg_attribute where attrelid='feed_ranking.catalog'::regclass and attname='mass_units' and not attisdropped)
 then raise exception 'PREPARED_MASS_SEEK_BASELINE_REQUIRED';end if;
end $guard$;

-- The existing writer uses integer counters and coefficients 1, 2.5 and 2.
-- The constraint makes exact order equivalence mandatory for every writer,
-- including future direct writes. Invalid fractions/overflow cannot round.
alter table feed_ranking.catalog
 add column mass_units bigint generated always as ((mass*2)::bigint) stored,
 add constraint feed_catalog_mass_units_exact check(mass*2=mass_units::numeric);
create index feed_catalog_mass_units on feed_ranking.catalog(bucket,mass_units desc,post_id desc);
create index feed_catalog_innovation_mass_units on feed_ranking.catalog(bucket,mass_units desc,post_id desc) where channel='innovation';

do $seek$
declare f pg_proc%rowtype;after_f pg_proc%rowtype;body text;first_page text;next_page text;definition text;
 block constant text:='   select array_agg(c.post_id order by c.mass desc,c.post_id desc),array_agg(c.mass order by c.mass desc,c.post_id desc)
   into batch_ids,batch_masses from(
     select c.post_id,c.mass from feed_ranking.catalog c where c.bucket=days[chosen]
       and c.created_at>minimum_time and (p_mode<>''innovation'' or c.channel=''innovation'')
       and (mass_cursors[chosen] is null or (c.mass,c.post_id)<(mass_cursors[chosen],mass_ids[chosen]))
     order by c.mass desc,c.post_id desc limit 64
   )c;';
 predicate constant text:='       and (mass_cursors[chosen] is null or (c.mass,c.post_id)<(mass_cursors[chosen],mass_ids[chosen]))';
begin
 select * into f from pg_proc where oid='prepared_feed.select_page(text,double precision,uuid,integer)'::regprocedure;
 if (length(f.prosrc)-length(replace(f.prosrc,block,'')))/length(block)<>1 then
  raise exception 'PREPARED_MASS_SEEK_ANCHOR_REQUIRED';end if;
 first_page:=replace(block,predicate,E'');
 next_page:=replace(block,predicate,'       and (c.mass_units,c.post_id)<((mass_cursors[chosen]*2)::bigint,mass_ids[chosen])');
 first_page:=replace(first_page,'order by c.mass desc,c.post_id desc limit 64','order by c.mass_units desc,c.post_id desc limit 64');
 next_page:=replace(next_page,'order by c.mass desc,c.post_id desc limit 64','order by c.mass_units desc,c.post_id desc limit 64');
 body:=replace(f.prosrc,block,'   if mass_cursors[chosen] is null then'||E'\n'||first_page||E'\n   else\n'||next_page||E'\n   end if;');
 definition:=pg_get_functiondef(f.oid);
 execute replace(definition,f.prosrc,body);
 select * into after_f from pg_proc where oid=f.oid;
 if after_f.proowner<>f.proowner or after_f.proacl is distinct from f.proacl
   or after_f.prosecdef<>f.prosecdef or after_f.provolatile<>f.provolatile
   or after_f.proconfig is distinct from f.proconfig then raise exception 'PREPARED_MASS_SEEK_AUTHORITY_CHANGED';end if;
end $seek$;
notify pgrst,'reload schema';
commit;
