const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  PGlite,
} = require("./rpc-authorization/node_modules/@electric-sql/pglite");
const {
  pgcrypto,
} = require("./rpc-authorization/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.cjs");
const setup = fs.readFileSync(
  path.join(__dirname, "../ops/setup-private-media-cleanup-credential.sql"),
  "utf8",
);
test("cleanup credential is generated server-side, stored as a digest, reusable without rotation, and callable only by the worker", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema vault;create table vault.secrets(id uuid default gen_random_uuid(),name text,secret text);create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;create function vault.create_secret(p_secret text,p_name text,p_description text) returns uuid language sql as $$insert into vault.secrets(name,secret) values(p_name,p_secret) returning id$$;`,
    );
    await db.exec(setup);
    const first = (await db.query("select secret from vault.secrets")).rows[0]
      .secret;
    assert.ok(first.startsWith("pc_private_"));
    assert.ok(first.length >= 64);
    const stored = (
      await db.query(
        "select octet_length(secret_digest) n from private.private_media_cleanup_credentials",
      )
    ).rows[0];
    assert.equal(stored.n, 32);
    await db.exec(setup);
    assert.equal(
      (await db.query("select secret from vault.secrets")).rows[0].secret,
      first,
    );
    await db.exec("set role service_role");
    assert.equal(
      (
        await db.query("select validate_private_media_cleanup_token($1) ok", [
          first,
        ])
      ).rows[0].ok,
      true,
    );
    assert.equal(
      (
        await db.query("select validate_private_media_cleanup_token($1) ok", [
          "a".repeat(75),
        ])
      ).rows[0].ok,
      false,
    );
    await assert.rejects(
      () => db.query("select * from private.private_media_cleanup_credentials"),
      /permission denied/,
    );
    await db.exec("reset role;set role authenticated");
    await assert.rejects(
      () =>
        db.query("select validate_private_media_cleanup_token($1)", [first]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
