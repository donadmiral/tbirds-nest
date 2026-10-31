const assert = require('node:assert/strict');
const { test } = require('node:test');
const { memberSupportHarness, OWNER, OTHER } = require('../helpers/memberSupportHarness.cjs');

function setup(t, kind) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = memberSupportHarness(kind);
  t.after(() => h.dispose());
  return h;
}

for (const kind of ['create', 'reply']) {
  for (const phase of ['digest', 'storage:get', 'storage:set']) {
    test(`${kind}: a held ${phase} has a bounded preparation wait and cannot dispatch after its timeout`, async t => {
      const h = setup(t, kind); await h.settle();
      h.hold(phase); h.prepare('A prepared request'); h.send(); await h.settle();
      assert.ok(h.entered(phase));
      const reserved = [...h.storage.values()][0];
      t.mock.timers.tick(15001); await h.settle();
      assert.equal(h.busy(), false); assert.equal(h.draft(), 'A prepared request');
      assert.equal(h.writes().length, 0); assert.equal(h.alerts.length, 1);
      if (phase === 'storage:set') {
        // Retry while the actual set is still unresolved. Caller timeout must
        // not unlock the queue or manufacture a second request identity.
        h.send(); await h.settle();
        assert.equal(h.writes().length, 0); assert.equal(h.storage.size, 1);
        h.release(phase); await h.settle();
        const row = h.writes()[0];
        assert.equal(kind === 'reply' ? row.body.p_request_id : row.body.id, reserved);
      } else {
        h.release(phase); await h.settle();
        assert.equal(h.writes().length, 0, 'A late preparation completion must remain retired');
        h.send(); await h.settle();
      }
      assert.equal(h.committed().length, 1); assert.equal(h.writes().length, 1);
      assert.equal(h.draft(), ''); assert.equal(h.storage.size, 0); assert.equal(h.busy(), false);
    });
  }

  for (const phase of ['storage:get', 'storage:remove']) {
    test(`${kind}: accepted cleanup at ${phase} cannot hold Send busy or let a timed-out identical intent bypass its key`, async t => {
      const h = setup(t, kind); await h.settle();
      h.hold('write'); h.prepare('Intentional identical request'); h.send(); await h.settle();
      h.hold(phase); h.release('write'); await h.settle();
      assert.ok(h.entered(phase)); assert.equal(h.draft(), '');
      assert.equal(h.busy(), false, 'A database receipt was already accepted; storage cleanup is separate');
      const acceptedId = [...h.storage.values()][0];
      h.prepare('Intentional identical request'); h.send(); await h.settle();
      assert.equal(h.writes().length, 1, 'A later identical request waits for real cleanup settlement');
      t.mock.timers.tick(15001); await h.settle();
      assert.equal(h.busy(), false); assert.equal(h.draft(), 'Intentional identical request');
      assert.equal(h.writes().length, 1); assert.equal(h.storage.get([...h.storage.keys()][0]), acceptedId);
      h.release(phase); await h.settle();
      assert.equal(h.writes().length, 1, 'A timed-out queued caller must not dispatch when old cleanup finally settles');
      h.send(); await h.settle();
      assert.equal(h.committed().length, 2); assert.equal(h.writes().length, 2);
      const row = h.writes()[1], nextId = kind === 'reply' ? row.body.p_request_id : row.body.id;
      assert.notEqual(nextId, acceptedId); assert.equal(h.storage.size, 0); assert.equal(h.draft(), '');
    });
  }

  test(`${kind}: a different confirmed draft is independent of another key's held cleanup`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('write'); h.prepare('First accepted message'); h.send(); await h.settle();
    h.hold('storage:remove'); h.release('write'); await h.settle();
    assert.equal(h.busy(), false); assert.equal(h.draft(), '');
    h.prepare('Different intentional message'); h.send(); await h.settle();
    assert.equal(h.committed().length, 2); assert.equal(h.busy(), false); assert.equal(h.draft(), '');
    h.input('A newly edited unsent draft'); h.release('storage:remove'); await h.settle();
    assert.equal(h.draft(), 'A newly edited unsent draft'); assert.equal(h.storage.size, 0);
  });

  test(`${kind}: session ABA cancels held preparation without waiting for hashing to settle`, async t => {
    const h = setup(t, kind); await h.settle();
    h.hold('digest'); h.prepare('A retained old-session draft'); h.send(); await h.settle();
    h.changeSession(OTHER, 'login-b', false); h.changeSession(OWNER, 'login-a2', false); await h.settle();
    assert.equal(h.busy(), false); assert.equal(h.writes().length, 0);
    assert.equal(h.draft(), 'A retained old-session draft'); assert.equal(h.storage.size, 0);
    h.release('digest'); await h.settle(); assert.equal(h.writes().length, 0);
  });
}
