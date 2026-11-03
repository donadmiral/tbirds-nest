-- Bounded Live polls, Q&A, chapter markers and measured analytics.
-- Audience playback remains on the CDN; no viewer heartbeat writes are added.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

create table live_streams.interaction_polls (
 id uuid primary key default gen_random_uuid(),session_id uuid not null references live_streams.sessions(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete cascade,question text not null check(length(question) between 1 and 160),
 state text not null default 'open' check(state in ('open','closed')),created_at timestamptz not null default now(),closed_at timestamptz
);
create index live_interaction_polls_page on live_streams.interaction_polls(session_id,created_at desc,id desc);
create table live_streams.interaction_poll_options (
 id uuid primary key default gen_random_uuid(),poll_id uuid not null references live_streams.interaction_polls(id) on delete cascade,
 label text not null check(length(label) between 1 and 100),position integer not null check(position between 0 and 5),
 unique(poll_id,position),unique(poll_id,id)
);
create table live_streams.interaction_poll_votes (
 poll_id uuid not null,user_id uuid not null references public.profiles(id) on delete cascade,option_id uuid not null,
 created_at timestamptz not null default now(),primary key(poll_id,user_id),
 foreign key(poll_id,option_id) references live_streams.interaction_poll_options(poll_id,id) on delete cascade
);
create index live_interaction_poll_votes_user on live_streams.interaction_poll_votes(user_id,poll_id);
create table live_streams.interaction_questions (
 id uuid primary key default gen_random_uuid(),session_id uuid not null references live_streams.sessions(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete cascade,body text not null check(length(body) between 1 and 500),
 answer text not null default '' check(length(answer)<=1000),answered_by uuid,
 state text not null default 'open' check(state in ('open','answered','closed')),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index live_interaction_questions_page on live_streams.interaction_questions(session_id,created_at desc,id desc) where state<>'closed';
create index live_interaction_questions_actor on live_streams.interaction_questions(actor_id,created_at desc);
create table live_streams.interaction_question_votes (
 question_id uuid not null references live_streams.interaction_questions(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,created_at timestamptz not null default now(),primary key(question_id,user_id)
);
create index live_interaction_question_votes_user on live_streams.interaction_question_votes(user_id,question_id);
create table live_streams.interaction_chapters (
 id uuid primary key default gen_random_uuid(),session_id uuid not null references live_streams.sessions(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete cascade,title text not null check(length(title) between 1 and 120),
 position_ms bigint not null check(position_ms between 0 and 604800000),created_at timestamptz not null default now(),unique(session_id,position_ms)
);
create index live_interaction_chapters_page on live_streams.interaction_chapters(session_id,position_ms,id);
-- Distributed counters avoid making a popular poll/stream row a write lock.
create table live_streams.interaction_counters (
 session_id uuid not null references live_streams.sessions(id) on delete cascade,kind text not null check(kind in ('poll','question','chat_messages','reactions')),
 item_id uuid not null,shard smallint not null check(shard between 0 and 63),value bigint not null check(value>=0),
 primary key(session_id,kind,item_id,shard)
);
create table live_streams.interaction_dirty (
 session_id uuid not null references live_streams.sessions(id) on delete cascade,shard smallint not null check(shard between 0 and 63),
 structural boolean not null default false,updated_at timestamptz not null default now(),primary key(session_id,shard)
);
create index live_interaction_dirty_due on live_streams.interaction_dirty(updated_at,session_id);
create table live_streams.interaction_metrics (
 session_id uuid primary key references live_streams.sessions(id) on delete cascade,peak_viewers bigint check(peak_viewers>=0),
 measured_from timestamptz not null default now(),updated_at timestamptz not null default now()
);

do $$declare name text;begin
 foreach name in array array['interaction_polls','interaction_poll_options','interaction_poll_votes','interaction_questions','interaction_question_votes','interaction_chapters','interaction_counters','interaction_dirty','interaction_metrics'] loop
  execute format('alter table live_streams.%I enable row level security',name);
  execute format('revoke all on live_streams.%I from public,anon,authenticated,service_role',name);
 end loop;
end $$;

create function live_streams.interaction_actor(p_session uuid,p_manage boolean default false) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();role text;
begin
 if live_streams.staff_role(uid) is not null then perform live_streams.require_admin(p_manage);
 else
  uid:=live_streams.require_user();
  if not live_streams.can_view(p_session,uid) then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
  role:=live_streams.role_for(p_session,uid);
  if p_manage and role not in ('host','producer','moderator') then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
  if p_manage and role in ('host','producer') then perform live_streams.require_publisher();end if;
 end if;
 if not exists(select 1 from live_streams.sessions where id=p_session) then raise exception 'NOT_AVAILABLE';end if;
 return uid;
end $$;
create function live_streams.interaction_count(p_session uuid,p_kind text,p_item uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select coalesce(sum(value),0)::bigint from live_streams.interaction_counters where session_id=p_session and kind=p_kind and item_id=p_item;
$$;
create function live_streams.interaction_count_add(p_session uuid,p_kind text,p_item uuid,p_actor uuid,p_delta integer) returns void
language plpgsql security definer set search_path='' as $$
declare bucket smallint:=abs(hashtextextended(p_actor::text,0)%64)::smallint;
begin
 if p_delta=0 then return;end if;
 if p_delta<0 then
  update live_streams.interaction_counters set value=value+p_delta where session_id=p_session and kind=p_kind and item_id=p_item and shard=bucket;
 else
  insert into live_streams.interaction_counters(session_id,kind,item_id,shard,value) values(p_session,p_kind,p_item,bucket,p_delta)
   on conflict(session_id,kind,item_id,shard) do update set value=live_streams.interaction_counters.value+excluded.value;
 end if;
end $$;
create function live_streams.interaction_mark(p_session uuid,p_actor uuid,p_structural boolean) returns void
language sql security definer set search_path='' as $$
 insert into live_streams.interaction_dirty(session_id,shard,structural,updated_at)
 values(p_session,abs(hashtextextended(p_actor::text,0)%64)::smallint,p_structural,clock_timestamp())
 on conflict(session_id,shard) do update set structural=live_streams.interaction_dirty.structural or excluded.structural,updated_at=excluded.updated_at;
$$;
create function live_streams.interaction_poll_json(p_poll uuid,p_actor uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'question',p.question,'state',p.state,'created_at',p.created_at,
  'options',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'votes',live_streams.interaction_count(p.session_id,'poll',o.id)) order by o.position),'[]') from live_streams.interaction_poll_options o where o.poll_id=p.id),
  'total_votes',(select coalesce(sum(live_streams.interaction_count(p.session_id,'poll',o.id)),0) from live_streams.interaction_poll_options o where o.poll_id=p.id))
  ||case when p_actor is null then '{}'::jsonb else jsonb_build_object('my_option_id',(select option_id from live_streams.interaction_poll_votes where poll_id=p.id and user_id=p_actor)) end
 from live_streams.interaction_polls p where p.id=p_poll;
$$;
create function live_streams.interaction_question_json(p_question uuid,p_actor uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',q.id,'body',q.body,'author',live_streams.profile_json(q.actor_id),'answer',q.answer,'state',q.state,'created_at',q.created_at,
  'votes',live_streams.interaction_count(q.session_id,'question',q.id))
  ||case when p_actor is null then '{}'::jsonb else jsonb_build_object('upvoted',exists(select 1 from live_streams.interaction_question_votes where question_id=q.id and user_id=p_actor)) end
 from live_streams.interaction_questions q where q.id=p_question and q.state<>'closed';
$$;
create function live_streams.interaction_snapshot(p_session uuid,p_actor uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'polls',(select coalesce(jsonb_agg(live_streams.interaction_poll_json(p.id,p_actor) order by (p.state='open') desc,p.created_at desc,p.id desc),'[]') from (select id,state,created_at from live_streams.interaction_polls where session_id=p_session order by (state='open') desc,created_at desc,id desc limit 3) p),
  'questions',(select coalesce(jsonb_agg(live_streams.interaction_question_json(q.id,p_actor) order by q.created_at desc,q.id desc),'[]') from (select id,created_at from live_streams.interaction_questions where session_id=p_session and state<>'closed' order by created_at desc,id desc limit 25) q),
  'chapters',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'position_ms',c.position_ms) order by c.position_ms,c.id),'[]') from (select id,title,position_ms from live_streams.interaction_chapters where session_id=p_session order by position_ms,id limit 100)c),
  'measured_at',clock_timestamp());
