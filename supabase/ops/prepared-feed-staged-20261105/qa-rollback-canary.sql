-- Existing named QA test principal only. No user/session creation, no token.
-- All settings, queue/snapshot rows and visibility mutations roll back.
begin;
set local lock_timeout='3s';
set local statement_timeout='8s';
do $canary$
declare actor uuid;session_id uuid;app jsonb;claim jsonb;started timestamptz;first_ms numeric;worker_ms numeric;warm_ms numeric;
 baseline_ids uuid[];catalog_count integer;catalog_missing integer;
 first_ids uuid[];warm_ids uuid[];first_count integer;warm_count integer;visible_count integer;negative boolean;
 hidden_id uuid;cursor_id uuid;cursor_key double precision;hidden_present boolean;worker jsonb;session_found boolean:=false;
begin
 if (select enabled from prepared_feed.settings where singleton) then raise exception 'CANARY_REQUIRES_PREPARED_DISABLED';end if;
 if exists(select 1 from prepared_feed.demand) then raise exception 'CANARY_REQUIRES_EMPTY_DEMAND';end if;
 select count(*),count(*)filter(where c.post_id is null) into catalog_count,catalog_missing
 from(select id from public.posts where community_id is null limit 10001)p left join feed_ranking.catalog c on c.post_id=p.id;
 if catalog_count>10000 or catalog_missing<>0 then raise exception 'CANARY_CATALOG_NOT_COMPLETE_OR_TOO_LARGE';end if;
 select p.id,s.id,coalesce(u.raw_app_meta_data,'{}') into actor,session_id,app
 from public.profiles p join auth.users u on u.id=p.id join auth.sessions s on s.user_id=p.id
 where p.username='musa' and p.full_name='Musa Test' and p.account_type='personal'
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<now())
 and (s.not_after is null or s.not_after>now()+interval '5 minutes')
 order by s.created_at desc limit 1;
 if actor is null or session_id is null then raise exception 'CANARY_KNOWN_TEST_SESSION_REQUIRED';end if;
 session_found:=true;
 claim:=jsonb_build_object('sub',actor,'role','authenticated','session_id',session_id,'aal','aal1','is_anonymous',false,
 'app_metadata',app,'exp',floor(extract(epoch from now()+interval '5 minutes')));
 perform set_config('request.jwt.claims',claim::text,true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.headers','{"x-client-info":"supabase-js/2 platinum-cache/1"}',true);
 execute 'set local role authenticated';
 select array_agg(post_id order by sort_key desc,post_id desc) into baseline_ids from prepared_feed.canonical('for_you',null,null,20);
 execute 'reset role';
 perform public.configure_indexed_feed_v1(true);
 perform public.configure_prepared_feed_v1(true);
 execute 'set local role authenticated';
 if not public.business_session_allowed() then raise exception 'CANARY_SESSION_REJECTED';end if;
 started:=clock_timestamp();
 select count(*),array_agg(post_id order by sort_key desc,post_id desc) into first_count,first_ids from public.get_feed('for_you',null,null,20);
 first_ms:=extract(epoch from(clock_timestamp()-started))*1000;
 if first_ids is distinct from baseline_ids then raise exception 'CANARY_INDEXED_CANONICAL_MISMATCH';end if;
 if first_count<2 then raise exception 'CANARY_REQUIRES_TWO_VISIBLE_POSTS';end if;
 execute 'reset role';
 started:=clock_timestamp();worker:=public.drain_prepared_feed_v1(1);worker_ms:=extract(epoch from(clock_timestamp()-started))*1000;
 if (worker->>'prepared')::integer<>1 or (worker->>'failed')::integer<>0 then raise exception 'CANARY_WORKER_FAILED: %',worker;end if;
 execute 'set local role authenticated';
 started:=clock_timestamp();
 select count(*),array_agg(post_id order by sort_key desc,post_id desc),bool_and(sort_key < -4000000000000000)
 into warm_count,warm_ids,negative from public.get_feed('for_you',null,null,20);
 warm_ms:=extract(epoch from(clock_timestamp()-started))*1000;
 if warm_ids is distinct from first_ids or not negative then raise exception 'CANARY_PREPARED_RESULT_MISMATCH';end if;
 select count(*) into visible_count from public.get_feed_visibility(warm_ids);
 if visible_count<>warm_count then raise exception 'CANARY_CURRENT_VISIBILITY_MISMATCH';end if;
 select post_id,sort_key into cursor_id,cursor_key from public.get_feed('for_you',null,null,1);
 hidden_id:=warm_ids[2];
 execute 'reset role';
 insert into public.hidden_posts(user_id,post_id)values(actor,hidden_id);
 execute 'set local role authenticated';
 select coalesce(bool_or(post_id=hidden_id),false) into hidden_present from public.get_feed('for_you',cursor_key,cursor_id,20);
 if hidden_present then raise exception 'CANARY_HIDDEN_POST_LEAK';end if;
 execute 'reset role';
 perform set_config('prepared_feed.canary_result',jsonb_build_object('passed',true,'existing_test_session_verified',session_found,
 'indexed_enabled_during_canary',true,'indexed_canonical_parity',true,'catalog_rows_checked',catalog_count,'catalog_missing',catalog_missing,
 'first_count',first_count,'prepared_count',warm_count,'negative_cursors',negative,'current_visibility_count',visible_count,
 'hidden_post_excluded',not hidden_present,'worker_prepared',(worker->>'prepared')::integer,'worker_failed',(worker->>'failed')::integer,
 'cold_ms',round(first_ms,2),'worker_ms',round(worker_ms,2),'warm_ms',round(warm_ms,2),'rollback_only',true)::text,true);
end $canary$;
select current_setting('prepared_feed.canary_result')::jsonb as receipt;
rollback;
