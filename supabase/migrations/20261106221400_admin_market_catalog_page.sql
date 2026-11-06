set local lock_timeout='2s';
set local statement_timeout='10s';
create index if not exists marketplace_admin_listing_cursor on public.marketplace_listings(created_at desc,id desc);
create index if not exists listing_reports_latest_for_listing on public.listing_reports(listing_id,created_at desc,id desc);

create function public.admin_market_catalog_page_v1(p_before timestamptz default null,p_id uuid default null,p_search text default '')
returns setof jsonb language plpgsql stable security invoker set search_path='' set plan_cache_mode=force_custom_plan as $$
declare term text:=btrim(coalesce(p_search,'')); pattern text; lookup uuid;
begin
 if (p_before is null) <> (p_id is null) or (term<>'' and length(term) not between 3 and 100) then
   raise exception 'INVALID_MARKET_CATALOG_QUERY' using errcode='22023';
 end if;
 if term ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then lookup:=term::uuid; end if;
 pattern := '%' || replace(replace(replace(term,'!','!!'),'%','!%'),'_','!_') || '%';
 return query
 with page as materialized (
   select l.* from public.marketplace_listings l
   where (p_before is null or (l.created_at,l.id)<(p_before,p_id))
     and (term='' or (lookup is not null and l.id=lookup) or (lookup is null and l.title ilike pattern escape '!'))
   order by l.created_at desc,l.id desc limit 101
 )
 select (to_jsonb(p)-'search_tsv') || jsonb_build_object('_report_summary',
   jsonb_build_object('total',s.total,'open',s.open_count,'reasons',array(
     select left(r.reason,250) from public.listing_reports r where r.listing_id=p.id
     order by r.created_at desc,r.id desc limit 3)))
 from page p cross join lateral (
   select count(*) as total,count(*) filter(where r.status='open') as open_count
   from public.listing_reports r where r.listing_id=p.id
 ) s order by p.created_at desc,p.id desc;
end $$;
revoke all on function public.admin_market_catalog_page_v1(timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_market_catalog_page_v1(timestamptz,uuid,text) to service_role;
