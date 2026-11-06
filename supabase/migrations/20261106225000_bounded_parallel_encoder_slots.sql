-- The deployed dispatcher reconciles at most two provider sessions per tick.
-- Keep the original budget lock, up-front charges and ambiguous-launch fences.
set local lock_timeout='2s';
set local statement_timeout='10s';
alter table media_renditions.sandbox_settings add column max_parallel_runs smallint
 not null default 1 check(max_parallel_runs between 1 and 2);

do $migration$
declare def text; anchor text; replacement text;
begin
 if (select md5(prosrc) from pg_proc where oid='public.reserve_media_sandbox_v1(uuid,text)'::regprocedure)
     is distinct from 'd6e1a7f7a9555e4ce3f477d56f809c45'
 or (select md5(prosrc) from pg_proc where oid='public.media_sandbox_status_v1()'::regprocedure)
     is distinct from '8d45b5349e361810421d2e4100a1d807'
 or (select md5(prosrc) from pg_proc where oid='public.pending_media_sandboxes_v1()'::regprocedure)
     is distinct from '206a0fc97e363aabdc38dc8b8b432d04'
 then raise exception 'ENCODER_RESERVATION_BASELINE_CHANGED'; end if;
 def:=pg_get_functiondef('public.reserve_media_sandbox_v1(uuid,text)'::regprocedure);
 anchor:=$a$if exists(select 1 from media_renditions.sandbox_runs where state in('reserved','running')) then return null;end if;$a$;
 replacement:=$b$
 if (select count(*) from media_renditions.sandbox_runs where state in('reserved','running')) >=
    least(cfg.max_parallel_runs,(select concurrency from media_renditions.settings where singleton)) then return null;end if;
 -- One job cannot spend two reservations while the first VM is starting.
 -- A second slot needs two eligible jobs (including any job currently leased).
 -- Cleanup alone never launches a second VM.
 if exists(select from media_renditions.sandbox_runs where state in('reserved','running'))
    and (not exists(select from media_renditions.jobs j join media_renditions.settings s on s.singleton
     where s.worker_enabled and j.source_bytes<=s.input_max_bytes and
     ((j.state in('pending','retry') and j.available_at<=at_time) or (j.state='processing' and j.lease_until<=at_time)))
     or not exists(select from media_renditions.jobs j join media_renditions.settings s on s.singleton
     where s.worker_enabled and j.source_bytes<=s.input_max_bytes
     and ((j.state in('pending','retry') and j.available_at<=at_time) or j.state='processing')
     offset 1 limit 1)) then return null;end if;
$b$;
 if strpos(def,anchor)=0 then raise exception 'ENCODER_RESERVATION_GUARD_MISSING';end if;
 execute replace(def,anchor,replacement);
 def:=pg_get_functiondef('public.media_sandbox_status_v1()'::regprocedure);
 anchor:='''max_concurrency'',1';replacement:='''max_concurrency'',least(c.max_parallel_runs,(select concurrency from media_renditions.settings where singleton))';
 if strpos(def,anchor)=0 then raise exception 'ENCODER_STATUS_GUARD_MISSING';end if;
 execute replace(def,anchor,replacement);
end $migration$;
