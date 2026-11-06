-- Existing clients keep canonical cursors. Only clients that understand
-- prepared snapshot expiration opt in through the existing allowed header.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare f pg_proc%rowtype;definition text;
 anchor constant text:='  if not prepared_feed.enabled() or p_mode is null';
 replacement constant text:='  if coalesce(coalesce(nullif(current_setting(''request.headers'',true),''''),''{}'')::jsonb->>''x-client-info'','''') !~ ''(^|[[:space:],])platinum-cache/1([[:space:],]|$)'' then
   if p_cursor_key<=-4000000000000000 then
    return query select * from prepared_feed.canonical(p_mode,null,null,p_limit);
   else
    return query select * from prepared_feed.canonical(p_mode,p_cursor_key,p_cursor_id,p_limit);
   end if;
   return;
  end if;
  if not prepared_feed.enabled() or p_mode is null';
begin
 select * into f from pg_proc where oid='public.get_feed(text,double precision,uuid,integer)'::regprocedure;
 if f.prosecdef or f.provolatile<>'v' or position('while emitted<lim and inspected<cardinality(saved.ids)' in f.prosrc)=0
  or (length(f.prosrc)-length(replace(f.prosrc,anchor,'')))/length(anchor)<>1
  then raise exception 'PREPARED_CLIENT_GATE_BASELINE_REQUIRED';end if;
 definition:=pg_get_functiondef(f.oid);
 execute replace(definition,anchor,replacement);
end $migration$;
notify pgrst,'reload schema';
commit;
