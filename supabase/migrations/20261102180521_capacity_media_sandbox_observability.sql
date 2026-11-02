-- Extend the existing bounded operational sample with aggregate worker caps.
-- No credentials, customer rows, provider calls, or resource activation.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare
 f pg_proc%rowtype; definition text;
 list_anchor constant text:='''media_processing_status_v1'',''feed_ranking_status_v1''';
 branch_anchor constant text:='    elsif v_key=''media_processing'' then';
 budget_branch constant text:=$branch$
    elsif v_key='media_sandbox' then
     if coalesce((v_component->>'daily_wall_cap_seconds')::numeric,0)<=0
       or coalesce((v_component->>'monthly_wall_cap_seconds')::numeric,0)<=0
       or coalesce((v_component->>'daily_wall_reserved_seconds')::numeric,-1)<0
       or coalesce((v_component->>'monthly_wall_reserved_seconds')::numeric,-1)<0 then
      raise exception 'Invalid media sandbox budget status';
     end if;
     v_component:=v_component||jsonb_build_object(
      'pending',coalesce((v_component->>'active_reservations')::integer,0),
      'pending_is_lower_bound',false,
      'daily_budget_used_percent',round(100*(v_component->>'daily_wall_reserved_seconds')::numeric/(v_component->>'daily_wall_cap_seconds')::numeric,2),
      'monthly_budget_used_percent',round(100*(v_component->>'monthly_wall_reserved_seconds')::numeric/(v_component->>'monthly_wall_cap_seconds')::numeric,2));
     perform capacity_ops.set_alert('media_sandbox_daily_budget_percent',
      case when coalesce((v_component->>'enabled')::boolean,false) then (v_component->>'daily_budget_used_percent')::numeric else 0 end,80,100);
     perform capacity_ops.set_alert('media_sandbox_monthly_budget_percent',
      case when coalesce((v_component->>'enabled')::boolean,false) then (v_component->>'monthly_budget_used_percent')::numeric else 0 end,80,100);
$branch$;
begin
 select * into f from pg_proc where oid=to_regprocedure('capacity_ops.capture()');
 if f.oid is null or md5(f.prosrc)<>'e1f7427a4053caaa6be87d556c84100b'
  or not f.prosecdef or f.provolatile<>'v'
  or f.proconfig is distinct from array['search_path=""','statement_timeout=5s']::text[]
  or has_function_privilege('anon',f.oid,'execute')
  or has_function_privilege('authenticated',f.oid,'execute') then
  raise exception 'CAPACITY_CAPTURE_BASELINE_REQUIRES_REVIEW';
 end if;
 if (length(f.prosrc)-length(replace(f.prosrc,list_anchor,'')))/length(list_anchor)<>1
  or (length(f.prosrc)-length(replace(f.prosrc,branch_anchor,'')))/length(branch_anchor)<>1 then
  raise exception 'CAPACITY_CAPTURE_ANCHORS_REQUIRE_REVIEW';
 end if;
 definition:=pg_get_functiondef(f.oid);
 definition:=replace(definition,list_anchor,list_anchor||',''media_sandbox_status_v1''');
 execute replace(definition,branch_anchor,budget_branch||branch_anchor);
end $migration$;
commit;
