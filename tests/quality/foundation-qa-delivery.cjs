const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const vm = require('node:vm');

test('foundation QA delivery is deliberately triggered only by a trusted branch workflow change', () => {
 const workflow = YAML.parse(read('.github/workflows/foundation-qa-delivery.yml'));
 assert.deepEqual(Object.keys(workflow.on), ['push']);
 assert.deepEqual(workflow.on.push.branches, ['codex/loading-foundation-20261105']);
 assert.deepEqual(workflow.on.push.paths, ['.github/workflows/foundation-qa-delivery.yml']);
 assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
 const job = workflow.jobs['qa-build'];
 assert.equal(job.if, "github.repository == 'donadmiral/tbirds-nest' && github.event_name == 'push' && github.ref == 'refs/heads/codex/loading-foundation-20261105'");
 const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
 assert.equal(checkout.with.ref, '${{ github.sha }}'); assert.equal(checkout.with['persist-credentials'], false);
 assert.match(job.steps.find(step => step.name?.includes('release source')).run, /git rev-parse HEAD/);
 const build = job.steps.find(step => step.run === 'node tools/build-live-qa.mjs');
 assert.ok(build); assert.equal(build.env.EXPO_TOKEN, '${{ secrets.EXPO_TOKEN }}');
 assert.equal(build.env.GITHUB_TOKEN, '${{ github.token }}');
 assert.ok(!job.steps.some(step => step['continue-on-error']));
});

async function releaseGates(responses) {
 const source = read('tools/build-live-qa.mjs');
 const prefix = source.slice(0, source.indexOf("assert.ok(process.env.EXPO_TOKEN")).replace(/^import .*;\n/gm, '');
 let clock = 0, calls = 0;
 const value = await vm.runInNewContext('(async()=>{' + prefix + '\nreturn {qualityRun,hlsRun};})()', {
  assert, AbortSignal, Date: { now: () => clock }, console: { log() {} },
  process: { env: { GITHUB_SHA: 'a'.repeat(40), GITHUB_REPOSITORY: 'donadmiral/tbirds-nest', GITHUB_TOKEN: 'synthetic-read-token' } },
  fetch: async () => ({ ok: true, json: async () => ({ workflow_runs: responses[Math.min(calls++, responses.length - 1)] }) }),
  setTimeout: (callback, delay) => { clock += delay; queueMicrotask(callback); },
 });
 return { ...value, calls };
}
const workflowRun = (id, path, extra = {}) => ({ id, path: '.github/workflows/' + path, head_sha: 'a'.repeat(40),
 status: 'completed', conclusion: 'success', html_url: 'https://github.com/donadmiral/tbirds-nest/actions/runs/' + id, ...extra });

test('delivery waits for current-source HLS pixels and rejects failed or unrelated renderer evidence', async () => {
 const quality = workflowRun(1, 'typecheck.yml');
 const hls = workflowRun(2, 'ios-graded-hls-runtime.yml');
 await assert.rejects(releaseGates([[quality, { ...hls, conclusion: 'failure' }]]), /iOS graded HLS runtime must pass/);
 await assert.rejects(releaseGates([[quality, { ...hls, head_sha: 'b'.repeat(40) }]]), /gates are still pending/);
 const waiting = await releaseGates([[quality, { ...hls, status: 'in_progress', conclusion: null }], [quality, hls]]);
 assert.equal(waiting.calls, 2); assert.equal(waiting.hlsRun.id, 2);
 await assert.rejects(releaseGates([[quality, hls, { ...hls, id: 3, conclusion: 'failure' }]]), /iOS graded HLS runtime must pass/);
 const renderer = YAML.parse(read('.github/workflows/ios-graded-hls-runtime.yml'));
 assert.ok(renderer.on.push.paths.includes('.github/workflows/foundation-qa-delivery.yml'));
});
test('foundation delivery retains exact-source quality and existing remote iOS versioning gates', () => {
 const quality = YAML.parse(read('.github/workflows/typecheck.yml'));
 assert.ok(quality.on.push.branches.includes('codex/loading-foundation-20261105'));
 const build = read('tools/build-live-qa.mjs');
 assert.ok(build.indexOf("candidate.conclusion,'success'") < build.indexOf("EXPO_TOKEN"));
 assert.match(build, /run\.head_sha===sha&&run\.path==='\.github\/workflows\/typecheck\.yml'/);
 assert.match(build, /b\.gitCommitHash===sha&&b\.platform==='IOS'/);
 assert.match(build, /--git-commit-hash/); assert.match(build, /build\.appBuildVersion/);
 const eas = JSON.parse(read('eas.json'));
 assert.equal(eas.cli.appVersionSource, 'remote'); assert.equal(eas.build.preview.autoIncrement, true);
 assert.equal(eas.build.preview.distribution, 'internal'); assert.equal(eas.build.preview.ios.simulator, false);
 assert.equal(eas.build.preview.env.EXPO_PUBLIC_APP_ENV, 'qa');
});
