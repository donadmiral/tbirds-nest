/** No live account or provider. Exercise export safety and exact quoted amounts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, extras = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, require: () => ({}), URL, Intl, window: { location: { origin: 'https://preview.example' } }, ...extras });
  return mod.exports;
}
const p = load('lib/studioPresentation.ts');
for (const attack of ['=HYPERLINK("https://example.test")', '+12', '-2', '@SUM(A1)', '\t =1+1', '\r\n+2']) {
  assert.ok(p.csvCell(attack).startsWith('"\''), 'exported formula-like text must be neutralized');
}
assert.equal(p.csvCell('A, "B"\nC'), '"A, ""B""\nC"');
assert.equal(p.csvCell('Ordinary title'), '"Ordinary title"');
assert.equal(p.safePublicWebsite('javascript:alert(1)'), null);
assert.equal(p.safePublicWebsite('https://name:secret@example.test'), null);
assert.equal(p.safePublicWebsite('https://example.test/path'), 'https://example.test/path');
assert.equal(p.campaignMatches({ name: 'Weekend highlights', status: 'paused', objective: 'reach' }, 'WEEKEND', 'paused', 'reach'), true);
assert.equal(p.campaignMatches({ name: 'Weekend highlights', status: 'paused', objective: 'reach' }, '', 'live', 'all'), false);

const w = load('lib/studioWorkflows.ts');
assert.equal(w.parsePostReference('https://preview.example/post/8c702963-aaf3-44a3-a442-191f8ad8ecca?source=share'), '8c702963-aaf3-44a3-a442-191f8ad8ecca');
assert.equal(w.parsePostReference(''), null);
assert.throws(() => w.parsePostReference('https://outside.example/post/8c702963-aaf3-44a3-a442-191f8ad8ecca'));
assert.throws(() => w.parsePostReference('/post/not-a-post-id'));
assert.equal(w.quoteToMinor('0', 'USD'), '0');
assert.equal(w.quoteToMinor('1.25', 'USD'), '125');
assert.equal(w.quoteToMinor('125', 'JPY'), '125');
assert.equal(w.quoteToMinor('1.250', 'KWD'), '1250');
assert.equal(w.quoteToMinor('1000000000.00', 'USD'), '100000000000');
assert.throws(() => w.quoteToMinor('1000000000.01', 'USD'));
assert.throws(() => w.quoteToMinor('1.1', 'JPY'));
assert.throws(() => w.quoteToMinor('1e4', 'USD'));
assert.throws(() => w.quoteToMinor('-1', 'USD'));
assert.throws(() => w.quoteToMinor('1.001', 'USD'));
assert.equal(w.quoteToMinor('', 'USD'), null);
assert.equal(w.formatQuote('100000000000', 'USD'), 'USD 1,000,000,000.00');
assert.equal(w.formatQuote('1250', 'JPY'), 'JPY 1,250');
assert.equal(w.formatQuote(null, 'USD'), 'Not specified');
assert.equal(w.workflowFailure({ message: 'WORKFLOW_VERSION_CHANGED' }).confirmedRejected, true);
assert.match(w.workflowFailure({ message: 'WORKFLOW_VERSION_CHANGED' }).message, /changed while it was open/);
assert.equal(w.workflowFailure({ message: 'Network request failed' }).confirmedRejected, false);
assert.equal(w.workflowFailure({ code: 'PGRST202' }).confirmedRejected, true);
assert.match(w.workflowFailure({ code: 'PGRST202' }).message, /not available on this deployment yet/);
console.log('Studio export, URL, exact quote and recoverable error checks passed.');
