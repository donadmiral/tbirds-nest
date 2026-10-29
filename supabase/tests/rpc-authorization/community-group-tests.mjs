import {readCandidate} from './migration-source.mjs';
// Local disposable PGlite only. Receives a fresh database, creates no hosted data.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const ids = {
  owner: '00000000-0000-4000-8000-000000000001', member: '00000000-0000-4000-8000-000000000002',
  outsider: '00000000-0000-4000-8000-000000000003', pending: '00000000-0000-4000-8000-000000000004',
  serviceTarget: '00000000-0000-4000-8000-000000000005',
  approval: '10000000-0000-4000-8000-000000000001', open: '10000000-0000-4000-8000-000000000002',
  inactive: '10000000-0000-4000-8000-000000000003', club: '20000000-0000-4000-8000-000000000001'
};
const lit = value => value == null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
const groupCall = (user, group = ids.approval, type = 'community') =>
  `SELECT public.get_or_create_group_conversation(${lit(type)},${lit(group)},'FORGED NAME','FORGED EMOJI',${lit(user)}) AS id`;
export async function runCommunityGroupSuite(db) {
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const row = async sql => (await db.query(sql)).rows[0];
  const run = async (name, fn) => {
    await db.exec('BEGIN');
    try { await fn(); results.push({ name, passed: true }); }
    finally { await db.exec('ROLLBACK'); }
  };
  const role = async (name, uid = null) => {
    await db.exec(`SET LOCAL ROLE ${name}`);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid ?? '']);
  };
  const denied = async (name, actor, uid, sql, code = '42501') => run(name, async () => {
    await role(actor, uid);
    let error;
    try { await db.query(sql); } catch (e) { error = e; }
    assert(error?.code === code, `${name}: expected ${code}, received ${error?.code ?? 'success'}`);
  });
  await db.exec(await readFile(path.join(here, 'community-group-fixture.sql'), 'utf8'));

  await run('baseline anonymous direct admission bypasses approval', async () => {
    await role('anon');
    await db.query(`SELECT public.community_admit('${ids.approval}','${ids.outsider}',NULL)`);
    await db.exec('RESET ROLE');
    assert(Number((await row(`SELECT count(*) AS n FROM community_members WHERE community_id='${ids.approval}' AND user_id='${ids.outsider}'`)).n) === 1, 'baseline admission was not reproduced');
  });
  await run('baseline anonymous group helper adds nonmember and forged metadata', async () => {
    await role('anon');
    const { id } = await row(groupCall(ids.outsider));
    await db.exec('RESET ROLE');
    const actual = await row(`SELECT group_name,group_emoji FROM conversations WHERE id='${id}'`);
    assert(actual.group_name === 'FORGED NAME', 'baseline forged metadata was not reproduced');
    assert(Number((await row(`SELECT count(*) AS n FROM conversation_members WHERE conversation_id='${id}' AND user_id='${ids.outsider}'`)).n) === 1, 'baseline group membership was not reproduced');
  });

  await db.exec('BEGIN');
  try {
    await db.exec(await readCandidate('community-group-candidate.sql'));
    await db.exec('COMMIT');
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
  await denied('anonymous admission ACL denied', 'anon', null, `SELECT public.community_admit('${ids.approval}','${ids.outsider}',NULL)`);
  await denied('authenticated direct admission ACL denied', 'authenticated', ids.owner, `SELECT public.community_admit('${ids.approval}','${ids.outsider}',NULL)`);
  await denied('anonymous group helper ACL denied', 'anon', null, groupCall(ids.member));
  await denied('nonmember cannot add self to group chat', 'authenticated', ids.outsider, groupCall(ids.outsider));
  await denied('member cannot add arbitrary nonmember', 'authenticated', ids.member, groupCall(ids.outsider));
  await denied('null target rejected', 'authenticated', ids.member, groupCall(null));
  await denied('unsupported group type rejected', 'authenticated', ids.member, groupCall(ids.member, ids.approval, 'unknown'), '22023');
  await denied('nonexistent group rejected', 'authenticated', ids.member, groupCall(ids.member, '10000000-0000-4000-8000-000000000099'));
  await denied('inactive community rejected', 'authenticated', ids.member, groupCall(ids.member, ids.inactive));
  await run('limited member retains existing chat synchronization', async () => {
    await role('authenticated', ids.pending);
    const { id } = await row(groupCall(ids.pending));
    assert(Boolean(id), 'limited member denied existing chat entitlement');
  });
  await denied('club nonmember rejected', 'authenticated', ids.outsider, groupCall(ids.outsider, ids.club, 'club'));

  await run('self member sync uses canonical metadata and is idempotent', async () => {
    await role('authenticated', ids.member);
    const first = await row(groupCall(ids.member));
    const second = await row(groupCall(ids.member));
    assert(first.id === second.id, 'repeat returned a different conversation');
    await db.exec('RESET ROLE');
    const actual = await row(`SELECT group_name,group_emoji FROM conversations WHERE id='${first.id}'`);
    assert(actual.group_name === 'Approval community' && actual.group_emoji === 'C', 'canonical metadata not used');
    assert(Number((await row(`SELECT count(*) AS n FROM conversations WHERE group_ref_id='${ids.approval}'`)).n) === 1, 'repeat duplicated chat');
  });
  await run('existing club member sync retains client contract', async () => {
    await role('authenticated', ids.member);
    const { id } = await row(groupCall(ids.member, ids.club, 'club'));
    await db.exec('RESET ROLE');
    assert((await row(`SELECT group_name FROM conversations WHERE id='${id}'`)).group_name === 'Canonical club', 'club name spoofable');
  });
  await run('checked open join wrapper retains internal admission and trigger', async () => {
    await role('authenticated', ids.outsider);
    assert((await row(`SELECT public.join_community('${ids.open}') AS status`)).status === 'joined', 'open join failed');
    await db.exec('RESET ROLE');
    assert(Number((await row(`SELECT count(*) AS n FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id WHERE c.group_ref_id='${ids.open}' AND cm.user_id='${ids.outsider}'`)).n) === 1, 'open join did not sync chat');
  });
  await run('moderator approval syncs different target through existing trigger', async () => {
    await db.query(`INSERT INTO community_join_requests VALUES('${ids.approval}','${ids.outsider}')`);
    await role('authenticated', ids.owner);
    await db.query(`SELECT public.resolve_join_request('${ids.approval}','${ids.outsider}',true)`);
    await db.exec('RESET ROLE');
    assert(Number((await row(`SELECT count(*) AS n FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id WHERE c.group_ref_id='${ids.approval}' AND cm.user_id='${ids.outsider}'`)).n) === 1, 'moderator approval target chat membership missing');
  });
  await run('service with no UID retains internal admission and synchronization', async () => {
    await role('service_role');
    await db.query(`SELECT public.community_admit('${ids.approval}','${ids.serviceTarget}',NULL)`);
    await db.exec('RESET ROLE');
    assert(Number((await row(`SELECT count(*) AS n FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id WHERE c.group_ref_id='${ids.approval}' AND cm.user_id='${ids.serviceTarget}'`)).n) === 1, 'service path failed');
  });
  await run('deleting authoritative membership removes synchronized chat member', async () => {
    await role('authenticated', ids.member);
    await row(groupCall(ids.member));
    await db.exec('RESET ROLE');
    await db.query(`DELETE FROM community_members WHERE community_id='${ids.approval}' AND user_id='${ids.member}'`);
    assert(Number((await row(`SELECT count(*) AS n FROM conversation_members WHERE user_id='${ids.member}'`)).n) === 0, 'delete trigger left group chat access');
  });
  return { suite: 'community_group_authorization', checks: results.length, results, limitations: ['Local synthetic fixtures only; no hosted writes.', 'Single-connection fixture does not stress concurrent advisory-lock behavior.', 'Shared helper intentionally allows synchronization of another already-entitled member; authoritative membership is required in every path.'] };
}
