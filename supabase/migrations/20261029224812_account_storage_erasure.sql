-- Review candidate: deploy the scoped worker and cron before enabling clients.
-- Storage bytes are erased ONLY by the Storage API, never by deleting metadata.
begin;
set local lock_timeout = '3s';
create schema account_erasure;
revoke all on schema account_erasure from public, anon, authenticated, service_role;

create table account_erasure.jobs (
 id uuid primary key,
 user_id uuid,
 receipt_digest bytea not null check(octet_length(receipt_digest)=32),
 state text not null check(state in ('queued','erasing','retry','identity_pending','retention_review','completed')),
 reason text check(reason in ('financial_records','managed_account','ownership_review','application_review','storage_changed','worker_review')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 available_at timestamptz not null default clock_timestamp(),
 cache_until timestamptz,
 attempts integer not null default 0,
 lease_token uuid,
 lease_until timestamptz,
 object_count integer not null default 0,
 deleted_count integer not null default 0,
 last_error text check(last_error in ('storage_unavailable','storage_not_erased','identity_unavailable','lease_expired','application_review')),
 check((state='completed')=(completed_at is not null)),
 check(state='completed' or user_id is not null),
 check((lease_token is null)=(lease_until is null))
);
create unique index account_erasure_one_active on account_erasure.jobs(user_id) where user_id is not null;
create index account_erasure_due on account_erasure.jobs(available_at,created_at) where state in ('queued','erasing','retry','identity_pending');
create table account_erasure.objects (
 job_id uuid not null references account_erasure.jobs(id) on delete cascade,
 object_id uuid not null,
 bucket text not null,
 path text not null,
 version text not null,
 erased_at timestamptz,
 primary key(job_id,object_id),
 unique(bucket,path)
);
create table account_erasure.worker (
 singleton boolean primary key default true check(singleton),
 last_seen_at timestamptz,
 secret_digest bytea check(octet_length(secret_digest)=32)
);
insert into account_erasure.worker(singleton) values(true);
create table account_erasure.events (
 id bigint generated always as identity primary key,
 job_id uuid not null references account_erasure.jobs(id) on delete cascade,
 event text not null check(event in ('requested','claimed','retry','review','identity_pending','completed')),
 created_at timestamptz not null default clock_timestamp()
);
alter table account_erasure.jobs enable row level security;
alter table account_erasure.objects enable row level security;
alter table account_erasure.worker enable row level security;
alter table account_erasure.events enable row level security;
revoke all on all tables in schema account_erasure from public,anon,authenticated,service_role;
revoke all on all sequences in schema account_erasure from public,anon,authenticated,service_role;

-- Preserve the exact deployed application cleanup, with Auth deletion removed.
-- A different baseline must be reviewed; do not silently replay an old version.
do $baseline$
declare source text;
begin
 source:=pg_get_functiondef('public.delete_user_account(uuid)'::regprocedure);
 if md5(source)<>'2216cc828cb339debeeed40865d72d78' then
  raise exception 'ACCOUNT_ERASURE_BASELINE_CHANGED';
 end if;
 if position('delete from auth.users where id = p_user_id;' in source)=0 then
  raise exception 'ACCOUNT_ERASURE_AUTH_ANCHOR_MISSING';
 end if;
 source:=replace(source,'public.delete_user_account','account_erasure.erase_app_records');
 source:=replace(source,'delete from auth.users where id = p_user_id;','-- Auth is deleted last through the Auth Admin API.');
 execute source;
end $baseline$;
revoke all on function account_erasure.erase_app_records(uuid) from public,anon,authenticated,service_role;

-- An already issued access token can outlive sign-out. Application writes take
-- a shared transaction lock; acceptance takes its exclusive counterpart, then
-- installs the durable fence. No unrelated account or service actor is blocked.
create function account_erasure.assert_writable(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_user is null then return; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-erasure:'||p_user::text,0));
 if not exists(select 1 from auth.users where id=p_user and deleted_at is null) then
  raise exception 'ACCOUNT_ERASURE_IDENTITY_UNAVAILABLE' using errcode='42501';
 end if;
 if exists(select 1 from account_erasure.jobs where user_id=p_user and state<>'completed') then
  raise exception 'ACCOUNT_ERASURE_IN_PROGRESS' using errcode='42501';
 end if;
end $$;
create function account_erasure.guard_actor_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform account_erasure.assert_writable(auth.uid());
 return null;
end $$;
revoke all on function account_erasure.assert_writable(uuid),account_erasure.guard_actor_write() from public,anon,authenticated,service_role;
do $guards$
declare t record;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','creator_finance','marketplace_ops') and c.relkind='r'
 loop
  execute format('create trigger account_erasure_actor_write before insert or update or delete on %I.%I for each statement execute function account_erasure.guard_actor_write()',t.nspname,t.relname);
 end loop;
end $guards$;

-- Storage requests may have no user JWT when generated by a background worker.
-- Fence the real owner too. Reserved paths cannot be replaced, including after
-- an API delete and before acknowledgement; this protects against path reuse.
create function account_erasure.guard_storage_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_text text;
begin
 perform account_erasure.assert_writable(auth.uid());
 owner_text:=coalesce(new.owner_id,new.owner::text);
 if owner_text ~ '^[0-9a-fA-F-]{36}$' then
  perform account_erasure.assert_writable(owner_text::uuid);
 end if;
 if exists(select 1 from account_erasure.objects q join account_erasure.jobs j on j.id=q.job_id
   where q.bucket=new.bucket_id and q.path=new.name and j.state<>'completed') then
  raise exception 'ACCOUNT_ERASURE_OBJECT_RESERVED' using errcode='42501';
 end if;
 if tg_op='UPDATE' and exists(select 1 from account_erasure.objects q join account_erasure.jobs j on j.id=q.job_id
   where q.object_id=old.id and j.state<>'completed') then
  raise exception 'ACCOUNT_ERASURE_OBJECT_RESERVED' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function account_erasure.guard_storage_write() from public,anon,authenticated,service_role;
create trigger account_erasure_storage_write before insert or update on storage.objects
 for each row execute function account_erasure.guard_storage_write();

create function account_erasure.referenced_objects(p_user uuid) returns table(bucket text,path text)
language sql stable security definer set search_path='' as $$
 with entities as (
  select 'post'::text kind,id from public.posts where user_id=p_user
  union all select 'story',id from public.stories where user_id=p_user
  union all select 'story_draft',id from public.story_drafts where user_id=p_user
 ), urls as (
  select u.value url from entities e cross join lateral public.content_media_strings(public.content_media_document(e.kind,e.id)) u(value)
  union all select u.url from public.profiles p cross join lateral(values(p.avatar_url),(p.banner_url)) u(url) where p.id=p_user
  union all select u.url from public.messages m cross join lateral(values(m.media_url),(m.thumbnail_url)) u(url) where m.sender_id=p_user
  union all select u.url from public.media_assets m cross join lateral(values(m.url),(m.thumbnail_url)) u(url) where m.owner_id=p_user
  union all select url from public.story_sounds where owner_id=p_user
  union all select cv_url from public.job_applications where applicant_id=p_user
  union all select icon_url from public.channels where owner_id=p_user
  union all select media_url from public.channel_messages where sender_id=p_user
 ) select distinct loc[1],loc[2] from urls cross join lateral regexp_match(url,'^https://[^/]+/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/([^/]+)/([^?#]+)') loc;
$$;
revoke all on function account_erasure.referenced_objects(uuid) from public,anon,authenticated,service_role;

create function account_erasure.review_reason(p_user uuid) returns text
language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from public.chat_payments where sender_id=p_user or recipient_id=p_user)
  or exists(select 1 from creator_finance.ledger where user_id=p_user)
  or exists(select 1 from creator_finance.payouts where user_id=p_user)
  or exists(select 1 from creator_finance.payout_accounts where user_id=p_user)
  or exists(select 1 from creator_finance.balances where user_id=p_user)
  or exists(select 1 from marketplace_ops.orders where buyer_id=p_user or seller_id=p_user)
 then return 'financial_records'; end if;
 if exists(select 1 from public.admin_users where user_id=p_user)
  or exists(select 1 from public.business_profiles where owner_id=p_user or profile_id=p_user)
  or exists(select 1 from public.org_memberships where user_id=p_user and role in ('owner','admin'))
  or exists(select 1 from public.organizations where profile_id=p_user)
 then return 'managed_account'; end if;
 -- Legacy read provenance is not evidence of file ownership. Unknown owners,
 -- conflicting owner columns and uploads on behalf of another actor need review.
 if exists(select 1 from storage.objects o where
   (coalesce(o.owner_id,o.owner::text) is null and (
     split_part(o.name,'/',1)=p_user::text or split_part(o.name,'/',2)=p_user::text
     or exists(select 1 from content_media_legacy.snapshots l where l.object_id=o.id and l.author_id=p_user)
     or exists(select 1 from account_erasure.referenced_objects(p_user) r where r.bucket=o.bucket_id and r.path=o.name)))
   or ((o.owner_id=p_user::text or o.owner=p_user) and (
     (o.owner_id is not null and o.owner_id<>p_user::text)
     or (o.owner is not null and o.owner<>p_user)
     or o.version is null or o.version=''
     or length(o.name)>1024 or o.name ~ '(%|\\|[[:cntrl:]]|(^|/)\.\.?(/|$)|//)'
     or o.bucket_id not in ('post-media','story-media','media','chat-media','chat-files','avatars','market-media','mingle-images','mingle-media','business-media','startup-media','identity-training-photos','application-cvs','channel-media')
     or (split_part(o.name,'/',1) ~ '^[0-9a-fA-F-]{36}$' and split_part(o.name,'/',1)<>p_user::text and o.bucket_id<>'channel-media')
     or (o.bucket_id='channel-media' and split_part(o.name,'/',2)<>p_user::text)
     or exists(select 1 from public.content_media_bindings b where b.bucket_id=o.bucket_id and b.object_path=o.name and b.uploader_id<>p_user)
     or exists(select 1 from public.content_media_bindings b
      left join public.posts p on b.entity_kind='post' and p.id=b.entity_id
      left join public.stories s on b.entity_kind='story' and s.id=b.entity_id
      left join public.story_drafts d on b.entity_kind='story_draft' and d.id=b.entity_id
      where b.bucket_id=o.bucket_id and b.object_path=o.name and coalesce(p.user_id,s.user_id,d.user_id)<>p_user)
   ))) then return 'ownership_review'; end if;
 return null;
end $$;
revoke all on function account_erasure.review_reason(uuid) from public,anon,authenticated,service_role;

create function public.account_erasure_status(p_request_id uuid,p_receipt_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j account_erasure.jobs%rowtype;
begin
 if p_receipt_token is null or p_receipt_token !~ '^[0-9a-f]{64}$' then return null; end if;
 select * into j from account_erasure.jobs where id=p_request_id
  and receipt_digest=extensions.digest(p_receipt_token,'sha256');
 if not found then return null; end if;
 return jsonb_build_object('requestId',j.id,'state',j.state,'reason',j.reason,
  'requestedAt',j.created_at,'updatedAt',j.updated_at,'completedAt',j.completed_at,
  'filesTotal',j.object_count,'filesErased',j.deleted_count);
end $$;
revoke all on function public.account_erasure_status(uuid,text) from public;
grant execute on function public.account_erasure_status(uuid,text) to anon,authenticated;

create function public.request_account_erasure(p_request_id uuid,p_receipt_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare subject uuid:=auth.uid(); session_id uuid; reason text; j account_erasure.jobs%rowtype;
begin
 if subject is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
  or p_request_id is null or p_receipt_token is null or p_receipt_token !~ '^[0-9a-f]{64}$'
 then raise exception 'ACCOUNT_ERASURE_AUTH_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-erasure:'||subject::text,0));
 select * into j from account_erasure.jobs where id=p_request_id;
 if found then
  if j.user_id=subject and j.receipt_digest=extensions.digest(p_receipt_token,'sha256') then
   return public.account_erasure_status(p_request_id,p_receipt_token);
  end if;
  raise exception 'ACCOUNT_ERASURE_REQUEST_CONFLICT' using errcode='42501';
 end if;
 begin session_id:=(auth.jwt()->>'session_id')::uuid; exception when others then session_id:=null; end;
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=session_id and s.user_id=subject and (s.not_after is null or s.not_after>clock_timestamp())
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()))
 then raise exception 'ACCOUNT_ERASURE_SESSION_REQUIRED' using errcode='42501'; end if;
 if exists(select 1 from account_erasure.jobs where user_id=subject) then
  raise exception 'ACCOUNT_ERASURE_ALREADY_REQUESTED'; end if;
 if not exists(select 1 from account_erasure.worker where secret_digest is not null and last_seen_at>clock_timestamp()-interval '15 minutes') then
  raise exception 'ACCOUNT_ERASURE_TEMPORARILY_UNAVAILABLE'; end if;
 reason:=account_erasure.review_reason(subject);
 if reason is null then
  -- Validate every deployed application FK/trigger before erasing bytes. This
  -- subtransaction is always rolled back. No Auth or Storage API call occurs.
  begin
   perform account_erasure.erase_app_records(subject);
   raise sqlstate 'PE001';
  exception when sqlstate 'PE001' then null;
   when others then reason:='application_review';
  end;
 end if;
 update public.profiles set deactivated_at=coalesce(deactivated_at,clock_timestamp()) where id=subject;
 update auth.users set banned_until='infinity',updated_at=clock_timestamp() where id=subject;
 delete from auth.sessions where user_id=subject;
 insert into account_erasure.jobs(id,user_id,receipt_digest,state,reason)
 values(p_request_id,subject,extensions.digest(p_receipt_token,'sha256'),case when reason is null then 'queued' else 'retention_review' end,reason);
 if reason is null then
  insert into account_erasure.objects(job_id,object_id,bucket,path,version)
  select p_request_id,o.id,o.bucket_id,o.name,o.version from storage.objects o
  where coalesce(o.owner_id,o.owner::text)=subject::text;
  update account_erasure.jobs set object_count=(select count(*) from account_erasure.objects where job_id=p_request_id) where id=p_request_id;
 end if;
 insert into account_erasure.events(job_id,event) values(p_request_id,'requested');
 return public.account_erasure_status(p_request_id,p_receipt_token);
