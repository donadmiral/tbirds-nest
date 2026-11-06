-- Reuse the original restricted execution owner and claim restoration.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function prepared_feed.rank(p_claims jsonb,p_mode text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare previous_claims text:=current_setting('request.jwt.claims',true);previous_sub text:=current_setting('request.jwt.claim.sub',true);
 rows jsonb:='[]';page jsonb;
begin
 if p_claims->>'role' is distinct from 'authenticated' or coalesce(p_claims->>'exp','')!~'^[0-9]{1,12}$'
  or to_timestamp((p_claims->>'exp')::double precision)<=clock_timestamp() then raise exception 'PREPARED_FEED_SESSION_EXPIRED';end if;
 perform set_config('request.jwt.claims',p_claims::text,true);
 perform set_config('request.jwt.claim.sub',p_claims->>'sub',true);
 if auth.uid() is null then raise exception 'PREPARED_FEED_IDENTITY_REQUIRED';end if;
 if feed_ranking.enabled() and p_mode in('for_you','innovation') then
  page:=prepared_feed.select_page(p_mode,null,null,200);
 end if;
 if page is not null and not (page->>'fallback')::boolean then
  select coalesce(jsonb_agg(jsonb_build_object('id',i.value::uuid,'key',k.value::double precision)order by i.ord),'[]'::jsonb)
  into rows from jsonb_array_elements_text(page->'ids')with ordinality i(value,ord)
  join jsonb_array_elements_text(page->'keys')with ordinality k(value,ord) using(ord);
 else
  rows:=prepared_feed.exact_ids(p_mode);
 end if;
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 return rows;
exception when others then
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 raise;
end$$;
commit;
