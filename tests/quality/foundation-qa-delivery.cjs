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
 assert.deepEqual(job.strategy.matrix.platform, ['ios','android']);
 assert.equal(job.strategy['fail-fast'],false);
 const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
 assert.equal(checkout.with.ref, '${{ github.sha }}'); assert.equal(checkout.with['persist-credentials'], false);
 assert.match(job.steps.find(step => step.name?.includes('release source')).run, /git rev-parse HEAD/);
 const build = job.steps.find(step => step.run === 'node tools/build-live-qa.mjs');
 assert.ok(build); assert.equal(build.env.QA_BUILD_PLATFORM, '${{ matrix.platform }}');
 assert.equal(build.env.EXPO_TOKEN, '${{ secrets.EXPO_TOKEN }}');
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
 assert.match(build, /b\.gitCommitHash===sha&&b\.platform===platform\.toUpperCase\(\)/);
 assert.match(build, /--git-commit-hash/); assert.match(build, /build\.appBuildVersion/);
 const eas = JSON.parse(read('eas.json'));
 assert.equal(eas.cli.appVersionSource, 'remote'); assert.equal(eas.build.preview.autoIncrement, true);
 assert.equal(eas.build.preview.distribution, 'internal'); assert.equal(eas.build.preview.ios.simulator, false);
 assert.equal(eas.build.preview.env.EXPO_PUBLIC_APP_ENV, 'qa');
});

const project='6962a2bb-3ebe-4ff8-8d35-e4fb58271259';
const buildId='11111111-2222-4333-8444-555555555555';
const buildOf=(platform,more={})=>({id:buildId,gitCommitHash:'a'.repeat(40),platform,buildProfile:'preview',distribution:'INTERNAL',project:{id:project},appIdentifier:'app.platinumcircles.mobile.qa',status:'FINISHED',artifacts:{buildUrl:'https://example.invalid/artifact'},appBuildVersion:'39',...more});
async function deliver(platform,initial,submit,view,log=[]) {
 const calls=[]; let clock=0;
 const code=read('tools/build-live-qa.mjs').replace(/^import .*;\n/gm,'');
 const env={GITHUB_SHA:'a'.repeat(40),GITHUB_REPOSITORY:'donadmiral/tbirds-nest',GITHUB_TOKEN:'fake-gh',EXPO_TOKEN:'fake-eas',GITHUB_STEP_SUMMARY:'summary'};
 if(platform!==undefined) env.QA_BUILD_PLATFORM=platform;
 await vm.runInNewContext('(async()=>{'+code+'})()',{
   process:{env}, assert,AbortSignal,Date:{now:()=>clock},fs:{readFileSync:read,appendFileSync(_path,line){log.push(line);}},
   console:{log(){}},setTimeout(fn,ms){clock+=ms;queueMicrotask(fn);},
   fetch:async()=>({ok:true,json:async()=>({workflow_runs:[workflowRun(4,'typecheck.yml'),workflowRun(5,'ios-graded-hls-runtime.yml')]})}),
   execFileSync(cmd,args){assert.equal(cmd,'npx'); const op=args[2]; calls.push(Array.from(args));
     if(op==='build:list') return JSON.stringify(initial);
     if(op==='build') return JSON.stringify(submit);
     assert.equal(op,'build:view');return JSON.stringify(view);
   }
 });
 return calls;
}
test('iOS defaults to a device preview and resumes an exact finished build without submitting again',async()=>{
 const lines=[];const calls=await deliver(undefined,[buildOf('ANDROID'),buildOf('IOS')],null,null,lines);
 assert.equal(calls.length,1);assert.ok(calls[0].includes('ios'));assert.match(lines.at(-1),/Ready to install/);
});
test('ordinary Android preview requires exact platform, source, QA app and internal artifact',async()=>{
 const wrong=[buildOf('IOS'),buildOf('ANDROID',{gitCommitHash:'b'.repeat(40)}),buildOf('ANDROID',{distribution:'STORE'}),buildOf('ANDROID',{project:{id:'other'}}),buildOf('ANDROID',{appIdentifier:'app.platinumcircles.mobile'})];
 const started=buildOf('ANDROID',{status:'IN_QUEUE',artifacts:null}), lines=[];
 const calls=await deliver('android',wrong,[started],buildOf('ANDROID'),lines);
 assert.deepEqual(calls.map(args=>args[2]),['build:list','build','build:view']);
 assert.ok(calls[1].includes('--freeze-credentials'));assert.ok(calls[1].includes('android'));assert.ok(calls[1].includes('preview'));
 assert.match(lines[0],/Tracking internal QA build/);assert.match(lines.at(-1),/Ready to install/);
 await assert.rejects(deliver('android',[],[buildOf('IOS')],null),/Mismatched/);
 await assert.rejects(deliver('android',[started],null,buildOf('ANDROID',{id:'another-build'})),/Different build/);
 await assert.rejects(deliver('android',[buildOf('ANDROID',{artifacts:{}})],null,null),/No installable artifact/);
 await assert.rejects(deliver('all',[],null,null),/Only iOS or Android/);
});
test('a queued existing Android build retains its tracking link without becoming a finished release',async()=>{
 const pending=buildOf('ANDROID',{status:'IN_QUEUE',artifacts:null}),lines=[];
 await assert.rejects(deliver('android',[pending],null,pending,lines),/Build pending/);
 assert.match(lines.at(-1),/Still pending on Expo/);assert.match(lines.at(-1),new RegExp(buildId));
 assert.ok(lines.every(line=>!line.includes('Ready to install')));
});