$$;
create function public.live_interactions(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=live_streams.interaction_actor(p_session_id);role text:=live_streams.role_for(p_session_id,uid);staff text:=live_streams.staff_role(uid);
begin
 return live_streams.interaction_snapshot(p_session_id,uid)||jsonb_build_object('can_manage',role in ('host','producer','moderator') or coalesce(staff in ('super_admin','platform_admin','trust_safety'),false));
end $$;

create function public.live_interaction_command(p_session_id uuid,p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare uid uuid;manage boolean;role text;s live_streams.sessions;prior live_streams.commands;poll live_streams.interaction_polls;q live_streams.interaction_questions;
 id uuid;option_id uuid;old_option uuid;entry jsonb;label text;position integer:=0;count_rows integer;body text;result jsonb;at_ms bigint;duration_ms bigint;allowed text[];
begin
 if p_action not in ('poll_create','poll_vote','poll_close','question_ask','question_vote','question_answer','question_close','chapter_add','chapter_remove') or p_request_id is null
  or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>12288 then raise exception 'INVALID_COMMAND';end if;
 allowed:=case p_action when 'poll_create' then array['question','options'] when 'poll_vote' then array['poll_id','option_id'] when 'poll_close' then array['poll_id']
  when 'question_ask' then array['body'] when 'question_vote' then array['question_id','enabled'] when 'question_answer' then array['question_id','answer']
  when 'question_close' then array['question_id'] when 'chapter_add' then array['title','position_ms'] when 'chapter_remove' then array['chapter_id'] end;
 if exists(select 1 from jsonb_object_keys(p_payload)k where not k=any(allowed)) then raise exception 'INVALID_COMMAND_FIELD';end if;
 manage:=p_action in ('poll_create','poll_close','question_answer','question_close','chapter_add','chapter_remove');
 uid:=live_streams.interaction_actor(p_session_id,manage);role:=live_streams.role_for(p_session_id,uid);
 select * into s from live_streams.sessions ss where ss.id=p_session_id;
 perform pg_advisory_xact_lock(hashtextextended('live-interaction-request:'||uid::text||p_request_id::text,0));
 select * into prior from live_streams.commands where actor_id=uid and request_id=p_request_id for update;
 if found then
  if prior.session_id is distinct from p_session_id or prior.action is distinct from 'interaction:'||p_action or prior.payload is distinct from p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  if prior.result is null then raise exception 'STATE_CONFLICT';end if;
  return prior.result||jsonb_build_object('duplicate',true);
 end if;
 perform live_streams.take_rate('interaction-user',uid::text,case when manage then 60 else 30 end,60);
 if p_action in ('poll_vote','question_vote','question_ask') and s.state not in ('live','reconnecting') then raise exception 'STATE_CONFLICT';end if;
 insert into live_streams.commands(actor_id,request_id,session_id,action,payload) values(uid,p_request_id,p_session_id,'interaction:'||p_action,p_payload);
 case p_action
 when 'poll_create' then
  if s.state in ('ending','ended','cancelled') then raise exception 'STATE_CONFLICT';end if;
  body:=nullif(btrim(p_payload->>'question'),'');
  if body is null or length(body)>160 or jsonb_typeof(p_payload->'options') is distinct from 'array' or jsonb_array_length(p_payload->'options') not between 2 and 6 then raise exception 'INVALID_POLL';end if;
  perform pg_advisory_xact_lock(hashtextextended('live-poll-cap:'||p_session_id::text,0));
  if (select count(*) from live_streams.interaction_polls where session_id=p_session_id and state='open')>=3 or (select count(*) from live_streams.interaction_polls where session_id=p_session_id)>=50 then raise exception 'CAPACITY_REACHED';end if;
  insert into live_streams.interaction_polls(session_id,actor_id,question) values(p_session_id,uid,body) returning interaction_polls.id into id;
  for entry in select value from jsonb_array_elements(p_payload->'options') loop
   if jsonb_typeof(entry)<>'string' then raise exception 'INVALID_POLL_OPTION';end if;
   label:=btrim(entry#>>'{}');if length(label) not between 1 and 100 then raise exception 'INVALID_POLL_OPTION';end if;
   if exists(select 1 from live_streams.interaction_poll_options where poll_id=id and lower(interaction_poll_options.label)=lower(label)) then raise exception 'DUPLICATE_OPTION';end if;
   insert into live_streams.interaction_poll_options(poll_id,label,position) values(id,label,position);position:=position+1;
  end loop;
  result:=jsonb_build_object('poll',live_streams.interaction_poll_json(id,uid));
 when 'poll_vote' then
  id:=(p_payload->>'poll_id')::uuid;option_id:=(p_payload->>'option_id')::uuid;
  select * into poll from live_streams.interaction_polls where interaction_polls.id=id and session_id=p_session_id for share;
  if not found or poll.state<>'open' or not exists(select 1 from live_streams.interaction_poll_options o where o.poll_id=id and o.id=option_id) then raise exception 'POLL_CLOSED_OR_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('live-poll-vote:'||uid::text||id::text,0));
  select v.option_id into old_option from live_streams.interaction_poll_votes v where v.poll_id=id and v.user_id=uid;
  if old_option is distinct from option_id then
   insert into live_streams.interaction_poll_votes(poll_id,user_id,option_id) values(id,uid,option_id) on conflict(poll_id,user_id) do update set option_id=excluded.option_id;
   if old_option is not null then perform live_streams.interaction_count_add(p_session_id,'poll',old_option,uid,-1);end if;
   perform live_streams.interaction_count_add(p_session_id,'poll',option_id,uid,1);
  end if;
  result:=jsonb_build_object('poll',live_streams.interaction_poll_json(id,uid));
 when 'poll_close' then
  id:=(p_payload->>'poll_id')::uuid;update live_streams.interaction_polls set state='closed',closed_at=now() where interaction_polls.id=id and session_id=p_session_id;
  if not found then raise exception 'NOT_AVAILABLE';end if;result:=jsonb_build_object('poll',live_streams.interaction_poll_json(id,uid));
 when 'question_ask' then
  body:=nullif(btrim(p_payload->>'body'),'');if body is null or length(body)>500 then raise exception 'INVALID_QUESTION';end if;
  if not (select chat_enabled from live_streams.settings where singleton) then raise exception 'CHAT_CLOSED';end if;
  if s.chat_mode='closed' and role not in ('host','producer','moderator') then raise exception 'CHAT_CLOSED';end if;
  if s.chat_mode='followers' and role='viewer' and not exists(select 1 from public.follows where follower_id=uid and following_id=s.host_id) then raise exception 'FOLLOWERS_ONLY';end if;
  perform live_streams.take_rate('live-question-actor',uid::text||p_session_id::text,3,60);
  perform live_streams.take_rate('live-question-session',p_session_id::text,20,1);
  perform pg_advisory_xact_lock(hashtextextended('live-question-cap:'||p_session_id::text,0));
  if (select count(*) from live_streams.interaction_questions where session_id=p_session_id and state<>'closed')>=2000 then raise exception 'CAPACITY_REACHED';end if;
  insert into live_streams.interaction_questions(session_id,actor_id,body) values(p_session_id,uid,body) returning interaction_questions.id into id;
  result:=jsonb_build_object('question',live_streams.interaction_question_json(id,uid));
 when 'question_vote' then
  if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception 'INVALID_VOTE';end if;
  id:=(p_payload->>'question_id')::uuid;
  select * into q from live_streams.interaction_questions where interaction_questions.id=id and session_id=p_session_id and state<>'closed' for share;
  if not found then raise exception 'NOT_AVAILABLE';end if;
  perform pg_advisory_xact_lock(hashtextextended('live-question-vote:'||uid::text||id::text,0));
  if (p_payload->>'enabled')::boolean then
   insert into live_streams.interaction_question_votes(question_id,user_id) values(id,uid) on conflict do nothing;
   get diagnostics count_rows=row_count;if count_rows=1 then perform live_streams.interaction_count_add(p_session_id,'question',id,uid,1);end if;
  else
   delete from live_streams.interaction_question_votes where question_id=id and user_id=uid;
   get diagnostics count_rows=row_count;if count_rows=1 then perform live_streams.interaction_count_add(p_session_id,'question',id,uid,-1);end if;
  end if;
  result:=jsonb_build_object('question',live_streams.interaction_question_json(id,uid));
 when 'question_answer' then
  id:=(p_payload->>'question_id')::uuid;body:=nullif(btrim(p_payload->>'answer'),'');if body is null or length(body)>1000 then raise exception 'INVALID_ANSWER';end if;
  update live_streams.interaction_questions set answer=body,answered_by=uid,state='answered',updated_at=now() where interaction_questions.id=id and session_id=p_session_id and state<>'closed';
  if not found then raise exception 'NOT_AVAILABLE';end if;result:=jsonb_build_object('question',live_streams.interaction_question_json(id,uid));
 when 'question_close' then
  id:=(p_payload->>'question_id')::uuid;update live_streams.interaction_questions set state='closed',updated_at=now() where interaction_questions.id=id and session_id=p_session_id;
  if not found then raise exception 'NOT_AVAILABLE';end if;result:=jsonb_build_object('question_id',id);
 when 'chapter_add' then
  body:=nullif(btrim(p_payload->>'title'),'');if body is null or length(body)>120 or s.started_at is null then raise exception 'INVALID_CHAPTER';end if;
  duration_ms:=least(604800000,greatest(0,floor(extract(epoch from (coalesce(s.ended_at,clock_timestamp())-s.started_at))*1000)::bigint));
  if p_payload ? 'position_ms' then
   if jsonb_typeof(p_payload->'position_ms') is distinct from 'number' or (p_payload->>'position_ms')!~'^[0-9]+$' then raise exception 'INVALID_CHAPTER_POSITION';end if;
   at_ms:=(p_payload->>'position_ms')::bigint;
  else at_ms:=duration_ms;end if;
  if at_ms<0 or at_ms>duration_ms then raise exception 'INVALID_CHAPTER_POSITION';end if;
  perform pg_advisory_xact_lock(hashtextextended('live-chapter-cap:'||p_session_id::text,0));
  if (select count(*) from live_streams.interaction_chapters where session_id=p_session_id)>=100 then raise exception 'CAPACITY_REACHED';end if;
  insert into live_streams.interaction_chapters(session_id,actor_id,title,position_ms) values(p_session_id,uid,body,at_ms) returning interaction_chapters.id into id;
  result:=jsonb_build_object('chapter',jsonb_build_object('id',id,'title',body,'position_ms',at_ms));
 when 'chapter_remove' then
  id:=(p_payload->>'chapter_id')::uuid;delete from live_streams.interaction_chapters where interaction_chapters.id=id and session_id=p_session_id;
  if not found then raise exception 'NOT_AVAILABLE';end if;result:=jsonb_build_object('chapter_id',id);
 end case;
 result:=jsonb_build_object('ok',true)||result;
 update live_streams.commands set result=result where actor_id=uid and request_id=p_request_id;
 perform live_streams.interaction_mark(p_session_id,uid,p_action not in ('poll_vote','question_vote'));
 if manage then insert into live_streams.audit(session_id,actor_id,action,payload) values(p_session_id,uid,'interaction:'||p_action,p_payload);end if;
 return result;
end $$;

create function public.live_flush_interactions(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target record;snapshot jsonb;structural boolean;cutoff timestamptz:=clock_timestamp();processed integer:=0;
begin
 for target in select session_id,min(updated_at) oldest from live_streams.interaction_dirty group by session_id order by oldest,session_id limit least(100,greatest(1,coalesce(p_limit,20))) loop
  if not pg_try_advisory_xact_lock(hashtextextended('live-interaction-flush:'||target.session_id::text,0)) then continue;end if;
  with removed as (delete from live_streams.interaction_dirty where session_id=target.session_id and updated_at<=cutoff returning interaction_dirty.structural) select bool_or(removed.structural) into structural from removed;
  if structural is null then continue;end if;
  snapshot:=live_streams.interaction_snapshot(target.session_id,null);
  if structural then perform live_streams.broadcast(target.session_id,'interaction',snapshot);
  else
   snapshot:=jsonb_build_object('polls',(select coalesce(jsonb_agg(jsonb_build_object('id',p->'id','total_votes',p->'total_votes','options',(select jsonb_agg(jsonb_build_object('id',o->'id','votes',o->'votes')) from jsonb_array_elements(p->'options')o))),'[]') from jsonb_array_elements(snapshot->'polls')p),
    'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',q->'id','votes',q->'votes')),'[]') from jsonb_array_elements(snapshot->'questions')q),'measured_at',clock_timestamp());
   perform live_streams.broadcast(target.session_id,'interaction_counts',snapshot);
  end if;
  processed:=processed+1;
 end loop;
 return jsonb_build_object('processed',processed);
