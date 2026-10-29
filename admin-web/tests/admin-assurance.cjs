const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function compile(name, require) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require, Buffer, Date, Set, Object });
  return module.exports;
}
const permissions = compile('permissions', () => { throw Error('Unexpected import'); });
const assurance = compile('adminAssurance', name => name === 'server-only' ? {} : name === './permissions' ? permissions : (() => { throw Error(name); })());
const admin = { id: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222', role: 'super_admin', email: 'owner@example.test', aal: 'aal1' };

test('temporary policy accepts valid staff sign-in without forced enrollment', async () => {
  assert.equal(await assurance.canAccessOperations(admin), true);
  assert.equal(await assurance.canAccessOperations({ ...admin, aal: 'aal2' }), true);
});
test('optional authenticator denies missing sessions, unknown assurance and nonstaff roles', async () => {
  for (const patch of [{ id: '' }, { sessionId: '' }, { role: 'customer' }, { role: 'toString' }, { aal: undefined }, { aal: '' }, { aal: 'aal3' }]) {
    assert.equal(await assurance.canAccessOperations({ ...admin, ...patch }), false);
  }
});
function harness({ live = true, active = true, role = 'super_admin', verified = true, expires = 3600, tokenUser = admin.id } = {}) {
  const calls = [];
  const token = ['e30', Buffer.from(JSON.stringify({ sub: tokenUser, session_id: admin.sessionId, aal: 'aal1', exp: Math.floor(Date.now()/1000)+expires })).toString('base64url'), 'test-signature'].join('.');
  const svc = {
    auth: { getUser: async supplied => { calls.push(['verify', supplied]); return { data: { user: verified ? { id: admin.id, email: admin.email } : null }, error: null }; } },
    rpc: async (name, args) => { calls.push([name, args]); return { data: live, error: null }; },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, active }, error: null }) }) }) }),
  };
  const auth = compile('adminAuth', name => {
    if (name === 'server-only') return {};
    if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: token }) }) };
    if (name === 'next/navigation') return { redirect: url => { throw Error('redirect:' + url); }, notFound: () => { throw Error('not-found'); } };
    if (name === './supabaseAdmin') return { serviceClient: () => svc };
    if (name === './adminAssurance') return assurance;
    if (name === './permissions') return permissions;
    throw Error(name);
  });
  return { auth, calls, token };
}
test('dashboard admission verifies token and native session', async () => {
  const h = harness();
  assert.equal((await h.auth.requireDesk('/dashboard')).id, admin.id);
  assert.equal(h.calls[0][0], 'verify');
  assert.equal(h.calls[1][0], 'triniti_admin_session_check');
  assert.equal(h.calls[1][1].p_session_id, admin.sessionId);
});
test('revoked, inactive, unverified, expired and mismatched identities stay denied', async () => {
  for (const options of [{ live: false }, { active: false }, { verified: false }, { expires: -1 }, { tokenUser: 'someone-else' }, { role: 'customer' }]) {
    const h = harness(options);
    assert.equal(await h.auth.adminFromToken(h.token), null);
    await assert.rejects(() => h.auth.requireDesk('/dashboard'), /redirect:/);
  }
});
test('desk and action roles remain enforced with AAL1 admission', async () => {
  const h = harness({ role: 'support_agent' });
  assert.equal((await h.auth.requireDesk('/support')).role, 'support_agent');
  await assert.rejects(() => h.auth.requireDesk('/staff'), /not-found/);
  await assert.rejects(() => h.auth.requirePermission('staff_manage'), /staff role/);
});
