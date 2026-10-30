-- Ordinary staff restore is not a cancellation of a self-service erasure.
-- Preserve the frozen admin contract and add only the cross-module guard.
begin;
set local lock_timeout='3s';

do $restore_guard$
declare source text; lock_anchor text; review_anchor text;
begin
 if to_regclass('account_erasure.jobs') is null then
  raise exception 'ERASURE_RESTORE_BASELINE_MISSING';
 end if;
 source:=pg_get_functiondef('public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)'::regprocedure);
 if md5(source)<>'e70f392fe433810f1f1dbf9bb384dbcb' then
  raise exception 'ERASURE_RESTORE_ADMIN_DEFINITION_DRIFT';
 end if;
 lock_anchor:=E' end case;\n perform admin_ops.require_session(p_actor_id,p_session_id,perm);';
 review_anchor:=E' end loop;\n insert into admin_ops.commands(command_key,actor_id,operation,payload)';
 if position(lock_anchor in source)=0 or position(review_anchor in source)=0 then
  raise exception 'ERASURE_RESTORE_ADMIN_ANCHOR_MISSING';
 end if;
 source:=replace(source,lock_anchor,$guard$ end case;
 -- Match erasure acceptance's lock before taking actor/profile/Auth row locks.
 -- A concurrent accepted erasure must win over an ordinary restore operation.
 if p_operation in ('restoreUser','liftRestriction') then
  id:=case when p_operation='restoreUser' then (p_payload->>'id')::uuid else (p_payload->>'uid')::uuid end;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-erasure:'||id::text,0));
 end if;
 perform admin_ops.require_session(p_actor_id,p_session_id,perm);$guard$);
 source:=replace(source,review_anchor,$guard$ end loop;
 -- Check current erasure state before an old command receipt can return success.
 if p_operation in ('restoreUser','liftRestriction')
  and exists(select 1 from account_erasure.jobs where user_id=id and state<>'completed') then
  raise exception 'DELETION_REVIEW_REQUIRED';
 end if;
 insert into admin_ops.commands(command_key,actor_id,operation,payload)$guard$);
 execute source;
end $restore_guard$;

-- CREATE OR REPLACE preserves the existing owner and service-only ACL.
notify pgrst,'reload schema';
commit;
