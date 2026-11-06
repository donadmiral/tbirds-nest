-- QA-only operator canary. Capture the final row in private process memory.
-- It contains a 45-second media capability and must never enter logs/receipts.
begin;
set local lock_timeout='2s';
set local statement_timeout='8s';
do $canary$
declare actor uuid; sid uuid; candidate record; ticket record; origin text; expected text; accepted text;
  deadline timestamptz; grant_data jsonb; prepared boolean:=false;
begin
  select p.id,s.id into actor,sid from public.profiles p join auth.users u on u.id=p.id join auth.sessions s on s.user_id=p.id
  where p.username='musa' and p.full_name='Musa Test' and p.account_type='personal'
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<now())
    and (s.not_after is null or s.not_after>now()+interval '5 minutes')
  order by s.created_at desc limit 1;
  if actor is null or sid is null then raise exception 'CANARY_KNOWN_TEST_SESSION_REQUIRED';end if;
  select gateway_origin into origin from media_renditions.settings where singleton and delivery_enabled and not emergency_revoke;
  if origin is null then raise exception 'CANARY_GATEWAY_REQUIRED';end if;
  perform set_config('request.jwt.claim.sub',actor::text,true),set_config('request.jwt.claim.role','authenticated',true),
    set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','session_id',sid,'aal','aal1','is_anonymous',false)::text,true);
  for candidate in
    select j.*,b.entity_kind,b.entity_id from media_renditions.jobs j
    join media_renditions.publications pub on pub.job_id=j.id and pub.active
    join media_renditions.assets a on a.lease_id=pub.lease_id and a.name='r0/seg00000.ts' and a.bytes<=2097152
    join public.content_media_bindings b on b.bucket_id=j.source_bucket and b.object_path=j.source_path and b.uploader_id=actor
    where j.source_owner=actor and j.state='ready' and j.source_bucket in ('post-media','story-media')
      and b.entity_kind in ('post','story') and j.source_bytes<=33554432
    order by j.source_bytes,j.id limit 8
  loop
    if media_renditions.source_snapshot(candidate.source_id,candidate.source_version) is null then continue;end if;
    expected:='https://uaulhuelcfkjwojtymmw.supabase.co/storage/v1/object/public/'||candidate.source_bucket||'/'||candidate.source_path;
    accepted:=null;
    execute 'set local role authenticated';
    select media_url into accepted from public.content_media_manifest(jsonb_build_array(jsonb_build_object('kind',candidate.entity_kind,'id',candidate.entity_id))) where media_url=expected limit 1;
    execute 'reset role';
    if accepted is null then continue;end if;
    select * into ticket from media_delivery.issue(accepted,candidate.entity_kind,candidate.entity_id,sid);
    if ticket.token is null then continue;end if;
    deadline:=clock_timestamp()+interval '45 seconds';
    update media_delivery.tickets set expires_at=deadline where token_digest=extensions.digest(ticket.token,'sha256') and user_id=actor and session_id=sid;
    perform set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
    grant_data:=public.resolve_media_delivery(ticket.token,ticket.bucket_id,ticket.object_path);
    if grant_data is null or grant_data->>'version'<>candidate.source_version then raise exception 'CANARY_ACCESS_CHANGED';end if;
    perform set_config('pc.adaptive_canary',jsonb_build_object('projectRef','uaulhuelcfkjwojtymmw','gatewayOrigin',origin,
      'bucket',ticket.bucket_id,'path',ticket.object_path,'sourceVersion',candidate.source_version,'token',ticket.token,
      'expiresAt',deadline,'cleanupDigest',encode(extensions.digest(ticket.token,'sha256'),'hex'))::text,true);
    prepared:=true;exit;
  end loop;
  if not prepared then raise exception 'CANARY_SMALL_READY_OWNED_SOURCE_REQUIRED';end if;
end $canary$;
select current_setting('pc.adaptive_canary')::jsonb as private_canary_config;
commit;
