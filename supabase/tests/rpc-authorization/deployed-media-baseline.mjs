import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadLiveSchema } from './live-schema-fixture.mjs';

export const root = new URL('../../../', import.meta.url);
export const source = path => readFile(new URL(path, root), 'utf8');
export async function loadDeployedMediaBaseline(db) {
  await loadLiveSchema(db);
  await db.exec(`alter table auth.users add column if not exists created_at timestamptz default now();
    alter table storage.objects add column if not exists version text;
    alter table storage.objects add column if not exists user_metadata jsonb;
    create unique index storage_object_path_fixture on storage.objects(bucket_id,name);
    grant usage on schema auth,storage to authenticated,anon,service_role;
    grant select,insert,update,delete on storage.objects to authenticated,anon;
    insert into storage.buckets(id,name,public) values
    ('chat-media','chat-media',true),('chat-files','chat-files',true),
    ('post-media','post-media',true),('story-media','story-media',true),('media','media',true),
    ('avatars','avatars',true),('market-media','market-media',true),
    ('application-cvs','application-cvs',false),('channel-media','channel-media',false);`);
  let units = 0;
  for (const path of ['supabase/ops/production-rollout-20261029.json', 'supabase/ops/parity-rollout-20261029.json']) {
    for (const unit of JSON.parse(await source(path)).units) {
      const sql = [];
      for (const file of unit.files) {
        const text = await source(file.path);
        assert.equal(createHash('sha256').update(text).digest('hex'), file.sha256, file.path);
        sql.push(text);
      }
      await db.exec(sql.join('\n')); units++;
    }
  }
  assert.equal(units, 25);
  for (const name of ['20261025073234_applicant_self_service_quality', '20261029190200_comment_author_highlights',
    '20261023185734_redacted_client_diagnostics', '20261029213000_admin_support_review_contracts']) {
    await db.exec(await source(`supabase/migrations/${name}.sql`));
  }
  return { units, repairs: 4 };
}
