-- Each group is assigned consistently. Direct messages retain their existing path.
set local lock_timeout='2s';
set local statement_timeout='10s';
alter table notification_fanout.settings add column group_rollout_percent smallint
 not null default 100 check(group_rollout_percent between 0 and 100);
do $migration$
declare f pg_proc%rowtype; anchor text:='if (select fanout_enabled from notification_fanout.settings where singleton) then'; updated text;
begin
 select * into strict f from pg_proc where oid='public.notify_on_new_message()'::regprocedure;
 if md5(f.prosrc)<>'3c1b5b9922e8af75c2dce599105b998d' or strpos(f.prosrc,anchor)=0 then
   raise exception 'GROUP_NOTIFICATION_TRIGGER_BASELINE_CHANGED';
 end if;
 updated:=replace(f.prosrc,anchor,$gate$if (select fanout_enabled and
       get_byte(decode(md5(new.conversation_id::text),'hex'),0)*100/256 < group_rollout_percent
       from notification_fanout.settings where singleton) then$gate$);
 execute replace(pg_get_functiondef(f.oid),f.prosrc,updated);
end $migration$;
