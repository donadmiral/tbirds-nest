const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const flow = YAML.parseAllDocuments(fs.readFileSync(path.join(root,
  'tests/native/flows/navigation.yaml'), 'utf8'))[1].toJSON();
const loginSource = fs.readFileSync(path.join(root, 'src/screens/auth/LoginScreen.tsx'), 'utf8');
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function project(commands, platform) {
  return commands.flatMap(command => {
    const nested = command.runFlow;
    if (!nested?.when?.platform) return [command];
    assert.deepEqual(Object.keys(nested.when), ['platform']);
    return nested.when.platform === platform ? project(nested.commands, platform) : [];
  });
}
const ios = project(flow, 'iOS');
const signIn = ios.findIndex(command => command.tapOn === 'Sign in');
const prefix = ios.slice(0, signIn + 1);
function following(action, offset = 1) {
  const at = prefix.findIndex(action);
  assert.ok(at >= 0, 'The original input action must remain present.');
  return prefix[at + offset];
}

// Only the pinned Maestro 2.11.0 selector contract is projected here. This does
// not execute its driver or claim that the next native run has passed. IOSDriver
// blob 8af50e6b65d983437cdd3f81fe2c20dc0b1a6cb9 exposes label, value and placeholder.
function matches(pattern, value) {
  const insensitive = pattern.startsWith('(?i)');
  return new RegExp(insensitive ? pattern.slice(4) : pattern, insensitive ? 'i' : '').test(value);
}
function visible(selector, nodes) {
  if (typeof selector === 'string') selector = { text: selector };
  return nodes.some(attributes =>
    (!selector.id || matches(selector.id, attributes['resource-id'] || ''))
    && (!selector.text || ['text', 'accessibilityText', 'hintText', 'value'].some(key =>
      matches(selector.text, attributes[key] || '')))
    && (selector.enabled === undefined || attributes.enabled === String(selector.enabled)));
}
function firstReady(wait, timeline) {
  for (const sample of timeline) {
    if (sample.at > wait.timeout) break;
    if (wait.visible ? visible(wait.visible, sample.nodes) : !visible(wait.notVisible, sample.nodes)) return sample.at;
  }
  return null;
}

// Redacted keyboard attributes observed in GitHub artifact 13317287359.
// Original hierarchy SHA256: 300d0492ee90bc10c0eccfa6315094e940fa03ef39e70555e7ed11bf0478547b.
// The Go label is source-backed by returnKeyType, not observed in that failed run.
const nextKey = { 'resource-id': 'Next:', accessibilityText: 'next', enabled: 'true' };
const spaceKey = { 'resource-id': 'space', accessibilityText: 'space', enabled: 'true' };

test('each iOS field waits for its native keyboard before input, then for exact value readback', () => {
  assert.match(loginSource, /returnKeyType="next"/);
  assert.match(loginSource, /returnKeyType="go"/);
  assert.deepEqual(following(command => command.tapOn === 'Username or email'), {
    extendedWaitUntil: { visible: { id: '^Next:$' }, timeout: 30000 },
  });
  assert.ok(Object.hasOwn(following(command => command.tapOn === 'Username or email', 2), 'inputText'));
  assert.deepEqual(following(command => command.tapOn === 'Username or email', 3), {
    extendedWaitUntil: { visible: '^qa\\.alex@example\\.invalid$', timeout: 30000 },
  });
  assert.deepEqual(following(command => command.tapOn === 'Password'), {
    extendedWaitUntil: { visible: '(?i)^go$', timeout: 30000 },
  });
  assert.ok(Object.hasOwn(following(command => command.tapOn === 'Password', 2), 'inputText'));
  assert.deepEqual(following(command => command.tapOn === 'Password', 3), {
    extendedWaitUntil: { visible: '^•{17}$', timeout: 30000 },
  });
});

