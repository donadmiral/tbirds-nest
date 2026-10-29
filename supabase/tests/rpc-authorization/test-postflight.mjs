import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {readCandidate} from './migration-source.mjs';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const push = await read('./save-push-token-fixture.sql');
const group = await read('./community-group-fixture.sql');
const marker = 'CREATE TABLE public.communities';
assert.equal(group.split(marker).length, 2);
const db = new PGlite();
try {
  await db.exec('BEGIN');
  await db.exec(push+'\n'+group.slice(group.indexOf(marker)));
  await db.exec(await readCandidate());
  await db.exec('COMMIT');
  // The postflight itself begins READ ONLY, verifies exact definitions/ACLs,
  // invokes six expected role denials, and rolls back all local role settings.
  await db.exec(await read('./postflight.sql'));
  console.log('Read-only postflight passed: exact definitions/ACLs and six expected role denials.');
} finally { await db.close(); }
