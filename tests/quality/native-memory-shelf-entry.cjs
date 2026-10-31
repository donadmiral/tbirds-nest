const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');
const evidence = 'docs/quality/native-full-app-20261031/android-6878c384/';
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const parseFlow = source => YAML.parseAllDocuments(source).map(document => document.toJSON());
const actual = parseFlow(read('tests/native/flows/memory-navigation.yaml'));
const before = parseFlow(read(evidence + 'memory-navigation-before.yaml.txt'));
const hierarchy = JSON.parse(read(evidence + 'shelf-entry-failure-ax.json'));
const commands = JSON.parse(read(evidence + 'navigation-commands.json'));

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  return [...(value.attributes ? [value.attributes] : []), ...Object.entries(value)
    .filter(([key]) => key !== 'attributes').flatMap(([, child]) => nodes(child))];
}
const observed = nodes(hierarchy);
function one(predicate) {
  const matches = observed.filter(predicate);
  assert.equal(matches.length, 1, 'the retained accessible target must be unambiguous');
  return matches[0];
}
function bounds(value) {
  const parts = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(value);
  assert.ok(parts, 'valid native bounds');
  const [left, top, right, bottom] = parts.slice(1).map(Number);
  return { left, top, right, bottom, width: right - left, height: bottom - top,
    x: (left + right) / 2, y: (top + bottom) / 2 };
}
const target = one(node => node.accessibilityText === 'View all memory books');
const targetBounds = bounds(target.bounds);
const systemBar = bounds(one(node => node['resource-id'] === 'com.android.launcher3:id/navbuttons_view').bounds);
const screen = { width: systemBar.right, height: systemBar.bottom };

// Focused projection of the pinned cli-2.11.0 first-iteration decision:
// ScrollDirection.DOWN -> SwipeDirection.UP; UiElement considers UP centered
// when element center y < height/2 + height/5. Orchestra keeps swiping before
// its existing retry cap if centerElement is true and that predicate is false.
// This is a geometry/command contract, not an executed native gesture or JVM.
function firstDecision(scroll, box) {
  assert.equal(scroll.direction, 'DOWN');
  const visibleWidth = Math.max(0, Math.min(box.right, screen.width) - Math.max(box.left, 0));
  const visibleHeight = Math.max(0, Math.min(box.bottom, screen.height) - Math.max(box.top, 0));
  const visibility = visibleWidth * visibleHeight / (box.width * box.height);
  if (scroll.centerElement && visibility > 0.1) {
    return box.y < Math.floor(screen.height / 2) + Math.floor(screen.height / 5) ? 'complete' : 'swipe';
  }
  return visibility >= 1 ? 'complete' : 'swipe';
}

test('retained Android evidence distinguishes an obscured shelf-entry tap from a missing Private selector', () => {
  assert.equal(target.enabled, 'true');
  assert.equal(target.clickable, 'true');
  assert.deepEqual(screen, { width: 320, height: 640 });
  assert.deepEqual([targetBounds.x, targetBounds.y], [282, 605]);
  assert.ok(targetBounds.x >= systemBar.left && targetBounds.x < systemBar.right);
  assert.ok(targetBounds.y >= systemBar.top && targetBounds.y < systemBar.bottom);
  assert.equal(observed.some(node => node.text === 'Private' || node.accessibilityText === 'Private'), false);
  assert.ok(observed.some(node => node.text === 'Alex Rivera'), 'the failure still shows the Profile');
  assert.match(read(evidence + 'shelf-entry-maestro-log.txt'), /Tapping at \(282, 605\)/);
  const entry = commands.find(command => command.metadata?.sequenceNumber === 38);
  assert.equal(entry.command.tapOnElement.selector.textRegex, 'View all memory books');
  assert.equal(entry.metadata.status, 'COMPLETED');
  const failure = commands.find(command => command.metadata?.sequenceNumber === 39);
  assert.equal(failure.command.tapOnElement.selector.textRegex, 'Private');
  assert.equal(failure.metadata.status, 'FAILED');
});

test('the exact semantic shelf link requests another scroll instead of accepting the captured system-bar overlap', () => {
  const scroll = actual[1][0].scrollUntilVisible;
  assert.equal(scroll.element, target.accessibilityText);
  assert.equal(actual[1][1].tapOn, target.accessibilityText);
  assert.equal(actual[1][2].tapOn, 'Private');
  assert.equal(firstDecision(before[1][0].scrollUntilVisible, targetBounds), 'complete', 'the old command accepts this masked point');
  assert.equal(firstDecision(scroll, targetBounds), 'swipe', 'the repaired command moves this visible but obscured link before tapping');
  const safeBox = { ...targetBounds, top: 298, bottom: 342, y: 320 };
  assert.equal(firstDecision(scroll, safeBox), 'complete', 'a centered occurrence of the same target needs no extra scroll');
  assert.ok(safeBox.bottom < systemBar.top);
});

test('centering changes no selector, assertion, timeout, command order or account lifecycle operation', () => {
  const normalized = structuredClone(actual);
  assert.equal(normalized[1][0].scrollUntilVisible.centerElement, true);
  delete normalized[1][0].scrollUntilVisible.centerElement;
  assert.deepEqual(normalized, before);
  assert.equal(actual[1].length, before[1].length);
});