end $$;

create function live_streams.interaction_metrics_capture() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='sessions' then
  if new.viewer_count is not null then
   insert into live_streams.interaction_metrics(session_id,peak_viewers,updated_at) values(new.id,new.viewer_count,now())
    on conflict(session_id) do update set peak_viewers=greatest(live_streams.interaction_metrics.peak_viewers,excluded.peak_viewers),updated_at=now();
  end if;
 elsif new.session_id is not null and new.action in ('chat','reaction') then
  perform live_streams.interaction_count_add(new.session_id,case when new.action='chat' then 'chat_messages' else 'reactions' end,new.session_id,new.actor_id,1);
 end if;
 return new;
end $$;
create trigger live_interaction_viewer_metric after insert or update of viewer_count on live_streams.sessions for each row execute function live_streams.interaction_metrics_capture();
create trigger live_interaction_command_metric after insert on live_streams.commands for each row execute function live_streams.interaction_metrics_capture();
create function public.live_analytics(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=live_streams.interaction_actor(p_session_id);s live_streams.sessions;metric live_streams.interaction_metrics;clips bigint;clip_views bigint;clip_shares bigint;
begin
 if live_streams.staff_role(uid) is null and live_streams.role_for(p_session_id,uid) not in ('host','producer','moderator') then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 select * into s from live_streams.sessions where id=p_session_id;select * into metric from live_streams.interaction_metrics where session_id=p_session_id;
 if to_regclass('live_streams.clips') is not null and to_regclass('live_streams.clip_metrics') is not null then
  execute 'select count(*) filter(where c.state<>''deleted''),sum(m.views),sum(m.shares) from live_streams.clips c left join live_streams.clip_metrics m on m.clip_id=c.id where c.session_id=$1' into clips,clip_views,clip_shares using p_session_id;
 end if;
 return jsonb_build_object('current_viewers',case when s.viewer_count_at>now()-interval '90 seconds' then s.viewer_count else null end,'peak_viewers',metric.peak_viewers,
  'unique_viewers',null,'watch_minutes',null,'chat_messages',live_streams.interaction_count(p_session_id,'chat_messages',p_session_id),'reactions',live_streams.interaction_count(p_session_id,'reactions',p_session_id),
  'clips',clips,'clip_views',clip_views,'clip_shares',clip_shares,'measured_at',clock_timestamp(),'measurement_scope','Since Live interactivity was enabled. Audience totals require provider measurements.');
end $$;

revoke all on function live_streams.interaction_actor(uuid,boolean),live_streams.interaction_count(uuid,text,uuid),live_streams.interaction_count_add(uuid,text,uuid,uuid,integer),
 live_streams.interaction_mark(uuid,uuid,boolean),live_streams.interaction_poll_json(uuid,uuid),live_streams.interaction_question_json(uuid,uuid),live_streams.interaction_snapshot(uuid,uuid),live_streams.interaction_metrics_capture()
 from public,anon,authenticated,service_role;
revoke all on function public.live_interactions(uuid),public.live_interaction_command(uuid,text,jsonb,uuid),public.live_analytics(uuid),public.live_flush_interactions(integer) from public,anon,authenticated,service_role;
grant execute on function public.live_interactions(uuid),public.live_interaction_command(uuid,text,jsonb,uuid),public.live_analytics(uuid) to authenticated;
grant execute on function public.live_flush_interactions(integer) to service_role;
-- pg_cron 1.6+ supports subminute schedules. Older installations use a safe minute
-- schedule until upgraded; clients also have an explicit manual refresh control.
do $$declare version text;cadence text;begin
 select extversion into version from pg_extension where extname='pg_cron';
 if version is not null and to_regprocedure('cron.schedule(text,text,text)') is not null then
  cadence:=case when split_part(version,'.',1)::integer>1 or split_part(version,'.',1)::integer=1 and split_part(version,'.',2)::integer>=6 then '5 seconds' else '* * * * *' end;
  perform cron.schedule('live-interaction-events',cadence,'select public.live_flush_interactions(50)');
 end if;
end $$;
commit;
