-- 0078 server-authoritative call expiry (calls standard section 9).
-- Every session carries its own death time; the sweep enforces it, so a
-- ringing call dies by the server clock everywhere at once.

alter table public.call_sessions
  add column if not exists expires_at timestamptz default (now() + interval '45 seconds');

update public.call_sessions
  set expires_at = created_at + interval '45 seconds'
  where expires_at is null;

create or replace function public.sweep_dead_calls()
returns void language sql security definer set search_path = public
as $fn$
  -- Ringing past its server expiry dies as missed.
  update call_sessions
  set status = 'missed', ended_at = now()
  where status = 'ringing'
    and coalesce(expires_at, created_at + interval '2 minutes') < now();

  -- Active group shells with nobody joined die after 2 minutes.
  update call_sessions s set status = 'ended', ended_at = now()
  where s.status = 'active'
    and coalesce(s.started_at, s.created_at) < now() - interval '2 minutes'
    and s.is_group_call
    and not exists (select 1 from call_participants p
                    where p.call_session_id = s.id and p.status = 'joined');
$fn$;