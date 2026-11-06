-- Leave the existing reaction path active until an operator enables a measured threshold.
set local lock_timeout = '2s';
set local statement_timeout = '15s';
do $guard$ begin
 if (select md5(prosrc) from pg_proc where oid='live_streams.broadcast(uuid,text,jsonb)'::regprocedure)
    is distinct from '2c330dff62b39d3ba1377fcae0cfa499' then
   raise exception 'LIVE_BROADCAST_BASELINE_CHANGED';
 end if;
end $guard$;

alter table live_streams.settings add column reaction_batch_viewers integer
 check (reaction_batch_viewers >= 1);
create table live_streams.reaction_batches (
 window_at timestamptz not null,
 session_id uuid not null references live_streams.sessions(id) on delete cascade,
 epoch uuid not null,
 reaction text not null check (reaction in ('heart','applause','fire')),
 shard smallint not null check (shard between 0 and 15),
 taps bigint not null check (taps > 0),
 primary key (window_at,session_id,epoch,reaction,shard)
);
create index reaction_batches_session on live_streams.reaction_batches(session_id);
alter table live_streams.reaction_batches enable row level security;
revoke all on live_streams.reaction_batches from public, anon, authenticated, service_role;

create or replace function live_streams.broadcast(p_session uuid,p_event text,p_payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare room_epoch uuid; viewers bigint; threshold integer; control_payload jsonb;
begin
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return; end if;
 select chat_epoch, viewer_count into room_epoch, viewers from live_streams.sessions where id=p_session;
 if room_epoch is null then return; end if;
 if p_event='reaction' and p_payload->>'reaction' in ('heart','applause','fire') then
   select reaction_batch_viewers into threshold from live_streams.settings where singleton;
   if viewers >= threshold then
     insert into live_streams.reaction_batches(window_at,session_id,epoch,reaction,shard,taps)
     values(date_bin(interval '5 seconds',clock_timestamp(),timestamptz '2000-01-01 00:00 UTC'),
       p_session,room_epoch,p_payload->>'reaction',hashtext(p_payload->>'id') & 15,1)
     on conflict (window_at,session_id,epoch,reaction,shard) do update
       set taps=live_streams.reaction_batches.taps+1;
     return;
   end if;
 end if;
 perform realtime.send(p_payload,p_event,'live:'||p_session::text||':'||room_epoch::text,true);
 if p_event in ('session','access_changed','warning') then
   control_payload:=case when p_event='session' then jsonb_build_object('session',jsonb_build_object('id',p_session,'state',p_payload->'session'->>'state','updated_at',p_payload->'session'->>'updated_at'))
     else jsonb_build_object('session_id',p_session,'user_id',p_payload->>'user_id') end;
   perform realtime.send(control_payload,p_event,'live-control:'||p_session::text,true);
 end if;
end $$;

create function live_streams.flush_reaction_batches()
returns integer language plpgsql security definer set search_path='' as $$
declare cutoff timestamptz:=date_bin(interval '5 seconds',clock_timestamp(),timestamptz '2000-01-01 00:00 UTC'); summary record; sent integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('live_streams.flush_reaction_batches',0)) then return 0; end if;
 -- Deletion and delivery share a transaction. A send failure rolls the claims back.
 for summary in
   with claimed as (
     select b.ctid from live_streams.reaction_batches b where b.window_at<cutoff
     order by b.window_at,b.session_id,b.epoch,b.reaction,b.shard limit 2048 for update skip locked
   ), drained as (
     delete from live_streams.reaction_batches b using claimed where b.ctid=claimed.ctid returning b.*
   ), totals as (
     select d.session_id,d.epoch,d.reaction,sum(d.taps)::bigint as taps
     from drained d join live_streams.sessions s on s.id=d.session_id and s.chat_epoch=d.epoch
     where s.state='live' and d.window_at>=cutoff-interval '30 seconds'
     group by d.session_id,d.epoch,d.reaction
   )
   select session_id,epoch,jsonb_object_agg(reaction,taps) as counts,
     (array_agg(reaction order by taps desc,reaction))[1] as reaction
   from totals group by session_id,epoch
 loop
   -- Older clients still render the leading reaction. New clients can consume the totals.
   perform realtime.send(jsonb_build_object('id',gen_random_uuid(),'reaction',summary.reaction,'counts',summary.counts),
     'reaction','live:'||summary.session_id::text||':'||summary.epoch::text,true);
   sent:=sent+1;
 end loop;
 return sent;
end $$;
revoke all on function live_streams.flush_reaction_batches() from public,anon,authenticated,service_role;
