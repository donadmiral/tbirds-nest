#!/usr/bin/env node
// Operator preparation only. Generates synthetic media and exact SQL files;
// never connects to a database, provider, AWS, or a real user account.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateFixture } from './generate-live-cdn-fixture.mjs';

const origin = 'https://prlkikhckbifseosbukl.supabase.co';
export function smokeSql({ actor, authSession, createRequest, clipRequest }) {
  if (![actor, authSession, createRequest, clipRequest].every(x => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x))) throw Error('INVALID_FIXTURE_IDS');
  const declarations = `actor constant uuid := '${actor}'; auth_session constant uuid := '${authSession}'; create_request constant uuid := '${createRequest}'; clip_request constant uuid := '${clipRequest}';`;
  const claims = `perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','session_id',auth_session,'aal','aal1','is_anonymous',false)::text,true);
 execute 'set local role authenticated';`;
  const locate = `select (cmd.result->>'session_id')::uuid into sid from live_streams.commands cmd where cmd.actor_id=actor and cmd.request_id=create_request and cmd.action='create';
 if sid is null or not exists(select 1 from auth.users where id=actor and raw_user_meta_data->>'renderer_fixture'=actor::text)
 or not exists(select 1 from live_streams.sessions where id=sid and host_id=actor and audience='invite' and state='ended' and recording_enabled)
 then raise exception 'FIXTURE_IDENTITY_MISMATCH'; end if;`;
  const wrap = (body, select) => `-- Generated operator fixture. Review before executing against production. No real user or public post.\nbegin;\nset local statement_timeout='30s';\nset local lock_timeout='3s';\n${body}\n${select}\ncommit;\n`;
  return {
    prepare: wrap(`do $fixture$
declare ${declarations} result jsonb; sid uuid; instance uuid; prefix text;
begin
 if not exists(select 1 from live_streams.clip_runtime where singleton and enabled=false and project_origin='${origin}')
 or public.live_clip_queue_peek()->>'due'<>'false' or public.live_clip_queue_peek()->>'active'<>'0'
 then raise exception 'FIXTURE_EXPECTS_DISABLED_IDLE_RENDER_QUEUE'; end if;
 insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
 values(actor,'live-renderer-'||actor::text||'@example.invalid',jsonb_build_object('full_name','Synthetic renderer fixture','username','lr_'||substr(replace(actor::text,'-',''),1,20),'renderer_fixture',actor::text),'{"provider":"email","providers":["email"]}');
 insert into public.profiles(id,email,username,full_name,profile_visibility,account_type)
 values(actor,'live-renderer-'||actor::text||'@example.invalid','lr_'||substr(replace(actor::text,'-',''),1,20),'Synthetic renderer fixture','private','personal')
 on conflict(id) do update set username=excluded.username,full_name=excluded.full_name,profile_visibility='private',account_type='personal';
 insert into auth.sessions(id,user_id,aal) values(auth_session,actor,'aal1');
 ${claims}
 result:=public.live_command('create',null,jsonb_build_object('title','Private synthetic renderer acceptance','description','Disposable synthetic tone and color; no provider broadcast','topic','other','audience','invite','recording_enabled',true),create_request);
 sid:=(result->>'session_id')::uuid;
 if result->>'ok' is distinct from 'true' or sid is null then raise exception 'FIXTURE_CREATE_FAILED'; end if;
 execute 'reset role';
 select instance_id into strict instance from live_streams.provider_sessions where session_id=sid;
 prefix:='live/'||sid::text||'/'||instance::text||'/';
 -- This isolated fixture represents a completed synthetic recording. It does
 -- not call Daily, issue a start command, or change any provider readiness gate.
 update live_streams.sessions set state='ended',started_at=now()-interval '3 seconds',ended_at=now(),replay_available=true where id=sid and host_id=actor;
 update live_streams.provider_sessions set playback_path=prefix||'master.m3u8',replay_path=prefix||'master.m3u8' where session_id=sid;
 perform set_config('pc.renderer_fixture_receipt',jsonb_build_object('actor_id',actor,'auth_session_id',auth_session,'session_id',sid,'instance_id',instance,'source_prefix',prefix,'duration_ms',3000,'provider_started',false,'public_publication',false)::text,true);
end $fixture$;`, `select current_setting('pc.renderer_fixture_receipt')::jsonb as fixture;`),
    enqueue: wrap(`do $fixture$
declare ${declarations} sid uuid; result jsonb; repeated jsonb; spec jsonb := '{"title":"Synthetic two-second clip","caption":"Disposable renderer acceptance","tags":[],"start_ms":0,"end_ms":2000,"cover_ms":500,"formats":["horizontal","vertical"],"watermark":true,"brand_text":"Platinum Circles","burn_captions":true,"subtitles":[{"start_ms":0,"end_ms":1800,"text":"Synthetic renderer acceptance"}]}'::jsonb;
begin
 ${locate}
 if not exists(select 1 from live_streams.clip_runtime where singleton and enabled and max_active between 1 and 2 and project_origin='${origin}') then raise exception 'RENDERER_NOT_EXPLICITLY_ENABLED'; end if;
 ${claims}
 result:=public.live_clip_command(sid,null,'create',spec,clip_request);
 repeated:=public.live_clip_command(sid,null,'create',spec,clip_request);
 if result->>'ok' is distinct from 'true' or repeated->>'clip_id' is distinct from result->>'clip_id' or repeated->>'duplicate' is distinct from 'true' then raise exception 'FIXTURE_CLIP_CREATE_NOT_IDEMPOTENT'; end if;
 execute 'reset role';
 perform set_config('pc.renderer_fixture_receipt',jsonb_build_object('actor_id',actor,'session_id',sid,'clip_id',result->>'clip_id','command_idempotency_verified',true,'render_completion_verified',false)::text,true);
end $fixture$;`, `select current_setting('pc.renderer_fixture_receipt')::jsonb as fixture;`),
    inspect: `-- Read-only, exact synthetic actor. A queued result is not acceptance.
select c.id as clip_id,c.state,c.error_code,c.moderation_state,c.copyright_state,j.state as job_state,j.attempts,
 c.manifest->>'duration_ms' as duration_ms,c.manifest->'assets' as assets,
 (select count(*) from storage.objects o where o.bucket_id='live-clips' and o.name=any(array[c.output_prefix||'horizontal.mp4',c.output_prefix||'vertical.mp4',c.output_prefix||'thumbnail.jpg',c.output_prefix||'captions.vtt'])
 and o.user_metadata->>'live_clip_id'=c.id::text and o.user_metadata->>'live_clip_job_id'=j.id::text and o.user_metadata->>'live_clip_lease_id'=c.current_lease::text) as current_lease_stored_assets,
 (select count(*) from live_streams.clip_publications p where p.clip_id=c.id) as publication_count
from live_streams.clips c join live_streams.clip_jobs j on j.clip_id=c.id and j.revision=c.render_revision
join auth.users u on u.id=c.creator_id where c.creator_id='${actor}' and u.raw_user_meta_data->>'renderer_fixture'='${actor}';
`,
    cleanup: wrap(`do $fixture$
declare ${declarations} sid uuid;
begin
 ${locate}
 if exists(select 1 from live_streams.clip_jobs j join live_streams.clips c on c.id=j.clip_id where c.creator_id=actor and j.state='leased' and j.lease_until>now())
 or exists(select 1 from live_streams.clip_publications p join live_streams.clips c on c.id=p.clip_id where c.creator_id=actor)
 or (select count(*) from live_streams.sessions where host_id=actor)<>1
 then raise exception 'FIXTURE_CLEANUP_REQUIRES_STOPPED_UNPUBLISHED_ISOLATED_JOB'; end if;
 -- The existing clip deletion trigger schedules exact output-object cleanup
 -- after its signed-upload capability window. Do not shorten that delay.
 delete from live_streams.sessions where id=sid and host_id=actor;
 delete from auth.sessions where id=auth_session and user_id=actor;
 delete from public.profiles where id=actor;
 delete from auth.users where id=actor and raw_user_meta_data->>'renderer_fixture'=actor::text;
end $fixture$;`, `select not exists(select 1 from auth.users where id='${actor}') as fixture_identity_removed,
 (select count(*) from live_streams.clip_cleanup where split_part(object_path,'/',1)='${actor}' and state<>'done') as output_cleanup_pending;
-- Remove the five exact S3 source object versions recorded by the operator;
-- this database transaction cannot remove AWS objects. Keep their receipt.
`),
  };
}

