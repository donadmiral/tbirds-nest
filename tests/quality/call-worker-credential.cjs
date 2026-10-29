const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('../../supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite');
const {pgcrypto}=require('../../supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.cjs');
const migration=fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261023190325_scoped_call_worker_credential.sql'),'utf8');
test('worker credential stays in Vault, persists across reruns, and exposes only a service-role boolean check',async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE SCHEMA extensions;CREATE SCHEMA vault;
   CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text UNIQUE,secret text);
   CREATE VIEW vault.decrypted_secrets AS SELECT id,name,secret AS decrypted_secret FROM vault.secrets;
   CREATE FUNCTION vault.create_secret(new_secret text,new_name text,new_description text) RETURNS uuid LANGUAGE plpgsql AS $$DECLARE id uuid;BEGIN INSERT INTO vault.secrets(name,secret) VALUES(new_name,new_secret) RETURNING secrets.id INTO id;RETURN id;END;$$;`);
  await db.exec(migration);
  const metrics=(await db.query(`SELECT s.decrypted_secret ~ '^pc_call_[0-9a-f]{64}$' AS generated,
    public.validate_call_worker_token(s.decrypted_secret) AS valid,
    octet_length(c.secret_digest) AS hash_bytes
    FROM vault.decrypted_secrets s CROSS JOIN private.call_worker_credentials c WHERE s.name='call_reconcile_secret'`)).rows;
  assert.deepEqual(metrics,[{generated:true,valid:true,hash_bytes:32}]);
  await db.exec('CREATE TEMP TABLE prior_credential AS SELECT secret_digest FROM private.call_worker_credentials');
  await db.exec(migration);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM vault.secrets')).rows[0].count,1);
  assert.equal((await db.query('SELECT p.secret_digest=c.secret_digest AS same FROM prior_credential p CROSS JOIN private.call_worker_credentials c')).rows[0].same,true);
  // A synthetic fixture exercises valid service-role calls without extracting
  // the generated Vault token from SQL into a test result or log.
  const fixture='fixture-only-worker-token-never-a-live-credential';
  await db.query("UPDATE vault.secrets SET secret=$1 WHERE name='call_reconcile_secret'",[fixture]);
  await db.exec(migration);
  for(const role of ['anon','authenticated']){
   await db.exec(`SET ROLE ${role}`);
   await assert.rejects(db.query('SELECT public.validate_call_worker_token($1)',[fixture]),/permission denied/);
   await assert.rejects(db.query('SELECT * FROM private.call_worker_credentials'),/permission denied/);
   await assert.rejects(db.query('SELECT * FROM vault.decrypted_secrets'),/permission denied/);
   await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  assert.equal((await db.query('SELECT public.validate_call_worker_token($1) AS valid',[fixture])).rows[0].valid,true);
  for(const token of [null,'','service-role-key','x'.repeat(512),'x'.repeat(513),fixture+'wrong']){
   assert.equal((await db.query('SELECT public.validate_call_worker_token($1) AS valid',[token])).rows[0].valid,false);
  }
  await assert.rejects(db.query('SELECT * FROM private.call_worker_credentials'),/permission denied/);
  await assert.rejects(db.query('SELECT * FROM vault.decrypted_secrets'),/permission denied/);
 } finally {await db.close();}
});
