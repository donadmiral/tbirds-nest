begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin if obj_description('prepared_feed'::regnamespace,'pg_namespace') is distinct from 'prepared-feed:f6efa6982b921d1f8495b82868880d61f52ab15d9b856962329cdb8ac32af8dc:1' then raise exception 'PREPARED_FEED_STAGE_MISMATCH';end if;end$$;


-- Rank work executes with authenticated privileges, never service-role RLS
-- bypass. This function is private and callable only by the owning dispatcher.
create function prepared_feed.rank(p_claims jsonb,p_mode text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare previous_claims text:=current_setting('request.jwt.claims',true);previous_sub text:=current_setting('request.jwt.claim.sub',true);
 rows jsonb:='[]';batch jsonb;cursor_key double precision;cursor_id uuid;count_rows integer;
begin
 if p_claims->>'role' is distinct from 'authenticated' or coalesce(p_claims->>'exp','')!~'^[0-9]{1,12}$'
  or to_timestamp((p_claims->>'exp')::double precision)<=clock_timestamp() then raise exception 'PREPARED_FEED_SESSION_EXPIRED';end if;
 perform set_config('request.jwt.claims',p_claims::text,true);
 perform set_config('request.jwt.claim.sub',p_claims->>'sub',true);
 if auth.uid() is null then raise exception 'PREPARED_FEED_IDENTITY_REQUIRED';end if;
 for page in 1..4 loop
  select coalesce(jsonb_agg(jsonb_build_object('id',r.post_id,'key',r.sort_key) order by r.sort_key desc,r.post_id desc),'[]') into batch
   from prepared_feed.canonical(p_mode,cursor_key,cursor_id,50)r;
  count_rows:=jsonb_array_length(batch);rows:=rows||batch;
  exit when count_rows<50;
  cursor_key:=(batch->(count_rows-1)->>'key')::double precision;cursor_id:=(batch->(count_rows-1)->>'id')::uuid;
 end loop;
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 return rows;
exception when others then
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 raise;
end$$;
grant create on schema prepared_feed to prepared_feed_reader;
alter function prepared_feed.rank(jsonb,text) owner to prepared_feed_reader;
revoke create on schema prepared_feed from prepared_feed_reader;
revoke all on schema prepared_feed from public,anon,authenticated,service_role;
revoke all on all tables in schema prepared_feed from public,anon,authenticated,service_role;
revoke all on all functions in schema prepared_feed from public,anon,authenticated,service_role;
comment on schema prepared_feed is 'prepared-feed:f6efa6982b921d1f8495b82868880d61f52ab15d9b856962329cdb8ac32af8dc:2';
commit;