export async function prepareQueueSmoke({ bucket, directory }) {
  const generated = await generateFixture({ bucket, directory });
  const folder = dirname(generated.fixture_file);
  const ids = { actor: randomUUID(), authSession: randomUUID(), createRequest: randomUUID(), clipRequest: randomUUID() };
  const sql = smokeSql(ids), files = {};
  for (const [phase, content] of Object.entries(sql)) {
    const filename = join(folder, `renderer-${phase}.sql`);
    await writeFile(filename, content, { mode: 0o600 }); files[phase] = filename;
  }
  const plan = { schema_version: 1, purpose: 'private_synthetic_durable_renderer_acceptance', production_origin: origin,
    media_duration_ms: 3000, clip_duration_ms: 2000, expected_output_assets: 4, actor_id: ids.actor,
    upload_mapping: 'For each file, use prepare.sql receipt.source_prefix + relative_path. The media generator original storage_path is not this database fixture.',
    bucket, region: 'us-east-2', sql: files,
    upload_files: generated.fixture.files.map(({ relative_path, local_path, size, sha256, content_type, cache_control }) => ({ relative_path, local_path, size, sha256, content_type, cache_control })),
    phases: ['Accepted image and healthy finite worker; schedule initially disabled; clip queue idle/disabled.',
      'Execute prepare SQL once; persist its exact source_prefix and fixture IDs.',
      'Upload only the five listed synthetic files to that source_prefix in the private Live bucket; save every returned VersionId.',
      'Explicit operator live_clip_configure(production_origin,true,2), then execute enqueue SQL. Other provider/OAuth/ASR gates stay unchanged.',
      'Enable the reviewed renderer-only scheduler. It claims and completes the real job; never manually finish or insert Storage metadata.',
      'Inspect exact task digest/logs and inspect SQL. Require ready/done, four current-lease objects, horizontal1280x720/vertical720x1280,2000ms±150, zero publications.',
      'After the fixture worker is stopped and no lease is active, execute cleanup SQL and delete only the five source object versions. Existing output cleanup delay is preserved.'],
    cloud_mutations_performed: false, media_contains_real_users: false, public_post_created: false,
    limitations: ['Synthetic renderer/queue/scheduler acceptance only; it does not prove Daily broadcasting, long clips, native playback, or five-million-user capacity.'] };
  const filename = join(folder, 'renderer-queue-plan.json');
  await writeFile(filename, JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 });
  return { plan_file: filename, sql_files: files, actor_id: ids.actor };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node prepare-renderer-queue-smoke.mjs --bucket <actual-private-live-bucket> [--directory /scratch/parent]\nLocal preparation only; review each production operator phase before execution.\n');
  } else {
    try {
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        if (!['--bucket', '--directory'].includes(args[i]) || !args[i + 1] || args[i] in options) throw Error('INVALID_ARGUMENT');
        options[args[i]] = args[i + 1];
      }
      process.stdout.write(JSON.stringify(await prepareQueueSmoke({ bucket: options['--bucket'], directory: options['--directory'] }), null, 2) + '\n');
    } catch { process.stderr.write('Renderer smoke preparation failed; no hosted action performed.\n'); process.exitCode = 1; }
  }
}