test('a delayed native field keyboard blocks typing and cannot be replaced by an unrelated Go label', () => {
  const emailWait = following(command => command.tapOn === 'Username or email').extendedWaitUntil;
  const passwordWait = following(command => command.tapOn === 'Password').extendedWaitUntil;
  assert.ok(emailWait && passwordWait, 'Both native readiness waits are required.');
  assert.equal(firstReady(emailWait, [{ at: 0, nodes: [] }, { at: 1000, nodes: [nextKey, spaceKey] }]), 1000);
  assert.equal(firstReady(passwordWait, [{ at: 0, nodes: [nextKey, spaceKey] },
    { at: 1000, nodes: [{ accessibilityText: 'Forgot password' }] },
    { at: 2000, nodes: [{ accessibilityText: 'go' }, spaceKey] }]), 2000);
  assert.equal(firstReady(passwordWait, [{ at: 0, nodes: [nextKey] },
    { at: 30001, nodes: [{ accessibilityText: 'go' }] }]), null);
  for (const wrong of ['Go back', 'go now', 'Forgot password', '']) assert.equal(visible(passwordWait.visible,
    [{ accessibilityText: wrong }]), false);
});

test('native readback requires the exact fixture email and exact secure mask without logging password text', () => {
  const email = following(command => command.tapOn === 'Username or email', 3).extendedWaitUntil?.visible;
  const password = following(command => command.tapOn === 'Password', 3).extendedWaitUntil?.visible;
  assert.equal(typeof email, 'string'); assert.equal(typeof password, 'string');
  assert.ok(matches(email, 'qa.alex@example.invalid'));
  for (const wrong of ['qaXalex@example.invalid', 'qa.alex@exampleXinvalid', 'qa.alex@example.invalid.more']) {
    assert.equal(matches(email, wrong), false);
  }
  assert.ok(matches(password, '•'.repeat(17)));
  for (const wrong of ['', '•'.repeat(16), '•'.repeat(18), '*'.repeat(17), '●'.repeat(17)]) {
    assert.equal(matches(password, wrong), false);
  }
  const enteredPassword = following(command => command.tapOn === 'Password', 2).inputText;
  assert.equal(enteredPassword.length, 17);
  assert.equal(password.includes(enteredPassword), false);
});

test('iOS must dismiss the observed keyboard and retain one enabled Sign in button action', () => {
  const wait = following(command => command.tapOn === 'Platinum Circles').extendedWaitUntil;
  assert.deepEqual(wait, { notVisible: { id: '^space$' }, timeout: 30000 });
  assert.equal(firstReady(wait, [{ at: 0, nodes: [spaceKey, nextKey] }, { at: 500, nodes: [] }]), 500);
  assert.equal(firstReady(wait, [{ at: 0, nodes: [spaceKey] }, { at: 30000, nodes: [spaceKey] }]), null);
  assert.deepEqual(following(command => command.tapOn === 'Platinum Circles', 2), {
    assertVisible: { text: '^Sign in$', enabled: true },
  });
  assert.deepEqual(following(command => command.tapOn === 'Platinum Circles', 3), { tapOn: 'Sign in' });
  assert.equal(prefix.filter(command => command.tapOn === 'Sign in').length, 1);
  assert.equal(prefix.filter(command => command.pressKey || command.repeat || command.retry).length, 0);
});

test('all existing Android actions and every post-login Live/navigation requirement are preserved', () => {
  // Fixed hashes from reviewed 72bbaebb, independent of Git history in shallow CI.
  const original = flow.filter(command => command.runFlow !== 'feed-video.yaml');
  assert.equal(flow.filter(command => command.runFlow === 'feed-video.yaml').length, 1);
  assert.equal(sha(project(original, 'Android')), 'cfd5e880e7283b4b7e93062abaf6f3329d57c6f5a7f0eb75d672c5333b154a5b');
  const index = flow.findIndex(command => command.tapOn === 'Sign in');
  assert.equal(sha(flow.slice(index + 1).filter(command => command.runFlow !== 'feed-video.yaml')), '62022480a47c567ab5b60832554d47fd80eab18f8cbb6d1a98a3909a342183e2');
  assert.equal(flow[index + 1].extendedWaitUntil.timeout, 30000);
  assert.equal(flow.filter(command => command.launchApp).length, 1);
});
