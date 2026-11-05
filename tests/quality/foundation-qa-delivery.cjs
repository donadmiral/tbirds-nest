const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

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
