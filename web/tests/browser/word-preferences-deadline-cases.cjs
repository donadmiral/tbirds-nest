const assert = require('node:assert/strict');

module.exports = function register({ test, visible, wordsPresent }) {
  const input = page => page.getByPlaceholder('Add a word or phrase');
  const updates = page => page.evaluate(() => window.__memberResilience.requests.filter(r => r.name === 'profiles' && r.action === 'update'));
  const waitUpdate = page => page.waitForFunction(() => window.__memberResilience.requests.some(r => r.name === 'profiles' && r.action === 'update'));
  const start = async (page, mode = 'held') => {
    await wordsPresent(page);
    await page.evaluate(mode => { window.__memberResilience.wordUpdateMode = mode; }, mode);
    await input(page).fill('newword');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await waitUpdate(page);
  };
  const timeout = page => page.clock.fastForward(12001);
  const away = async page => {
    await page.evaluate(() => { history.pushState({}, '', '/word-settings-away'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await visible(page, 'Synthetic destination: /word-settings-away');
  };
  const testWord = (name, run, kind = 'hidden') => test('Word write deadline: ' + name, '/settings/' + kind + '-words', 'normal', '', run, { wordDeadline: true, clock: true });

  for (const kind of ['hidden', 'muted']) {
    testWord(kind + ' held update aborts, reconciles, then permits a deliberate retry', async page => {
      await start(page); await timeout(page);
      await visible(page, /could not save/i);
      await page.waitForFunction(() => !document.querySelector('input')?.disabled);
      assert.equal(await input(page).inputValue(), 'newword');
      assert.deepEqual(await page.evaluate(kind => window.__memberResilience.words[kind + '_words'], kind), ['existing']);
      const before = await updates(page);
      assert.equal(before.length, 1); assert.equal(before[0].aborted, true); assert.equal(before[0].pinned, true); assert.equal(before[0].cancellable, true);
      assert.equal(await page.evaluate(() => window.__memberResilience.requests.filter(r => r.name === 'profiles' && r.action === 'read').length), 2);
      await page.evaluate(() => { window.__memberResilience.wordUpdateMode = 'normal'; });
      await page.getByRole('button', { name: 'Add', exact: true }).click(); await visible(page, 'newword');
      await page.evaluate(() => window.__memberResilience.releaseWordWrites());
      await visible(page, 'newword'); assert.equal((await updates(page)).length, 2);
    }, kind);

    testWord(kind + ' committed update with lost acknowledgement is read back without replay', async page => {
      await start(page, 'committed-held'); await timeout(page);
      await visible(page, /could not save/i); await visible(page, 'newword');
      assert.equal(await input(page).inputValue(), 'newword');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      assert.equal(await input(page).inputValue(), ''); assert.equal((await updates(page)).length, 1);
      await page.evaluate(() => window.__memberResilience.releaseWordWrites());
      await visible(page, 'newword');
    }, kind);
  }

  for (const mode of ['resolved', 'rejected', 'held']) testWord('failed reconciliation ' + mode + ' keeps editing unavailable until an explicit read succeeds', async page => {
    await start(page);
    await page.evaluate(mode => { window.__memberResilience.wordReadMode = mode; }, mode);
    await timeout(page);
    if (mode === 'held') {
      await page.waitForFunction(() => window.__memberResilience.requests.filter(r => r.name === 'profiles' && r.action === 'read').length === 2);
      assert.equal(await input(page).isDisabled(), true); await timeout(page);
    }
    await visible(page, /could not load|could not confirm/i);
    assert.equal(await input(page).isDisabled(), true); assert.equal(await input(page).inputValue(), 'newword');
    assert.equal((await updates(page)).length, 1);
    await page.evaluate(() => { window.__memberResilience.wordReadMode = 'normal'; window.__memberResilience.words.hidden_words = ['current-server-value']; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await visible(page, 'current-server-value'); assert.equal(await input(page).isEnabled(), true);
    await page.evaluate(() => { window.__memberResilience.releaseWordReads(); window.__memberResilience.releaseWordWrites(); });
    await visible(page, 'current-server-value'); assert.equal(await page.getByText('existing', { exact: true }).count(), 0);
    assert.equal((await updates(page)).length, 1);
  });

  testWord('held pre-dispatch session lookup has its own deadline and sends no write', async page => {
    await wordsPresent(page); await page.evaluate(() => { window.__memberResilience.holdWordSession = true; });
    await input(page).fill('newword'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForFunction(() => window.__memberResilience.pendingWordSessions === 1); await timeout(page);
    await visible(page, /could not save/i); assert.equal((await updates(page)).length, 0); assert.equal(await input(page).isEnabled(), true);
    await page.evaluate(() => window.__memberResilience.releaseWordSessions());
    assert.equal((await updates(page)).length, 0);
    await page.getByRole('button', { name: 'Add', exact: true }).click(); await visible(page, 'newword');
  });

  for (const change of ['unmount', 'account', 'ABA', 'replacement']) testWord('pre-dispatch ' + change + ' invalidates the queued intent', async page => {
    await wordsPresent(page); await page.evaluate(() => { window.__memberResilience.holdWordSession = true; });
    await input(page).fill('newword'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForFunction(() => window.__memberResilience.pendingWordSessions === 1);
    if (change === 'unmount') await away(page);
    else await page.evaluate(change => {
      const state = window.__memberResilience;
      if (change === 'replacement') state.replaceWordSession();
      else { state.switchWordOwner('10000000-0000-4000-8000-000000000003'); if (change === 'ABA') state.switchWordOwner('10000000-0000-4000-8000-000000000001'); }
    }, change);
    await page.evaluate(() => window.__memberResilience.releaseWordSessions());
    await page.waitForFunction(() => window.__memberResilience.pendingWordSessions === 0);
    assert.equal((await updates(page)).length, 0);
    if (change !== 'unmount') { await visible(page, /account changed/i); assert.equal(await input(page).isDisabled(), true); assert.equal(await page.getByText('existing', { exact: true }).count(), 0); }
  });

  for (const change of ['unmount', 'ABA', 'replacement']) testWord('dispatched ' + change + ' aborts and ignores a late acknowledgement', async page => {
    await start(page);
    if (change === 'unmount') await away(page);
    else await page.evaluate(change => {
      const state = window.__memberResilience;
      if (change === 'replacement') state.replaceWordSession();
      else { state.switchWordOwner('10000000-0000-4000-8000-000000000003'); state.switchWordOwner('10000000-0000-4000-8000-000000000001'); }
    }, change);
    assert.equal((await updates(page))[0].aborted, true);
    await page.evaluate(() => window.__memberResilience.releaseWordWrites());
    if (change !== 'unmount') { await visible(page, /account changed/i); assert.equal(await input(page).isDisabled(), true); assert.equal(await page.getByText('newword', { exact: true }).count(), 0); }
  });

  testWord('account ABA during reconciliation cannot republish the old list', async page => {
    await start(page);
    await page.evaluate(() => { window.__memberResilience.wordReadMode = 'held'; }); await timeout(page);
    await page.waitForFunction(() => window.__memberResilience.requests.filter(r => r.name === 'profiles' && r.action === 'read').length === 2);
    await page.evaluate(() => {
      const state = window.__memberResilience;
      state.switchWordOwner('10000000-0000-4000-8000-000000000003'); state.switchWordOwner('10000000-0000-4000-8000-000000000001');
      state.releaseWordReads(); state.releaseWordWrites();
    });
    await visible(page, /account changed/i); assert.equal(await input(page).isDisabled(), true); assert.equal(await page.getByText('existing', { exact: true }).count(), 0);
  });
};
