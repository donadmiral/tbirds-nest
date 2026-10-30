-- Operator review resumes only erasure already authorized by a recorded request.
-- It cannot override retention or provenance, erase Storage, or delete Auth.
begin;
set local lock_timeout='3s';
do $baseline$
begin
 if md5(pg_get_functiondef('public.triniti_admin_deletion_requests(uuid,uuid,integer)'::regprocedure))<>'51f6ddc192afd05e47136daef63f69b7'
  or to_regclass('account_erasure.reviews') is not null then
  raise exception 'ERASURE_OPERATOR_BASELINE_CHANGED';
 end if;
end $baseline$;

alter table account_erasure.jobs add column identity_prepared boolean not null default false;
alter table account_erasure.jobs add column review_revision bigint not null default 0;
update account_erasure.jobs j set identity_prepared=true
 where state='identity_pending' or exists(select 1 from account_erasure.events e where e.job_id=j.id and e.event='identity_pending');
alter table admin_ops.deletion_requests add column erasure_job_id uuid unique references account_erasure.jobs(id) on delete set null;
alter table admin_ops.deletion_requests add column review_revision bigint not null default 0;
alter table admin_ops.deletion_requests add column review_hold text;
alter table admin_ops.deletion_requests add column files_total integer;
alter table admin_ops.deletion_requests add column files_erased integer;
create table account_erasure.reviews (
 command_key uuid primary key references admin_ops.commands(command_key),
 source text not null check(source in('admin','self_service')),
 request_id uuid not null, actor_id uuid not null,
 action text not null check(action in('note','resume')),
 note text not null check(length(note) between 20 and 2000),
 outcome text not null check(outcome in('noted','held','queued','identity_pending')),
 before_state jsonb not null, after_state jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index erasure_review_request on account_erasure.reviews(source,request_id,created_at desc);
alter table account_erasure.reviews enable row level security;
revoke all on account_erasure.reviews from public,anon,authenticated,service_role;

create function account_erasure.keep_identity_phase() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then new.identity_prepared:=old.identity_prepared or new.identity_prepared;end if;
 if new.state='identity_pending' then new.identity_prepared:=true;end if;
 return new;
end $$;
create trigger account_erasure_identity_phase before insert or update on account_erasure.jobs
 for each row execute function account_erasure.keep_identity_phase();
create function account_erasure.complete_admin_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- finish_account_erasure is the only worker completion contract, and verifies
 -- actual object/Auth absence first. Mirror that persisted completion, not HTTP.
 if new.state='completed' and old.state<>'completed' then
  update admin_ops.deletion_requests set erasure_job_id=new.id,status='completed',completed_at=new.completed_at,
   files_total=new.object_count,files_erased=new.deleted_count,review_hold=null,review_revision=review_revision+1
  where erasure_job_id=new.id or(erasure_job_id is null and user_id=old.user_id and status<>'cancelled');
 end if;
 return null;
end $$;
create trigger account_erasure_admin_completion after update of state on account_erasure.jobs
 for each row execute function account_erasure.complete_admin_request();
revoke all on function account_erasure.keep_identity_phase(),account_erasure.complete_admin_request() from public,anon,authenticated,service_role;

create function account_erasure.admin_review_snapshot(p_source text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d admin_ops.deletion_requests%rowtype;j account_erasure.jobs%rowtype;v jsonb;review jsonb;
begin
 if p_source='admin' then
  select * into d from admin_ops.deletion_requests where id=p_id;
  if not found then return null;end if;
  select * into j from account_erasure.jobs where id=d.erasure_job_id
   or(d.erasure_job_id is null and d.status<>'cancelled' and user_id=d.user_id);
  v:=jsonb_build_object('id',d.id,'source','admin','user_id',d.user_id,'reason',d.reason,
   'status',coalesce(j.state,d.status),'hold_reason',coalesce(j.reason,d.review_hold),'created_at',d.created_at,
   'updated_at',coalesce(j.updated_at,d.created_at),'completed_at',coalesce(j.completed_at,d.completed_at),
   'job_id',coalesce(j.id,d.erasure_job_id),'files_total',coalesce(j.object_count,d.files_total),
   'files_erased',coalesce(j.deleted_count,d.files_erased),'attempts',j.attempts,
   'identity_prepared',j.identity_prepared,'review_revision',d.review_revision);
 elsif p_source='self_service' then
  select * into j from account_erasure.jobs where id=p_id;
  if not found then return null;end if;
  v:=jsonb_build_object('id',j.id,'source','self_service','user_id',j.user_id,'reason',j.reason,
   'status',j.state,'hold_reason',j.reason,'created_at',j.created_at,'updated_at',j.updated_at,
   'completed_at',j.completed_at,'job_id',j.id,'files_total',j.object_count,'files_erased',j.deleted_count,
   'attempts',j.attempts,'identity_prepared',j.identity_prepared,'review_revision',j.review_revision);
 else return null;end if;
 -- The opaque version covers worker progress/lease changes as well as notes.
 v:=v||jsonb_build_object('version',md5((v||jsonb_build_object('lease_until',j.lease_until,
  'available_at',j.available_at,'cache_until',j.cache_until,'job_review_revision',j.review_revision))::text));
 select jsonb_build_object('note',r.note,'action',r.action,'outcome',r.outcome,'created_at',r.created_at)
 into review from account_erasure.reviews r where r.source=p_source and r.request_id=p_id
 order by r.created_at desc,r.command_key desc limit 1;
 return v||jsonb_build_object('last_review',review);
end $$;
revoke all on function account_erasure.admin_review_snapshot(text,uuid) from public,anon,authenticated,service_role;

create or replace function public.triniti_admin_deletion_requests(p_actor_id uuid,p_session_id uuid,p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform admin_ops.require_session(p_actor_id,p_session_id,'account_delete');
 if p_page is null or p_page not between 1 and 10000 then raise exception 'INVALID_PAGE';end if;
 with requests as (
  select d.id,'admin'::text source,d.created_at from admin_ops.deletion_requests d
  union all select j.id,'self_service',j.created_at from account_erasure.jobs j
   where not exists(select 1 from admin_ops.deletion_requests d where d.erasure_job_id=j.id
    or(d.erasure_job_id is null and d.status<>'cancelled' and d.user_id=j.user_id))
 ),page_rows as(select * from requests order by created_at desc,id,source limit 50 offset(p_page-1)*50)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(account_erasure.admin_review_snapshot(r.source,r.id)
  ||jsonb_build_object('full_name',p.full_name,'username',p.username) order by r.created_at desc,r.id,r.source)
  from page_rows r left join public.profiles p on p.id=(account_erasure.admin_review_snapshot(r.source,r.id)->>'user_id')::uuid),'[]'::jsonb),
  'total',(select count(*) from requests),'operator_review_available',true) into result;
 return result;
