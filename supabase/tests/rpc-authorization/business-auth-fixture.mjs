import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';
import {readCandidate} from './migration-source.mjs';

// Same deployed baseline and reviewed forward migrations used by the Studio
// regression suite. This fixture intentionally starts before business sessions
// exist; upgrading installed business clients is an explicit rollout gate.
export async function loadBusinessAuthBaseline(db,qaMode=false){
 await loadDeployedMediaBaseline(db);await db.exec(await readCandidate());
 await db.exec(await source('supabase/migrations/20261029224550_admin_operations_completion.sql'));
 if(qaMode){
  await(await import('./qa-admin-baseline.mjs')).installQaAdminBaseline(db);
  await(await import('./qa-media-baseline.mjs')).installQaMediaBaseline(db);
  await db.exec(await source('supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql'));
  await db.exec(await source('supabase/ops/qa/20261029233915_qa_media_completion_forward.sql'));
  for(const name of ['20261029224812_account_storage_erasure','20261029231321_account_erasure_admin_review_queue'])await db.exec(await source(`supabase/migrations/${name}.sql`));
  await(await import('./qa-database-hardening-baseline.mjs')).installQaHardeningAclBaseline(db);
  await db.exec(await source('supabase/ops/qa/20261029235400_qa_database_access_hardening_forward.sql'));
  await db.exec('revoke all on function public.upsert_link_preview(text,text,text,text,text) from public,postgres,anon,authenticated,service_role;grant execute on function public.upsert_link_preview(text,text,text,text,text) to postgres,public,anon,authenticated,service_role');
 }else{
  for(const name of ['20261029224812_account_storage_erasure','20261029224813_private_media_cutover_compatibility','20261029231321_account_erasure_admin_review_queue','20261029231440_bounded_media_delivery'])await db.exec(await source(`supabase/migrations/${name}.sql`));
  for(const name of ['notify_push_notification','notify_voip_ring','notify_voip_ring_1to1','notify_voip_ring_session'])await db.exec(`create function public.${name}() returns trigger language plpgsql security definer set search_path=public as $$begin return new;end$$;revoke all on function public.${name}() from public,postgres,anon,authenticated,service_role;grant execute on function public.${name}() to public,postgres,anon,authenticated,service_role`);
  await db.exec(await source('supabase/migrations/20261029234214_database_access_hardening.sql'));
 }
 // The shared lightweight Auth fixture omits created_at; match the inspected
 // hosted column (nullable timestamptz, no default) before exercising issuance.
 await db.exec('alter role service_role bypassrls;create role authenticator;alter table auth.sessions add column created_at timestamptz');
 for(const name of ['20261030000331_link_preview_verified_cache','20261030005241_account_erasure_operator_review','20261030010250_account_erasure_admin_restore_guard','20261030012831_staff_social_shells','20261030024125_studio_editorial_and_partnership_workflows','20261030031124_reserve_web_route_usernames','20261030033214_reserve_business_provision_usernames'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 await db.exec("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims','{}',false)");
}
