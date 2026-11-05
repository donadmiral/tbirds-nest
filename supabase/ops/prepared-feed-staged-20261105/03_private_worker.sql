begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin if obj_description('prepared_feed'::regnamespace,'pg_namespace') is distinct from 'prepared-feed:f6efa6982b921d1f8495b82868880d61f52ab15d9b856962329cdb8ac32af8dc:2' then raise exception 'PREPARED_FEED_STAGE_MISMATCH';end if;end$$;


create function prepared_feed.drain_prepared_feed_v1(p_jobs integer default 1)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare job prepared_feed.demand;ranked jsonb;ids uuid[];keys double precision[];done integer:=0;failed integer:=0;now_at timestamptz;
begin
 if p_jobs is null or p_jobs<1 or p_jobs>4 then raise exception 'INVALID_PREPARED_FEED_BATCH';end if;
 delete from prepared_feed.snapshots where id in(select id from prepared_feed.snapshots where expires_at<=clock_timestamp() order by expires_at limit 500);
 delete from prepared_feed.demand where (viewer_id,scope,mode) in(select viewer_id,scope,mode from prepared_feed.demand where expires_at<=clock_timestamp() order by expires_at limit 500);
 if not prepared_feed.enabled() then return jsonb_build_object('prepared',0,'failed',0,'enabled',false);end if;
 for job in select * from prepared_feed.demand where available_at<=clock_timestamp() and expires_at>clock_timestamp()+interval '15 seconds' and failures<6
  order by available_at,viewer_id for update skip locked limit p_jobs loop
  begin
   if job.claims->>'sub' is distinct from job.viewer_id::text then raise exception 'PREPARED_FEED_IDENTITY_MISMATCH';end if;
   ranked:=prepared_feed.rank(job.claims,job.mode);
   select coalesce(array_agg((v->>'id')::uuid order by ord),'{}'),coalesce(array_agg((v->>'key')::double precision order by ord),'{}')
    into ids,keys from jsonb_array_elements(ranked) with ordinality e(v,ord);
   if cardinality(ids)<>(select count(distinct id) from unnest(ids)id) then raise exception 'PREPARED_FEED_DUPLICATE_IDS';end if;
   now_at:=clock_timestamp();
   -- Revision checked again when publishing. A delayed worker never publishes
   -- a result for a newer preference generation or expired request.
   insert into prepared_feed.snapshots(viewer_id,scope,mode,revision,ids,keys,fresh_until,expires_at)
    select job.viewer_id,job.scope,job.mode,job.revision,ids,keys,now_at+interval '60 seconds',least(job.expires_at,now_at+interval '5 minutes')
    where exists(select 1 from prepared_feed.demand d where (d.viewer_id,d.scope,d.mode,d.revision)=(job.viewer_id,job.scope,job.mode,job.revision) and d.expires_at>now_at+interval '60 seconds');
   update prepared_feed.demand set prepared_at=now_at,available_at=now_at+interval '45 seconds',failures=0
    where (viewer_id,scope,mode,revision)=(job.viewer_id,job.scope,job.mode,job.revision);
   delete from prepared_feed.snapshots where id in(select id from prepared_feed.snapshots s
    where (s.viewer_id,s.scope,s.mode)=(job.viewer_id,job.scope,job.mode) order by created_at desc,id desc offset 8);
   done:=done+1;
  exception when others then
   failed:=failed+1;
   update prepared_feed.demand set failures=least(failures+1,6),available_at=clock_timestamp()+make_interval(secs=>least(300,5*(2^failures)::integer))
    where (viewer_id,scope,mode)=(job.viewer_id,job.scope,job.mode);
  end;
 end loop;
 return jsonb_build_object('prepared',done,'failed',failed,'enabled',true);
end$$;
revoke all on function prepared_feed.drain_prepared_feed_v1(integer) from public,anon,authenticated,service_role;
comment on schema prepared_feed is 'prepared-feed:f6efa6982b921d1f8495b82868880d61f52ab15d9b856962329cdb8ac32af8dc:3';
commit;
