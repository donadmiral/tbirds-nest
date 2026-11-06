-- Uses disposable jobs in a rolled-back subtransaction. No provider launch occurs.
begin;
set local lock_timeout='2s';set local statement_timeout='12s';create temp table slot_probe(receipt jsonb) on commit drop;
do $test$ declare run1 uuid:=gen_random_uuid();run2 uuid:=gen_random_uuid();owner uuid:=gen_random_uuid(); j uuid; res jsonb; seeninteger integer; used_before integer; used_after integer;
begin begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 if exists(select from media_renditions.sandbox_runs where state in('reserved','running')) or exists(select from media_renditions.jobs where state in('pending','retry','processing')) then raise exception 'WORKER_NOT_IDLE';end if;
 update media_renditions.sandbox_settings set enabled=true,max_parallel_runs=2 where singleton;
 update media_renditions.settings set worker_enabled=true,concurrency=2 where singleton;
 select coalesce((select creations from media_renditions.sandbox_usage where period='day' and starts_on=(now() at time zone 'UTC')::date),0) into used_before;
 for seeninteger in 1..2 loop
  j:=gen_random_uuid();
  insert into media_renditions.jobs(source_id,source_version,source_bucket,source_path,source_owner,source_bytes,source_etag,source_mime)
  values(j,'probe','post-media',owner::text||'/'||j||'.mp4',owner,16384,'fixture','video/mp4');
  res:=public.reserve_media_sandbox_v1(case when seeninteger=1 then run1 else run2 end,repeat('a',64));
  if res is null then raise exception 'LEASE_EXPECTED';end if;
  if seeninteger=1 and public.reserve_media_sandbox_v1(gen_random_uuid(),repeat('a',64)) is not null then raise exception 'DUPLICATE_FOR_ONE';end if;
 end loop;
 if public.reserve_media_sandbox_v1(gen_random_uuid(),repeat('a',64)) is not null then raise exception 'THIRD_VM_ALLOWED';end if;
 if jsonb_array_length(public.pending_media_sandboxes_v1())<>2 then raise exception 'REAPER_CANNOT_SEE_BOTH';end if;
 select creations into strict used_after from media_renditions.sandbox_usage where period='day' and starts_on=(now() at time zone 'UTC')::date;
 if used_after-used_before<>2 then raise exception 'BUDGET_MISMATCH';end if;
 raise sqlstate 'ZQ001' using message='rollback fixture';
 exception when sqlstate 'ZQ001' then null;end;
 if exists(select from media_renditions.sandbox_runs where id in(run1,run2)) or exists(select from media_renditions.jobs where source_owner=owner) then raise exception 'TEST_DATA_RETAINED';end if;
 insert into pg_temp.slot_probe values(jsonb_build_object('two_independent_leases',true,'one_job_cannot_spend_two_starts',true,'third_slot_refused',true,'charged_fixture_starts',used_after-used_before,'rolled_back',true));
end $test$;select receipt from pg_temp.slot_probe;
commit;
