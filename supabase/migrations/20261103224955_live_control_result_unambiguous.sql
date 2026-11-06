-- Applied to hosted QA as version 20261103224955.
-- Rename only the PL/pgSQL local variable. Preserve authorization, leases,
-- operation states, provider confirmation and existing grants.
set local lock_timeout='3s';
set local statement_timeout='15s';
do $repair$
declare v_definition text;
begin
 select pg_get_functiondef('live_streams.finish_control(uuid,uuid,boolean,text,jsonb)'::regprocedure) into v_definition;
 if position('declare c live_streams.controls;result jsonb;' in v_definition)=0 or position('result=result' in v_definition)=0 then
  if position('result=v_result' in v_definition)>0 then return; end if;
  raise exception 'UNEXPECTED_LIVE_FINISH_CONTROL_DEFINITION';
 end if;
 v_definition:=replace(v_definition,'declare c live_streams.controls;result jsonb;','declare c live_streams.controls;v_result jsonb;');
 v_definition:=replace(v_definition,'result:=','v_result:=');
 v_definition:=replace(v_definition,'result=result','result=v_result');
 v_definition:=replace(v_definition,'return result;','return v_result;');
 execute v_definition;
end $repair$;
