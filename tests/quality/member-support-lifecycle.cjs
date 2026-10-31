const assert = require('node:assert/strict');
const { test } = require('node:test');
const { memberSupportHarness, OWNER, OTHER, TICKET, TICKET_B } = require('../helpers/memberSupportHarness.cjs');

function setup(t, kind) {
  const h = memberSupportHarness(kind);
  t.after(() => h.dispose());
  return h;
}

for (const kind of ['reply', 'create']) {
  test(`${kind}: an older read cannot replace a confirmed write or its current status`, async t => {
    const h = setup(t, kind);
    h.state[kind === 'reply' ? 'historyError' : 'listError'] = true;
    await h.settle();
    h.state[kind === 'reply' ? 'historyError' : 'listError'] = false;
    const read = kind === 'reply' ? 'history' : 'list';
    h.hold(read); h.retry(); await h.settle();
    assert.ok(h.entered(read));
    h.prepare('Confirmed while the older read waits'); h.send(); await h.settle();
    assert.equal(h.committed().length, 1);
    assert.ok(h.words().includes(kind === 'reply' ? 'Confirmed while the older read waits' : 'Account: New support issue'));
    h.release(read); await h.settle();
    assert.ok(h.words().includes(kind === 'reply' ? 'Confirmed while the older read waits' : 'Account: New support issue'));
    if (kind === 'reply') { assert.match(h.words(), /Open/); assert.doesNotMatch(h.words(), /Solved/); }
  });

  test(`${kind}: blur and refocus retain the request identity until the current UI accepts replay`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('write'); h.prepare('Keep through refocus'); h.send(); await h.settle();
    assert.ok(h.entered('write'));
    const firstId = [...h.storage.values()][0];
    h.focus(false); h.focus(true); await h.settle();
    h.release('write'); await h.settle();
    assert.equal(h.committed().length, 1);
    assert.equal(h.draft(), 'Keep through refocus');
    assert.equal([...h.storage.values()][0], firstId);
    h.send(); await h.settle();
    assert.equal(h.committed().length, 1, 'Retry must not create another row');
    assert.equal(h.writes().length, 2);
    const ids = h.writes().map(row => kind === 'reply' ? row.body.p_request_id : row.body.id);
    assert.deepEqual(ids, [firstId, firstId]);
    assert.equal(h.draft(), ''); assert.equal(h.storage.size, 0);
  });

  test(`${kind}: an unmounted draft waiting for hashing never dispatches`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('digest'); h.prepare(); h.send(); await h.settle();
    assert.ok(h.entered('digest')); h.dispose(); h.release('digest'); await h.settle();
    assert.equal(h.writes().length, 0); assert.equal(h.storage.size, 0);
  });

  test(`${kind}: A to B to A invalidates preparation even when React sees only the final owner`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('digest'); h.prepare(); h.send(); await h.settle();
    h.changeSession(OTHER, 'login-b', false); h.changeSession(OWNER, 'login-a2', false);
    h.release('digest'); await h.settle();
    assert.equal(h.writes().length, 0); assert.equal(h.committed().length, 0);
    assert.equal(h.draft(), 'A retained draft'); assert.equal(h.busy(), false);
  });

  test(`${kind}: a later login for the same owner cannot inherit an undispatched action`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('digest'); h.prepare(); h.send(); await h.settle();
    h.changeSession(OWNER, 'login-a2', false); h.release('digest'); await h.settle();
    assert.equal(h.writes().length, 0); assert.equal(h.draft(), 'A retained draft');
  });

  test(`${kind}: a token refresh within the captured session preserves the pinned bearer`, async t => {
    const h = setup(t, kind); await h.settle();
    const captured = h.token();
    h.hold('digest'); h.prepare(); h.send(); await h.settle();
    h.refresh(); assert.notEqual(h.token(), captured); h.release('digest'); await h.settle();
    assert.equal(h.writes().length, 1); assert.equal(h.writes()[0].bearer, `Bearer ${captured}`);
    assert.equal(h.committed().length, 1); assert.equal(h.draft(), '');
  });

  test(`${kind}: an SDK auth lookup queued after query construction is aborted across session ABA`, async t => {
    const h = setup(t, kind); await h.settle();
    const gate = `auth:${h.state.authCalls + 2}`;
    h.hold(gate); h.prepare(); h.send(); await h.settle();
    assert.ok(h.entered(gate), 'Installed SDK must reach its own Auth lookup');
    h.changeSession(OTHER, 'login-b', false); h.changeSession(OWNER, 'login-a2', false);
    h.release(gate); await h.settle();
    assert.equal(h.writes().length, 0, 'Aborted fetch cannot dispatch after the queued Auth lookup');
    assert.equal(h.committed().length, 0); assert.equal(h.storage.size, 1, 'Unconfirmed attempt remains retryable');
  });

  test(`${kind}: SDK auth lookup cannot replace the explicit bearer during ordinary refresh`, async t => {
    const h = setup(t, kind); await h.settle();
    const captured = h.token(), gate = `auth:${h.state.authCalls + 2}`;
    h.hold(gate); h.prepare(); h.send(); await h.settle();
    assert.ok(h.entered(gate)); h.refresh(); h.release(gate); await h.settle();
    assert.equal(h.writes().length, 1); assert.equal(h.writes()[0].bearer, `Bearer ${captured}`);
    assert.equal(h.committed().length, 1);
  });

  test(`${kind}: storage completion after blur is fenced before constructing a request`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('storage:set'); h.prepare(); h.send(); await h.settle();
    assert.ok(h.entered('storage:set')); h.focus(false); h.release('storage:set'); await h.settle();
    assert.equal(h.writes().length, 0); assert.equal(h.storage.size, 1);
    h.focus(true); await h.settle(); h.send(); await h.settle();
    assert.equal(h.committed().length, 1); assert.equal(h.storage.size, 0);
  });

  test(`${kind}: a late server receipt after a session change cannot clear the old draft or retry UUID`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('write'); h.prepare(); h.send(); await h.settle();
    assert.ok(h.entered('write'));
    h.changeSession(OWNER, 'login-a2', false); await h.settle();
    assert.equal(h.writes()[0].signal.aborted, true);
    h.release('write'); await h.settle();
    assert.equal(h.committed().length, 1, 'Already dispatched server work may complete despite transport abort');
    assert.equal(h.draft(), 'A retained draft'); assert.equal(h.storage.size, 1);
    h.send(); await h.settle();
    assert.equal(h.committed().length, 1); assert.equal(h.draft(), ''); assert.equal(h.storage.size, 0);
  });

  test(`${kind}: lost response is confirmed or replayed without duplicate rows`, async t => {
    const h = setup(t, kind); await h.settle();
    h.state.writeLost = true; h.prepare('One committed request'); h.send(); await h.settle();
    assert.equal(h.committed().length, 1);
    if (kind === 'reply') { assert.equal(h.draft(), 'One committed request'); h.send(); await h.settle(); }
    assert.equal(h.committed().length, 1); assert.equal(h.draft(), ''); assert.equal(h.storage.size, 0);
    assert.equal(h.writes().length, kind === 'reply' ? 2 : 1);
  });

  test(`${kind}: malformed persisted UUID is replaced with canonical 8-4-4-4-12 identity`, async t => {
    const h = setup(t, kind); await h.settle();
    h.state.writeError = true; h.prepare(); h.send(); await h.settle();
    assert.equal(h.storage.size, 1);
    const key = [...h.storage.keys()][0];
    h.storage.set(key, '123456789-123-4567-8901-123456789012');
    h.state.writeError = false; h.send(); await h.settle();
    const row = h.writes().at(-1), id = kind === 'reply' ? row.body.p_request_id : row.body.id;
    assert.match(id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
    assert.notEqual(id, '123456789-123-4567-8901-123456789012'); assert.equal(h.committed().length, 1);
  });

  test(`${kind}: accepting a confirmed draft permits a later intentional identical request`, async t => {
    const h = setup(t, kind); await h.settle();
    h.prepare('Intentional same text'); h.send(); await h.settle();
    assert.equal(h.storage.size, 0);
    h.prepare('Intentional same text'); h.send(); await h.settle();
    assert.equal(h.committed().length, 2);
    const ids = h.writes().map(row => kind === 'reply' ? row.body.p_request_id : row.body.id);
    assert.notEqual(ids[0], ids[1]);
  });

  test(`${kind}: slow acknowledgement storage cleanup cannot consume a later intentional identical request`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('write'); h.prepare('Intentional identical request'); h.send(); await h.settle();
    h.hold('storage:get'); h.release('write'); await h.settle();
    assert.ok(h.entered('storage:get')); assert.equal(h.draft(), '', 'The current UI accepted the first receipt');
    h.focus(false); h.focus(true); await h.settle();
    h.prepare('Intentional identical request'); h.send(); await h.settle();
    h.release('storage:get'); await h.settle();
    assert.equal(h.committed().length, 2, 'A new deliberate send after acknowledgement needs its own identity');
    assert.equal(h.storage.size, 0); assert.equal(h.draft(), '');
  });

  test(`${kind}: accepting the sent payload preserves text edited while the request was in flight`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('write'); h.prepare('First text'); h.send(); await h.settle();
    h.input('New unsent text'); h.release('write'); await h.settle();
    assert.equal(h.committed()[0].body, 'First text'); assert.equal(h.draft(), 'New unsent text');
    assert.equal(h.storage.size, 0);
  });

  test(`${kind}: an old completion cannot unlock a new submission after refocus`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('write'); h.prepare('Old request'); h.send(); await h.settle();
    h.focus(false); h.focus(true); await h.settle();
    h.hold('digest'); h.input('New request'); h.send(); await h.settle();
    assert.ok(h.entered('digest')); assert.equal(h.busy(), true);
    h.release('write'); await h.settle();
    assert.equal(h.busy(), true); assert.equal(h.draft(), 'New request');
    h.release('digest'); await h.settle();
    assert.equal(h.busy(), false); assert.equal(h.committed().length, 2);
  });
}

test('reply: changing ticket retires an undispatched reply and clears only the previous ticket draft', async t => {
  const h = setup(t, 'reply'); await h.settle();
  h.state.tickets.push({ ...h.state.tickets[0], id: TICKET_B, subject: 'Ticket B' });
  h.hold('digest'); h.prepare('Ticket A private draft'); h.send(); await h.settle();
  h.route(TICKET_B); await h.settle(); h.release('digest'); await h.settle();
  assert.equal(h.writes().length, 0); assert.equal(h.draft(), ''); assert.match(h.words(), /Ticket B/);
});

test('reply: idempotent retry after a staff solve does not imply that the ticket reopened', async t => {
  const h = setup(t, 'reply'); await h.settle();
  h.state.writeLost = true; h.prepare('Already delivered'); h.send(); await h.settle();
  assert.equal(h.committed().length, 1); h.state.tickets.find(row => row.id === TICKET).status = 'solved';
  h.send(); await h.settle();
  assert.equal(h.committed().length, 1); assert.equal(h.draft(), ''); assert.match(h.words(), /Solved/);
});
