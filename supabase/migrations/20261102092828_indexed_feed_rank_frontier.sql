begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.posts in share row exclusive mode nowait;
create schema feed_ranking;
revoke all on schema feed_ranking from public,anon,service_role;
grant usage on schema feed_ranking to authenticated;
create table feed_ranking.settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into feed_ranking.settings(singleton) values(true);
create table feed_ranking.days(bucket date primary key);
create table feed_ranking.catalog(
 post_id uuid primary key references public.posts(id) on delete cascade,user_id uuid not null,
 created_at timestamptz not null,bucket date not null,channel text,
 mass numeric not null check(mass>=1)
);
create index feed_catalog_mass on feed_ranking.catalog(bucket,mass desc,post_id desc);
create index feed_catalog_time on feed_ranking.catalog(bucket,created_at desc,post_id desc);
create index feed_catalog_future on feed_ranking.catalog(created_at desc);
create index feed_catalog_innovation_mass on feed_ranking.catalog(bucket,mass desc,post_id desc) where channel='innovation';
create index feed_catalog_innovation_time on feed_ranking.catalog(bucket,created_at desc,post_id desc) where channel='innovation';
alter table feed_ranking.settings enable row level security;
alter table feed_ranking.days enable row level security;
alter table feed_ranking.catalog enable row level security;
create policy feed_catalog_visible on feed_ranking.catalog for select to authenticated
 using(exists(select 1 from public.get_feed_visibility(array[post_id])v));
create policy feed_days_read on feed_ranking.days for select to authenticated using(true);
grant select on feed_ranking.catalog,feed_ranking.days to authenticated;
revoke all on feed_ranking.settings from public,anon,authenticated,service_role;

insert into feed_ranking.catalog(post_id,user_id,created_at,bucket,channel,mass)
 select id,user_id,created_at,(created_at at time zone 'UTC')::date,channel,
   coalesce(likes_count,0)*1.0+coalesce(comments_count,0)*2.5+coalesce(reposts_count,0)*2.0+1.0
 from public.posts where community_id is null;
insert into feed_ranking.days select distinct bucket from feed_ranking.catalog;
create function feed_ranking.post_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.user_id,new.created_at,new.channel,new.community_id,new.likes_count,new.comments_count,new.reposts_count)
   is not distinct from (old.user_id,old.created_at,old.channel,old.community_id,old.likes_count,old.comments_count,old.reposts_count) then return null;end if;
 if new.community_id is not null then delete from feed_ranking.catalog where post_id=new.id;return null;end if;
 insert into feed_ranking.catalog(post_id,user_id,created_at,bucket,channel,mass)
 values(new.id,new.user_id,new.created_at,(new.created_at at time zone 'UTC')::date,new.channel,
   coalesce(new.likes_count,0)*1.0+coalesce(new.comments_count,0)*2.5+coalesce(new.reposts_count,0)*2.0+1.0)
 on conflict(post_id) do update set user_id=excluded.user_id,created_at=excluded.created_at,bucket=excluded.bucket,channel=excluded.channel,mass=excluded.mass;
 insert into feed_ranking.days(bucket) values((new.created_at at time zone 'UTC')::date) on conflict do nothing;
 return null;
end $$;
create trigger feed_rank_catalog after insert or update on public.posts for each row execute function feed_ranking.post_changed();

