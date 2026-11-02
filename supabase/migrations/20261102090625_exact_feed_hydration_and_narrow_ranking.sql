begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Preserve the installed feed's exact audience predicates, score formula,
-- diversity penalty, cursor comparison and output contract. Copy its projection
-- before narrowing the ranking tuples so a card's body/media are fetched only
-- after the winning IDs have been selected. Unknown definitions fail closed.
do $migration$
declare
 source text; body text; hydration text; ranking text; result_type text;
 candidate_start integer; candidate_end integer; projection_start integer;
 columns text; definition text;
begin
 select replace(p.prosrc, E'\r', ''), pg_get_function_result(p.oid)
 into body,result_type from pg_proc p
 where p.oid='public.get_feed(text,double precision,uuid,integer)'::regprocedure;
 if position('candidates as (' in body)=0
   or position('from diversified d' in body)=0
   or position('row_number() over (partition by b.user_id order by b.raw_score desc)' in body)=0
   or position('where p.community_id is null' in body)=0
   or position('public.muted_authors' in body)=0 then
   raise exception 'FEED_RANKING_DEFINITION_REQUIRES_REVIEW';
 end if;

 -- A history read has no age/ranking window. The requesting user's current RLS,
 -- get_feed_visibility and the canonical feed's audience/market rules all apply.
 -- sort_key is deliberately the chronology key, never a replacement page cursor.
 hydration:=replace(body, 'where p.community_id is null',
   'where p.id = any(coalesce(p_ids,''{}''::uuid[]))
      and p.id in (select v.post_id from public.get_feed_visibility(p_ids) v)
      and p.community_id is null');
 hydration:=replace(hydration,'p_mode','''history''');
 hydration:=replace(hydration,'p_cursor_key','null::double precision');
 hydration:=replace(hydration,'p_cursor_id','null::uuid');
 hydration:=replace(hydration,'limit least(coalesce(p_limit, 20), 50)','limit 100');
 if hydration=body or position('p_limit' in hydration)>0 then
   raise exception 'FEED_HYDRATION_DEFINITION_REQUIRES_REVIEW';
 end if;
 definition:=format('create function public.get_feed_rows_by_ids_v1(p_ids uuid[])
 returns %s language plpgsql stable security invoker set search_path=public as $reader$
 #variable_conflict use_column
 begin
   if auth.uid() is null then raise exception ''Authentication required'' using errcode=''42501''; end if;
   if coalesce(cardinality(p_ids),0)>100 then raise exception ''At most 100 post IDs can be restored'' using errcode=''22023''; end if;
   return query %s
 end; $reader$;',result_type,hydration);
 execute definition;

 -- Keep the canonical visibility and ranking CTEs but carry only narrow rank
 -- inputs through their sort/window stages. In particular, large article bodies
 -- and profile/media data never spill into the global ranking sort.
 candidate_start:=position('  select p.id, p.user_id,' in body);
 candidate_end:=position('  from posts p' in substring(body from candidate_start))+candidate_start-1;
 projection_start:=position(E'\nselect d.id, d.user_id,' in body);
 if candidate_start=0 or candidate_end<candidate_start or projection_start=0 then
   raise exception 'FEED_RANKING_ANCHORS_REQUIRE_REVIEW';
 end if;
 ranking:=substring(body from 1 for candidate_start-1)
   ||'  select p.id, p.user_id, p.created_at, p.likes_count, p.comments_count,
       p.reposts_count, p.bookmarks_count, p.views_count'||E'\n'
   ||substring(body from candidate_end for projection_start-candidate_end);
 ranking:=replace(ranking,
   'select c.*, pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.account_type, pr.verified_tier,',
   'select c.*,');
 -- These flags never affect ranking. The bounded card reader computes them
 -- after LIMIT, avoiding three joins across every eligible post.
 ranking:=replace(ranking,E'    (lk.user_id is not null) as liked,\n','');
 ranking:=replace(ranking,E'    (bk.user_id is not null) as bookmarked,\n','');
 ranking:=replace(ranking,E'    (rp.user_id is not null) as reposted,\n','');
 ranking:=replace(ranking,E'  left join post_likes lk     on lk.post_id = c.id and lk.user_id = (select uid from viewer)\n','');
 ranking:=replace(ranking,E'  left join post_bookmarks bk on bk.post_id = c.id and bk.user_id = (select uid from viewer)\n','');
 ranking:=replace(ranking,E'  left join post_reposts rp   on rp.post_id = c.id and rp.user_id = (select uid from viewer)\n','');
 select string_agg(case when name='sort_key' then 'page.sort_key' else 'card.'||quote_ident(name) end,', ' order by ord)
 into columns from pg_proc p, unnest(p.proargnames,p.proargmodes) with ordinality a(name,mode,ord)
 where p.oid='public.get_feed(text,double precision,uuid,integer)'::regprocedure and mode='t';
 ranking:=ranking||', page as materialized (
   select d.id,d.sort_key from diversified d
   where p_cursor_key is null or (d.sort_key,d.id)<(p_cursor_key,p_cursor_id)
   order by d.sort_key desc,d.id desc limit least(coalesce(p_limit,20),50)
 ), cards as materialized (
   select * from public.get_feed_rows_by_ids_v1(array(select id from page))
 ) select '||columns||' from page join cards card on card.post_id=page.id
 order by page.sort_key desc,page.id desc;';
 execute format('create or replace function public.get_feed(
 p_mode text default ''for_you'',p_cursor_key double precision default null,
 p_cursor_id uuid default null,p_limit integer default 20)
 returns %s language sql stable security invoker set search_path=public as $rank$%s$rank$;',result_type,ranking);
end $migration$;
revoke all on function public.get_feed_rows_by_ids_v1(uuid[]) from public,anon;
grant execute on function public.get_feed_rows_by_ids_v1(uuid[]) to authenticated;

-- The access filters and personal affinity remain exact; these composite keys
-- keep their lookups proportional to the viewer's own rows.
create index if not exists post_likes_viewer_recent_idx
 on public.post_likes(user_id,created_at desc,post_id);
create index if not exists posts_home_rank_inputs_idx
 on public.posts(created_at desc,id) include(user_id,likes_count,comments_count,reposts_count)
 where community_id is null;
create index if not exists posts_innovation_rank_inputs_idx
 on public.posts(created_at desc,id) include(user_id,likes_count,comments_count,reposts_count)
 where community_id is null and channel='innovation';
notify pgrst,'reload schema';
commit;
