-- Operator-only. Test identities or rooms roll back before the result is returned.
begin;
set local statement_timeout='15s'; set local lock_timeout='2s';
create temp table support_repair_probe(receipt jsonb) on commit drop;
do $test$ declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); k uuid:=gen_random_uuid(); mid uuid; first_reply jsonb; repeat_reply jsonb; outsider_denied boolean:=false; conflict_denied boolean:=false; item_count integer; final_state text;
begin begin
 foreach mid in array array[a,b] loop
   insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
   values(mid,'authenticated','authenticated','pc-probe-'||mid||'@example.invalid','{"provider":"email","providers":["email"]}'::jsonb,jsonb_build_object('username','pc_'||left(replace(mid::text,'-',''),12)),now(),now());
   insert into public.profiles(id,email,username,full_name) values(mid,'pc-probe-'||mid||'@example.invalid','pc_'||left(replace(mid::text,'-',''),12),'Synthetic release test') on conflict(id) do nothing;
 end loop;
 insert into public.support_tickets(id,user_id,subject,status) values(t,a,'Rollback-only support probe','solved');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','session_id',gen_random_uuid())::text,true);
 perform set_config('request.jwt.claim.sub',a::text,true);
 set local role authenticated;
 first_reply:=public.send_member_support_reply(a,t,k,'Retry-safe reply');
 reset role;
 if first_reply->>'ticket_status'<>'open' then raise exception 'TICKET_NOT_REOPENED'; end if;
 update public.support_tickets set status='solved' where id=t;
 set local role authenticated;
 repeat_reply:=public.send_member_support_reply(a,t,k,'Retry-safe reply');
 begin perform public.send_member_support_reply(a,t,k,'Different text');exception when sqlstate '22023' then conflict_denied:=true; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated','session_id',gen_random_uuid())::text,true);
 perform set_config('request.jwt.claim.sub',b::text,true);
 begin perform public.send_member_support_reply(b,t,gen_random_uuid(),'Other account');exception when insufficient_privilege then outsider_denied:=true; end;
 reset role;
 select count(*) into item_count from public.support_messages where ticket_id=t;
 select status into strict final_state from public.support_tickets where id=t;
 if item_count<>1 or final_state<>'solved' or not outsider_denied or not conflict_denied or repeat_reply->>'message_id' is distinct from k::text or repeat_reply->>'replayed' is distinct from 'true' then raise exception 'REPLY_ACCEPTANCE_FAILED';end if;
 raise sqlstate 'ZQ001' using message='rollback fixture';
 exception when sqlstate 'ZQ001' then null;
 end;
 if exists(select from auth.users where id in (a,b)) or exists(select from public.support_tickets where id=t) then raise exception 'FIXTURE_RETAINED';end if;
 insert into pg_temp.support_repair_probe values(jsonb_build_object('one_reply_after_retry',item_count=1,'reopened_then_staff_resolution_preserved',final_state='solved','cross_member_denied',outsider_denied,'conflicting_retry_denied',conflict_denied,'fixture_removed',true));
end $test$;
select receipt from pg_temp.support_repair_probe;
commit;