end $$;
revoke all on function public.request_account_erasure(uuid,text) from public,anon,service_role;
grant execute on function public.request_account_erasure(uuid,text) to authenticated;

-- An old client must not report success after merely deleting account rows.
create or replace function public.delete_user_account(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin raise exception 'ACCOUNT_ERASURE_REQUIRED: Update Platinum Circles to request complete account deletion.'; end $$;
revoke all on function public.delete_user_account(uuid) from public,anon,service_role;
grant execute on function public.delete_user_account(uuid) to authenticated;

create function public.validate_account_erasure_worker(p_token text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if p_token is null or p_token !~ '^pc_erase_[0-9a-f]{64}$' then return false; end if;
 return exists(select 1 from account_erasure.worker where secret_digest=extensions.digest(p_token,'sha256'));
end $$;
create function public.claim_account_erasure(p_worker uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j account_erasure.jobs%rowtype;
begin
 if p_worker is null then raise exception 'Worker required'; end if;
 update account_erasure.worker set last_seen_at=clock_timestamp() where singleton;
 -- Completed receipts are bounded technical recovery records, not identity
 -- records. Pending/review requests are retained until an operator resolves them.
 delete from account_erasure.jobs where state='completed' and completed_at<clock_timestamp()-interval '30 days';
 select * into j from account_erasure.jobs
  where state in ('queued','erasing','retry','identity_pending') and available_at<=clock_timestamp()
   and (lease_until is null or lease_until<clock_timestamp())
  order by available_at,created_at for update skip locked limit 1;
 if not found then return null; end if;
 if j.lease_until is not null then
  update account_erasure.jobs set attempts=attempts+1,last_error='lease_expired',updated_at=clock_timestamp() where id=j.id;
  if j.attempts>=11 then
   update account_erasure.jobs set state='retention_review',reason='worker_review',lease_token=null,lease_until=null where id=j.id;
   insert into account_erasure.events(job_id,event) values(j.id,'review'); return null;
  end if;
 end if;
 update account_erasure.jobs set lease_token=p_worker,lease_until=clock_timestamp()+interval '5 minutes',
  state=case when state='identity_pending' then state else 'erasing' end,updated_at=clock_timestamp()
  where id=j.id returning * into j;
 insert into account_erasure.events(job_id,event) values(j.id,'claimed');
 return jsonb_build_object('id',j.id,'userId',j.user_id,'state',j.state,'leaseToken',p_worker,
  'objects',coalesce((select jsonb_agg(jsonb_build_object('id',q.object_id,'bucket',q.bucket,'path',q.path,'version',q.version))
   from(select * from account_erasure.objects where job_id=j.id and erased_at is null order by object_id limit 25) q),'[]'::jsonb));
end $$;

create function public.check_account_erasure_object(p_job uuid,p_worker uuid,p_object uuid) returns text
language plpgsql security definer set search_path='' as $$
declare j account_erasure.jobs%rowtype; q account_erasure.objects%rowtype; o storage.objects%rowtype;
begin
 select * into j from account_erasure.jobs where id=p_job and lease_token=p_worker and lease_until>clock_timestamp() and state='erasing' for update;
 if not found then return 'stale'; end if;
 select * into q from account_erasure.objects where job_id=p_job and object_id=p_object;
 if not found or q.erased_at is not null then return 'stale'; end if;
 select * into o from storage.objects where bucket_id=q.bucket and name=q.path;
 if not found then return 'absent'; end if;
 if o.id<>q.object_id or o.version is distinct from q.version or coalesce(o.owner_id,o.owner::text) is distinct from j.user_id::text then
  update account_erasure.jobs set state='retention_review',reason='storage_changed',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
  insert into account_erasure.events(job_id,event) values(j.id,'review');
  return 'changed';
 end if;
 return 'delete';
end $$;

create function public.ack_account_erasure_object(p_job uuid,p_worker uuid,p_object uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare q account_erasure.objects%rowtype;
begin
 perform 1 from account_erasure.jobs where id=p_job and lease_token=p_worker and lease_until>clock_timestamp() and state='erasing' for update;
 if not found then return false; end if;
 select * into q from account_erasure.objects where job_id=p_job and object_id=p_object for update;
 if not found then return false; end if;
 if q.erased_at is not null then return true; end if;
 -- API success alone is insufficient: the registered object must be absent.
 if exists(select 1 from storage.objects where id=q.object_id or (bucket_id=q.bucket and name=q.path)) then return false; end if;
 update account_erasure.objects set erased_at=clock_timestamp() where job_id=p_job and object_id=p_object;
 -- Storage deletion invalidates all CDN token variants. Supabase documents up
 -- to60 seconds propagation; do not finish before that interval has elapsed.
 update account_erasure.jobs set deleted_count=deleted_count+1,cache_until=clock_timestamp()+interval '65 seconds',updated_at=clock_timestamp() where id=p_job;
 return true;
end $$;

create function public.prepare_account_erasure_identity(p_job uuid,p_worker uuid) returns text
language plpgsql security definer set search_path='' as $$
declare j account_erasure.jobs%rowtype; v_reason text;
begin
 select * into j from account_erasure.jobs where id=p_job and lease_token=p_worker and lease_until>clock_timestamp()
  and state in ('erasing','identity_pending') for update;
 if not found then return 'stale'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-erasure:'||j.user_id::text,0));
 if exists(select 1 from account_erasure.objects where job_id=j.id and erased_at is null) then return 'more'; end if;
 if j.cache_until>clock_timestamp() then return 'cache_wait';end if;
 if exists(select 1 from storage.objects where coalesce(owner_id,owner::text)=j.user_id::text) then v_reason:='storage_changed';
 else v_reason:=account_erasure.review_reason(j.user_id); end if;
 if v_reason is null and j.state<>'identity_pending' then
  begin perform account_erasure.erase_app_records(j.user_id);
  exception when others then v_reason:='application_review'; end;
 end if;
 if v_reason is not null then
  update account_erasure.jobs set state='retention_review',reason=v_reason,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
  insert into account_erasure.events(job_id,event) values(j.id,'review'); return 'review';
 end if;
 update account_erasure.jobs set state='identity_pending',updated_at=clock_timestamp() where id=j.id;
 insert into account_erasure.events(job_id,event) values(j.id,'identity_pending');
 return 'ready';
end $$;

create function public.finish_account_erasure(p_job uuid,p_worker uuid,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j account_erasure.jobs%rowtype;
begin
 select * into j from account_erasure.jobs where id=p_job and lease_token=p_worker and lease_until>clock_timestamp()
  and state in ('erasing','identity_pending') for update;
 if not found then return false; end if;
 if p_error is null and j.state='identity_pending' then
  if exists(select 1 from auth.users where id=j.user_id)
   or exists(select 1 from storage.objects where coalesce(owner_id,owner::text)=j.user_id::text)
   or exists(select 1 from account_erasure.objects where job_id=j.id and erased_at is null) then return false; end if;
  delete from account_erasure.objects where job_id=j.id;
  update account_erasure.jobs set state='completed',user_id=null,lease_token=null,lease_until=null,last_error=null,
   completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
  insert into account_erasure.events(job_id,event) values(j.id,'completed'); return true;
 end if;
 if p_error is null then
  update account_erasure.jobs set state='queued',lease_token=null,lease_until=null,available_at=greatest(coalesce(cache_until,clock_timestamp()),clock_timestamp()),updated_at=clock_timestamp() where id=j.id;
  return true;
 end if;
 if p_error not in ('storage_unavailable','storage_not_erased','identity_unavailable','lease_expired','application_review') then raise exception 'Invalid failure code'; end if;
 update account_erasure.jobs set attempts=attempts+1,last_error=p_error,
  state=case when attempts>=11 then 'retention_review' when state='identity_pending' then state else 'retry' end,
  reason=case when attempts>=11 then 'worker_review' else reason end,
  available_at=clock_timestamp()+make_interval(secs=>least(21600,30*(2^least(attempts,10))::integer)),
  lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
 insert into account_erasure.events(job_id,event) values(j.id,'retry');
 return true;
end $$;

revoke all on function public.validate_account_erasure_worker(text),public.claim_account_erasure(uuid),
 public.check_account_erasure_object(uuid,uuid,uuid),public.ack_account_erasure_object(uuid,uuid,uuid),
 public.prepare_account_erasure_identity(uuid,uuid),public.finish_account_erasure(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.validate_account_erasure_worker(text),public.claim_account_erasure(uuid),
 public.check_account_erasure_object(uuid,uuid,uuid),public.ack_account_erasure_object(uuid,uuid,uuid),
 public.prepare_account_erasure_identity(uuid,uuid),public.finish_account_erasure(uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;
