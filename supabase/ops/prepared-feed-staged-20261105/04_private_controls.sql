begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin if obj_description('prepared_feed'::regnamespace,'pg_namespace') is distinct from 'prepared-feed:f6efa6982b921d1f8495b82868880d61f52ab15d9b856962329cdb8ac32af8dc:3' then raise exception 'PREPARED_FEED_STAGE_MISMATCH';end if;end$$;


create function prepared_feed.invalidate_viewer()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare row_data jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;actor uuid;other uuid;
begin
 actor:=coalesce(row_data->>'user_id',row_data->>'follower_id',row_data->>'blocker_id')::uuid;
 if tg_table_name='blocked_users' then other:=(row_data->>'blocked_id')::uuid;end if;
 update prepared_feed.demand set revision=revision+1,available_at=clock_timestamp(),failures=0 where viewer_id=actor or viewer_id=other;
 return null;
end$$;

create function prepared_feed.configure_prepared_feed_v1(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$begin
 if p_enabled is null then raise exception 'EXPLICIT_PREPARED_FEED_SETTING_REQUIRED';end if;
 update prepared_feed.settings set enabled=p_enabled where singleton;
end$$;
create function prepared_feed.prepared_feed_status_v1()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'max_ranked_rows',200,'fresh_seconds',60,'snapshot_seconds',300,
 'queued',(select count(*) from(select 1 from prepared_feed.demand where expires_at>now() limit 10001)q),
 'failed',(select count(*) from(select 1 from prepared_feed.demand where failures>=6 limit 10001)q),
 'oldest_due',(select available_at from prepared_feed.demand where expires_at>now() and failures<6 order by available_at limit 1))
 from prepared_feed.settings where singleton
$$;
create table prepared_feed.install_contract as select pg_get_function_result(p.oid) result_type,string_agg(case when name='sort_key' then 'chosen.key' else 'card.'||quote_ident(name)end,', ' order by ord)projection,md5(pg_get_functiondef(p.oid)) baseline from pg_proc p,unnest(p.proargnames,p.proargmodes)with ordinality a(name,mode,ord)where p.oid='public.get_feed(text,double precision,uuid,integer)'::regprocedure and mode='t' group by p.oid;
alter table prepared_feed.install_contract enable row level security;

revoke all on schema prepared_feed from public,anon,authenticated,service_role;
revoke all on all tables in schema prepared_feed from public,anon,authenticated,service_role;
revoke all on all functions in schema prepared_feed from public,anon,authenticated,service_role;
comment on schema prepared_feed is 'prepared-feed:f6efa6982b921d1f8495b82868880d61f52ab15d9b856962329cdb8ac32af8dc:4';
commit;
