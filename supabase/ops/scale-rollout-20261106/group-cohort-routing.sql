begin;
set local statement_timeout='15s';set local lock_timeout='2s';create temp table group_proof(receipt jsonb) on commit drop;
do $probe$ declare sender uuid:=gen_random_uuid(); r1 uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); u uuid; chosen uuid:=gen_random_uuid(); control uuid:=gen_random_uuid(); room uuid; one uuid:=gen_random_uuid(); two uuid:=gen_random_uuid(); shard_count int; target_count int; ordinary_count int;
begin begin
 if exists(select from notification_fanout.jobs where state='pending') then raise exception 'BUSY_QUEUE';end if;
 while get_byte(decode(md5(chosen::text),'hex'),0)*100/256>=5 loop chosen:=gen_random_uuid();end loop;
 while get_byte(decode(md5(control::text),'hex'),0)*100/256<5 loop control:=gen_random_uuid();end loop;
 foreach u in array array[sender,r1,r2,outsider] loop
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(u,'authenticated','authenticated','pc-probe-'||u||'@example.invalid','{"provider":"email","providers":["email"]}',jsonb_build_object('username','pc_'||left(replace(u::text,'-',''),12)),now(),now());
  insert into public.profiles(id,email,username,full_name) values(u,'pc-probe-'||u||'@example.invalid','pc_'||left(replace(u::text,'-',''),12),'Synthetic fixture') on conflict(id) do nothing;
 end loop;
 update notification_fanout.settings set fanout_enabled=true,group_rollout_percent=5 where singleton;
 foreach room in array array[chosen,control] loop
  insert into public.conversations(id,user_1,is_group,group_name) values(room,sender,true,'Synthetic delivery probe');
  foreach u in array array[sender,r1,r2] loop insert into public.conversation_members(conversation_id,user_id) values(room,u) on conflict do nothing;end loop;
 end loop;
 insert into public.messages(id,conversation_id,sender_id,text) values(one,chosen,sender,'Synthetic cohort probe'),(two,control,sender,'Synthetic control probe');
 select count(*) into shard_count from notification_fanout.jobs where message_id=one;
 select count(*) into ordinary_count from public.notifications where data->>'message_id'=two::text;
 if shard_count<>16 or ordinary_count<>2 or exists(select from public.notifications where data->>'message_id'=one::text) or exists(select from notification_fanout.jobs where message_id=two) then raise exception 'WRONG_ROUTING';end if;
 insert into public.conversation_members(conversation_id,user_id) values(chosen,outsider);
 perform public.drain_notification_fanout_v1(32,250);
 perform public.drain_notification_fanout_v1(32,250);
 select count(*) into target_count from public.notifications where data->>'message_id'=one::text;
 if target_count<>2 or (select count(distinct recipient_id) from public.notifications where data->>'message_id'=one::text and recipient_id in(r1,r2))<>2 then raise exception 'FANOUT_RECIPIENT_MISMATCH';end if;
 raise sqlstate 'ZQ001' using message='rollback fixture';
 exception when sqlstate 'ZQ001' then null; end;
 if exists(select from auth.users where id in(sender,r1,r2,outsider)) then raise exception 'FIXTURE_RETAINED';end if;
 insert into pg_temp.group_proof values(jsonb_build_object('durable_shards',shard_count,'async_recipients',target_count,'sync_recipients',ordinary_count,'no_double_delivery',true,'late_member_excluded',true,'fixture_removed',true));
end $probe$;select receipt from pg_temp.group_proof;
commit;