-- Reuse the installed canonical rank expression rather than restating weights,
-- visibility or diversity. The helper evaluates ONLY supplied candidate IDs.
do $$declare body text;stop integer;
begin
 select prosrc into body from pg_proc where oid='public.get_feed(text,double precision,uuid,integer)'::regprocedure;
 stop:=position(', page as materialized (' in body);
 if stop=0 or position('where p.community_id is null' in body)=0 then raise exception 'INDEXED_FEED_REQUIRES_NARROW_RANKING';end if;
 body:=substring(body from 1 for stop-1);
 body:=replace(body,'where p.community_id is null','where p.id=any(p_ids) and p.community_id is null');
 body:=body||' select d.id,d.user_id,d.raw_score,d.sort_key,
   count(*) over(partition by d.user_id,d.raw_score)>1 from diversified d';
 execute format('create function feed_ranking.score(p_ids uuid[],p_mode text)
 returns table(id uuid,author_id uuid,raw_score numeric,sort_key double precision,tied boolean)
 language sql stable security invoker set search_path=public as $rank$%s$rank$',body);
end $$;

-- Threshold search over two indexes per UTC day. An unvisited post is below
-- BOTH the remaining mass frontier and the remaining creation-time frontier.
-- Therefore its raw score is at most mass/(age+2)^1.5 * viewer_max_boost.
-- Seen and author-diversity multipliers can only reduce that score. We stop only
-- when every unseen upper bound is strictly below the page's final score.
-- No age approximation, guessed candidate cap, or popularity cutoff is used.
-- If a proof requires more than 10,000 candidates, use the original exact query.
create function feed_ranking.select_page(p_mode text,p_cursor_key double precision,p_cursor_id uuid,p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 days date[]:='{}';masses numeric[]:='{}';times timestamptz[]:='{}';bounds double precision[]:='{}';
 mass_cursors numeric[]:='{}';mass_ids uuid[]:='{}';time_cursors timestamptz[]:='{}';time_ids uuid[]:='{}';
 candidates uuid[]:='{}';selected uuid[];keys double precision[];batch_ids uuid[];batch_masses numeric[];batch_times timestamptz[];
 entry record;i integer;chosen integer;best double precision;threshold double precision;factor numeric;affinity_max integer;
 n integer;has_tie boolean;minimum_time timestamptz;exhausted boolean;maximum_candidates constant integer:=10000;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_mode not in('for_you','innovation') or p_mode is null or p_limit is null or p_limit<1 or p_limit>50 then
   return jsonb_build_object('fallback',true,'candidates',0,'reason','mode');end if;
 minimum_time:=case when p_mode='for_you' then now()-interval '365 days' else '-infinity'::timestamptz end;
 -- Future timestamps retain the original expression's behavior, including its
 -- error for an invalid negative power base. Never silently clamp that formula.
 if exists(select 1 from feed_ranking.catalog where created_at>now() limit 1) then
   return jsonb_build_object('fallback',true,'candidates',0,'reason','future_timestamp');end if;
 select coalesce(max(a.n),0) into affinity_max from(
   select p.user_id,count(*) n from public.post_likes l join public.posts p on p.id=l.post_id
   where l.user_id=(select auth.uid()) and l.created_at>now()-interval '30 days' group by p.user_id
 )a;
 factor:=(case when exists(select 1 from public.follows where follower_id=(select auth.uid())) then 3.0 else 1.0 end)
   *(1.0+least(affinity_max,5)*0.15);
 for entry in
   select d.bucket,m.mass,t.created_at from feed_ranking.days d
   cross join lateral(select c.mass from feed_ranking.catalog c where c.bucket=d.bucket
     and c.created_at>minimum_time and (p_mode<>'innovation' or c.channel='innovation')
     order by c.mass desc,c.post_id desc limit 1)m
   cross join lateral(select c.created_at from feed_ranking.catalog c where c.bucket=d.bucket
     and c.created_at>minimum_time and (p_mode<>'innovation' or c.channel='innovation')
     order by c.created_at desc,c.post_id desc limit 1)t
   where p_mode<>'for_you' or d.bucket>=(minimum_time at time zone 'UTC')::date
   order by d.bucket desc
 loop
   days:=array_append(days,entry.bucket);masses:=array_append(masses,entry.mass);times:=array_append(times,entry.created_at);
   bounds:=array_append(bounds,(entry.mass/power(extract(epoch from(now()-entry.created_at))/3600.0+2.0,1.5)*factor)::double precision*(1.0+1e-12));
   mass_cursors:=array_append(mass_cursors,null);mass_ids:=array_append(mass_ids,null);
   time_cursors:=array_append(time_cursors,null);time_ids:=array_append(time_ids,null);
 end loop;
 if cardinality(days)=0 then return jsonb_build_object('fallback',false,'ids','[]'::jsonb,'keys','[]'::jsonb,'candidates',0);end if;
 loop
   best:=-1;chosen:=null;
   for i in 1..cardinality(days) loop if bounds[i]>best then best:=bounds[i];chosen:=i;end if;end loop;
   if best<0 then exit;end if;
   select array_agg(c.post_id order by c.mass desc,c.post_id desc),array_agg(c.mass order by c.mass desc,c.post_id desc)
   into batch_ids,batch_masses from(
     select c.post_id,c.mass from feed_ranking.catalog c where c.bucket=days[chosen]
       and c.created_at>minimum_time and (p_mode<>'innovation' or c.channel='innovation')
       and (mass_cursors[chosen] is null or (c.mass,c.post_id)<(mass_cursors[chosen],mass_ids[chosen]))
     order by c.mass desc,c.post_id desc limit 64
   )c;
   n:=coalesce(cardinality(batch_ids),0);exhausted:=n<64;
   if n>0 then
     candidates:=candidates||batch_ids;mass_cursors[chosen]:=batch_masses[n];mass_ids[chosen]:=batch_ids[n];masses[chosen]:=batch_masses[n];
   end if;
   if not exhausted then
     select array_agg(c.post_id order by c.created_at desc,c.post_id desc),array_agg(c.created_at order by c.created_at desc,c.post_id desc)
     into batch_ids,batch_times from(
       select c.post_id,c.created_at from feed_ranking.catalog c where c.bucket=days[chosen]
         and c.created_at>minimum_time and (p_mode<>'innovation' or c.channel='innovation')
         and (time_cursors[chosen] is null or (c.created_at,c.post_id)<(time_cursors[chosen],time_ids[chosen]))
       order by c.created_at desc,c.post_id desc limit 64
     )c;
     n:=coalesce(cardinality(batch_ids),0);exhausted:=n<64;
     if n>0 then
       candidates:=candidates||batch_ids;time_cursors[chosen]:=batch_times[n];time_ids[chosen]:=batch_ids[n];times[chosen]:=batch_times[n];
     end if;
   end if;
   select array_agg(distinct v order by v) into candidates from unnest(candidates)v;
   if cardinality(candidates)>maximum_candidates then
     return jsonb_build_object('fallback',true,'candidates',cardinality(candidates),'reason','proof_budget');end if;
   bounds[chosen]:=case when exhausted then -1 else
     (masses[chosen]/power(extract(epoch from(now()-times[chosen]))/3600.0+2.0,1.5)*factor)::double precision*(1.0+1e-12) end;
   with scored as materialized(select * from feed_ranking.score(candidates,p_mode)),page as(
     select * from scored where p_cursor_key is null or (sort_key,id)<(p_cursor_key,p_cursor_id)
     order by sort_key desc,id desc limit p_limit
   )select array_agg(id order by sort_key desc,id desc),array_agg(sort_key order by sort_key desc,id desc),
     coalesce((select bool_or(tied) from scored),false) into selected,keys,has_tie from page;
   -- The legacy query has no tie breaker inside its author window. Keep that
   -- exact plan for equal raw scores rather than introducing a new tie policy.
   if has_tie then return jsonb_build_object('fallback',true,'candidates',cardinality(candidates),'reason','legacy_tie');end if;
   select max(b) into best from unnest(bounds)b;
   threshold:=keys[cardinality(keys)];
   if best<0 or (cardinality(selected)>=p_limit and best<threshold) then
     return jsonb_build_object('fallback',false,'ids',to_jsonb(coalesce(selected,'{}'::uuid[])),
       'keys',to_jsonb(coalesce(keys,'{}'::double precision[])),'candidates',cardinality(candidates),'days',cardinality(days));
   end if;
 end loop;
 return jsonb_build_object('fallback',true,'candidates',coalesce(cardinality(candidates),0),'reason','unproven');
end $$;
create function feed_ranking.enabled()
returns boolean language sql stable security definer set search_path='' as $$select enabled from feed_ranking.settings where singleton$$;

do $$declare result_type text;columns text;
begin
 select pg_get_function_result(p.oid),string_agg(case when name='sort_key' then 'ordered.key' else 'card.'||quote_ident(name) end,', ' order by ord)
 into result_type,columns from pg_proc p,unnest(p.proargnames,p.proargmodes) with ordinality a(name,mode,ord)
 where p.oid='public.get_feed(text,double precision,uuid,integer)'::regprocedure and mode='t' group by p.oid;
 alter function public.get_feed(text,double precision,uuid,integer) set schema feed_ranking;
 alter function feed_ranking.get_feed(text,double precision,uuid,integer) rename to fallback;
 execute format('create function public.get_feed(p_mode text default ''for_you'',p_cursor_key double precision default null,
   p_cursor_id uuid default null,p_limit integer default 20) returns %s language plpgsql stable security invoker set search_path='''' as $feed$
   declare page jsonb;ids uuid[];keys double precision[];
   begin
     if not feed_ranking.enabled() then
       return query select * from feed_ranking.fallback(p_mode,p_cursor_key,p_cursor_id,p_limit);return;
     end if;
     page:=feed_ranking.select_page(p_mode,p_cursor_key,p_cursor_id,least(coalesce(p_limit,20),50));
     if (page->>''fallback'')::boolean then
       return query select * from feed_ranking.fallback(p_mode,p_cursor_key,p_cursor_id,p_limit);return;
     end if;
     select array_agg(value::uuid) into ids from jsonb_array_elements_text(page->''ids'');
     select array_agg(value::double precision) into keys from jsonb_array_elements_text(page->''keys'');
     return query select %s from unnest(ids,keys)with ordinality ordered(id,key,ord)
       join public.get_feed_rows_by_ids_v1(ids)card on card.post_id=ordered.id order by ordered.ord;
   end $feed$;',result_type,columns);
end $$;
create function public.configure_indexed_feed_v1(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_enabled is null then raise exception 'INVALID_FEED_CONFIGURATION';end if;
 update feed_ranking.settings set enabled=p_enabled where singleton;
end $$;
create function public.feed_ranking_status_v1()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'enabled',enabled,'exact',true,'max_candidates_before_fallback',10000,
   'index_batch',64,'fallback_preserves_ranking',true) from feed_ranking.settings where singleton;
$$;
revoke all on all functions in schema feed_ranking from public,anon,authenticated,service_role;
grant execute on function feed_ranking.score(uuid[],text),feed_ranking.select_page(text,double precision,uuid,integer),
 feed_ranking.enabled(),feed_ranking.fallback(text,double precision,uuid,integer) to authenticated;
revoke all on function public.get_feed(text,double precision,uuid,integer) from public,anon;
grant execute on function public.get_feed(text,double precision,uuid,integer) to authenticated;
revoke all on function public.configure_indexed_feed_v1(boolean),public.feed_ranking_status_v1() from public,anon,authenticated;
grant execute on function public.configure_indexed_feed_v1(boolean),public.feed_ranking_status_v1() to service_role;
notify pgrst,'reload schema';
commit;
