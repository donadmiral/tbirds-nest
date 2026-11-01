-- Requires pg_cron, pg_net, the one-use dispatch migration, verified exact Edge
-- source configuration, and reviewed readiness activation. No secret is stored
-- in this command; each execution creates one expiring, single-use capability.
begin;
do $$ declare existing record; expected text:='select music_library.enqueue_maintenance_run();'; begin
 if current_user<>'postgres' then raise exception 'MUSIC_DISPATCH_POSTGRES_REQUIRED';end if;
 if to_regprocedure('music_library.enqueue_maintenance_run()') is null then raise exception 'MUSIC_ONE_USE_DISPATCH_REQUIRED';end if;
 if not exists(select 1 from music_library.maintenance_worker w join music_library.maintenance_dispatch d using(singleton)
  where w.enabled and w.secret_digest is null and d.project_origin is not null and d.worker_sha256 is not null and d.verified_at is not null)then
  raise exception 'MUSIC_VERIFIED_DISPATCH_READINESS_REQUIRED';
 end if;
 select * into existing from cron.job where jobname='platinum-music-maintenance';
 if found and(existing.command<>expected or existing.username<>'postgres' or existing.database<>current_database())then
  raise exception 'MUSIC_EXISTING_CRON_REVIEW_REQUIRED';
 end if;
 perform cron.schedule('platinum-music-maintenance','*/5 * * * *',expected);
end $$;
commit;