end $$;
revoke all on function public.triniti_admin_deletion_requests(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.triniti_admin_deletion_requests(uuid,uuid,integer) to service_role;

create function public.triniti_admin_erasure_review(
 p_actor_id uuid,p_session_id uuid,p_key uuid,p_source text,p_request_id uuid,
 p_version text,p_action text,p_note text,p_confirm text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c admin_ops.commands%rowtype;d admin_ops.deletion_requests%rowtype;j account_erasure.jobs%rowtype;
 subject uuid;peek_subject uuid;current jsonb;after_state jsonb;payload jsonb;result_value jsonb;
 hold text;outcome text:='noted';new_job uuid;note text:=btrim(p_note);
begin
 perform admin_ops.require_session(p_actor_id,p_session_id,'account_delete');
 if p_key is null or p_request_id is null or p_source is null or p_source not in('admin','self_service')
  or p_action is null or p_action not in('note','resume') or p_version is null or p_version !~ '^[0-9a-f]{32}$'
  or note is null or length(note) not between 20 and 2000 then raise exception 'INVALID_ERASURE_REVIEW';end if;
 if p_action='resume' and p_confirm is distinct from 'RESUME' then raise exception 'ERASURE_RESUME_CONFIRMATION_REQUIRED';end if;
 if p_action='note' and p_confirm is not null then raise exception 'INVALID_ERASURE_REVIEW';end if;
 payload:=jsonb_build_object('source',p_source,'request_id',p_request_id,'version',p_version,
  'action',p_action,'note',note,'confirm',p_confirm);
 insert into admin_ops.commands(command_key,actor_id,operation,payload)
 values(p_key,p_actor_id,'accountErasureReview',payload) on conflict do nothing;
 select * into c from admin_ops.commands where command_key=p_key for update;
 if c.actor_id<>p_actor_id or c.operation<>'accountErasureReview' or c.payload<>payload then raise exception 'COMMAND_KEY_REUSED';end if;
 if c.result is not null then return c.result;end if;
 if p_source='admin' then
  select user_id into peek_subject from admin_ops.deletion_requests where id=p_request_id;
 else select user_id into peek_subject from account_erasure.jobs where id=p_request_id;end if;
 if peek_subject is not null then
  perform pg_advisory_xact_lock(hashtextextended('account-erasure-review:'||peek_subject::text,0));
 end if;
 -- Worker ordering is job -> account lock. Completion additionally locks the
 -- linked admin request, so review uses job -> admin request -> account lock.
 if p_source='admin' then
  select * into d from admin_ops.deletion_requests where id=p_request_id;
  if not found then raise exception 'TARGET_NOT_FOUND';end if;
  select * into j from account_erasure.jobs where id=d.erasure_job_id
   or(d.erasure_job_id is null and d.status<>'cancelled' and user_id=d.user_id) for update;
  select * into d from admin_ops.deletion_requests where id=p_request_id for update;
  subject:=d.user_id;
 else
  select * into j from account_erasure.jobs where id=p_request_id for update;
  if not found then raise exception 'TARGET_NOT_FOUND';end if;subject:=j.user_id;
 end if;
 current:=account_erasure.admin_review_snapshot(p_source,p_request_id);
 if current is null or current->>'version' is distinct from p_version or subject is distinct from peek_subject then
  raise exception 'ERASURE_REVIEW_STALE';end if;
 if p_action='resume' then
  if current->>'status'<>'retention_review' or subject is null then raise exception 'ERASURE_NOT_REVIEWABLE';end if;
  if j.lease_until>clock_timestamp() then raise exception 'ERASURE_WORKER_ACTIVE';end if;
  perform pg_advisory_xact_lock(hashtextextended('account-erasure:'||subject::text,0));
  if exists(select 1 from auth.sessions where user_id=subject)
   or exists(select 1 from auth.users where id=subject and(banned_until is null or banned_until<=clock_timestamp()))
  then raise exception 'ERASURE_ACCOUNT_NOT_DISABLED';end if;
  hold:=account_erasure.review_reason(subject);
  if hold is null and j.id is not null then
   if exists(select 1 from account_erasure.objects q join storage.objects o on o.id=q.object_id
      or(o.bucket_id=q.bucket and o.name=q.path)
      where q.job_id=j.id and(q.erased_at is not null or o.id<>q.object_id or o.bucket_id<>q.bucket
       or o.name<>q.path or o.version is distinct from q.version or coalesce(o.owner_id,o.owner::text) is distinct from subject::text))
    or(j.object_count>0 and exists(select 1 from storage.objects o where coalesce(o.owner_id,o.owner::text)=subject::text
      and not exists(select 1 from account_erasure.objects q where q.job_id=j.id and q.object_id=o.id)))
    or(j.identity_prepared and(exists(select 1 from storage.objects o where coalesce(o.owner_id,o.owner::text)=subject::text)
      or exists(select 1 from account_erasure.objects q where q.job_id=j.id and q.erased_at is null)))
   then hold:='storage_changed';end if;
  end if;
  if hold is null and not coalesce(j.identity_prepared,false) then
   if not exists(select 1 from auth.users where id=subject) then hold:='application_review';
   else
    -- Prove the currently deployed cleanup can run; ALWAYS roll it back.
    begin
     perform account_erasure.erase_app_records(subject);
     raise sqlstate 'PE001';
    exception when sqlstate 'PE001' then null;
     when others then hold:='application_review';
    end;
   end if;
  end if;
  if hold is not null then
   outcome:='held';
   if j.id is not null then update account_erasure.jobs set reason=hold,updated_at=clock_timestamp() where id=j.id;end if;
   if p_source='admin' then update admin_ops.deletion_requests set review_hold=hold where id=d.id;end if;
  else
   if not exists(select 1 from account_erasure.worker where secret_digest is not null and last_seen_at>clock_timestamp()-interval '15 minutes')
   then raise exception 'ERASURE_WORKER_UNAVAILABLE';end if;
   if j.id is null then
    new_job:=gen_random_uuid();
    insert into account_erasure.jobs(id,user_id,receipt_digest,state)
    values(new_job,subject,extensions.digest(extensions.gen_random_bytes(32),'sha256'),'queued') returning * into j;
    insert into account_erasure.events(job_id,event) values(j.id,'requested');
   end if;
   if not j.identity_prepared and j.object_count=0 then
    insert into account_erasure.objects(job_id,object_id,bucket,path,version)
    select j.id,o.id,o.bucket_id,o.name,o.version from storage.objects o
    where coalesce(o.owner_id,o.owner::text)=subject::text
     and not exists(select 1 from account_erasure.objects q where q.job_id=j.id and q.object_id=o.id);
   end if;
   outcome:=case when j.identity_prepared then 'identity_pending' else 'queued' end;
   update account_erasure.jobs set state=outcome,reason=null,last_error=null,
    object_count=(select count(*) from account_erasure.objects where job_id=j.id),
    available_at=greatest(clock_timestamp(),coalesce(cache_until,clock_timestamp())),
    lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
   if p_source='admin' then update admin_ops.deletion_requests set erasure_job_id=j.id,status='erasing',review_hold=null where id=d.id;end if;
   -- Keep retry history and erased_count; another exhausted failure returns to
   -- review instead of silently granting another unlimited retry budget.
   insert into account_erasure.events(job_id,event) values(j.id,'retry');
  end if;
 end if;
 if p_source='admin' then update admin_ops.deletion_requests set review_revision=review_revision+1 where id=d.id;
 else update account_erasure.jobs set review_revision=review_revision+1,updated_at=clock_timestamp() where id=j.id;end if;
 after_state:=account_erasure.admin_review_snapshot(p_source,p_request_id);
 insert into account_erasure.reviews(command_key,source,request_id,actor_id,action,note,outcome,before_state,after_state)
 values(p_key,p_source,p_request_id,p_actor_id,p_action,note,outcome,current-'last_review',after_state-'last_review');
 insert into public.admin_audit_log(admin_id,action,target_kind,target_id,reason,before,after)
 values(p_actor_id,'accountErasureReview','account_erasure_'||p_source,p_request_id::text,
  'Account erasure review: '||p_action,current-'last_review',after_state-'last_review');
 result_value:=jsonb_build_object('success',true,'command_key',p_key,'source',p_source,'request_id',p_request_id,
  'outcome',outcome,'state',after_state->>'status','hold_reason',after_state->>'hold_reason','version',after_state->>'version');
 update admin_ops.commands set result=result_value where command_key=p_key;
 return result_value;
end $$;
revoke all on function public.triniti_admin_erasure_review(uuid,uuid,uuid,text,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.triniti_admin_erasure_review(uuid,uuid,uuid,text,uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
