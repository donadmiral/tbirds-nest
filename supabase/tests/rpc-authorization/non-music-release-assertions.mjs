import assert from 'node:assert/strict';

// Compare the existing catalogue itself, its permissions, and all named music
// objects. This is stronger than merely checking that a feature flag is off.
export async function captureMusicState(db) {
  const queries = {
    relations: `select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relacl::text
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname ~ '(sound|music)' order by c.relname`,
    columns: `select table_schema,table_name,column_name,data_type,is_nullable,column_default
      from information_schema.columns where table_schema='public'
      and (table_name ~ '(sound|music)' or column_name ~ '(audio|soundtrack|music)')
      order by table_name,ordinal_position`,
    constraints: `select conname,pg_get_constraintdef(oid) as definition
      from pg_constraint where conrelid='public.story_sounds'::regclass order by conname`,
    policies: `select policyname,permissive,roles,cmd,qual,with_check
      from pg_policies where schemaname='public' and tablename='story_sounds' order by policyname`,
    functions: `select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
      pg_get_functiondef(p.oid) as definition,p.proacl::text as permissions
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname ~ '(sound|music)' order by p.proname,arguments`,
    triggers: `select tgname,pg_get_triggerdef(oid) as definition from pg_trigger
      where tgrelid='public.story_sounds'::regclass and not tgisinternal order by tgname`,
    rows: 'select to_jsonb(s) as row from public.story_sounds s order by id',
  };
  const state = {};
  for (const [key, sql] of Object.entries(queries)) state[key] = (await db.query(sql)).rows;
  return state;
}

export async function assertMusicUnchanged(db, before) {
  assert.deepEqual(await captureMusicState(db), before, 'Excluded music schema, data or permissions changed');
  const absent = [
    'public.validate_soundtrack(jsonb,text)',
    'public.resolve_story_soundtrack(jsonb)',
    'public.save_memory_book_design(uuid,text,text,text,text,jsonb)',
    'public.content_media_manifest_before_sound_rights(jsonb)',
  ];
  for (const signature of absent) {
    assert.equal((await db.query('select to_regprocedure($1) as rpc', [signature])).rows[0].rpc, null, signature);
  }
  for (const name of ['music_rights', 'music_catalog']) {
    assert.equal((await db.query('select to_regnamespace($1) as schema', [name])).rows[0].schema, null, name);
  }
}
