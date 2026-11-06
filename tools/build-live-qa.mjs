import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const platform=process.env.QA_BUILD_PLATFORM ?? 'ios';
assert.ok(platform==='ios'||platform==='android','Only iOS or Android internal preview builds are supported');
const sha=process.env.GITHUB_SHA;
assert.match(sha||'',/^[a-f0-9]{40}$/);
assert.equal(process.env.GITHUB_REPOSITORY,'donadmiral/tbirds-nest');
assert.ok(process.env.GITHUB_TOKEN,'The CI read token is required to verify the release gates');
const qualityDeadline=Date.now()+15*60*1000;
let qualityRun,hlsRun;
while(!qualityRun||!hlsRun){
  qualityRun=undefined;hlsRun=undefined;
  const response=await fetch(`https://api.github.com/repos/donadmiral/tbirds-nest/actions/runs?head_sha=${sha}&event=push&per_page=100`,{
    headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
    signal:AbortSignal.timeout(15000),
  });
  assert.ok(response.ok,`Cannot verify quality gate (${response.status})`);
  const result=await response.json();
  const candidate=result.workflow_runs?.filter(run=>run.head_sha===sha&&run.path==='.github/workflows/typecheck.yml')
    .sort((a,b)=>b.id-a.id)[0];
  if(candidate?.status==='completed'){
    assert.equal(candidate.conclusion,'success',`Type and quality gates must pass: ${candidate.html_url}`);
    qualityRun=candidate;
  }
  const hlsCandidate=result.workflow_runs?.filter(run=>run.head_sha===sha&&run.path==='.github/workflows/ios-graded-hls-runtime.yml')
    .sort((a,b)=>b.id-a.id)[0];
  if(hlsCandidate?.status==='completed'){
    assert.equal(hlsCandidate.conclusion,'success',`iOS graded HLS runtime must pass: ${hlsCandidate.html_url}`);
    hlsRun=hlsCandidate;
  }
  if(!qualityRun||!hlsRun){
    assert.ok(Date.now()<qualityDeadline,'Quality or iOS HLS runtime gates are still pending. No QA build was submitted.');
    await new Promise(resolve=>setTimeout(resolve,20000));
  }
}
console.log(`Required quality gates passed: ${qualityRun.html_url}; ${hlsRun.html_url}`);
assert.ok(process.env.EXPO_TOKEN,'EXPO_TOKEN must be provided by the CI secret store');
const profile=JSON.parse(fs.readFileSync('eas.json','utf8')).build.preview;
const app=JSON.parse(fs.readFileSync('app.json','utf8')).expo;
assert.equal(app.extra.eas.projectId,'6962a2bb-3ebe-4ff8-8d35-e4fb58271259');
assert.equal(app.owner,'donadmiral');assert.equal(profile.distribution,'internal');assert.equal(profile.ios.simulator,false);assert.equal(profile.channel,'qa-preview');assert.equal(profile.env.EXPO_PUBLIC_SUPABASE_URL,'https://uaulhuelcfkjwojtymmw.supabase.co');assert.equal(profile.env.EXPO_PUBLIC_APP_ENV,'qa');
assert.equal(profile.android.buildType,'apk');
const run=args=>JSON.parse(execFileSync('npx',['--yes','eas-cli@27.3.0',...args],{encoding:'utf8',stdio:['ignore','pipe','inherit'],timeout:180000,maxBuffer:8*1024*1024}));
const same=b=>b&&b.gitCommitHash===sha&&b.platform===platform.toUpperCase()&&b.buildProfile==='preview'&&b.distribution==='INTERNAL'
  && (!b.project || b.project.id===app.extra.eas.projectId)
  && (!b.appIdentifier || b.appIdentifier==='app.platinumcircles.mobile.qa') && b.isForIosSimulator!==true;
const active=new Set(['NEW','IN_QUEUE','IN_PROGRESS','FINISHED']);
const builds=run(['build:list','--platform',platform,'--build-profile','preview','--git-commit-hash',sha,'--limit','10','--json','--non-interactive']);
assert.ok(Array.isArray(builds));
let build=builds.find(b=>same(b)&&active.has(b.status));
if(!build){
  const result=run(['build','--platform',platform,'--profile','preview','--non-interactive','--freeze-credentials','--no-wait','--json']);
  build=Array.isArray(result)?result[0]:result;
}
assert.ok(same(build),'Mismatched internal QA source, platform or project');
const id=build.id;
assert.match(id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
const url=`https://expo.dev/accounts/donadmiral/projects/platinum-circles/builds/${id}`;
const receipt=()=>({status:build.status,platform:build.platform,source:sha,qualityRunId:qualityRun.id,gradedHLSRunId:hlsRun.id,buildId:id,installPage:url,buildNumber:build.appBuildVersion});
function record(label){
  console.log(label,JSON.stringify(receipt()));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n${label}: ${url}\n${JSON.stringify(receipt())}\n`);
}
// Log the durable Expo tracking page immediately. If CI times out, an already
// submitted build continues on Expo; rerunning this SHA reuses it.
record('Tracking internal QA build');
const deadline=Date.now()+(platform==='android'?35:22)*60*1000;
while(build.status!=='FINISHED'){
  assert.ok(active.has(build.status),`Build failed (${build.status}): ${url}`);
  if(Date.now()>=deadline){record('Still pending on Expo');throw new Error(`Build pending: ${url}`);}
  await new Promise(r=>setTimeout(r,20000));
  build=run(['build:view',id,'--json']);
  assert.ok(same(build)&&build.id===id,'Different build returned while waiting');
}
assert.ok(typeof build.artifacts?.buildUrl==='string'&&build.artifacts.buildUrl.length>0,'No installable artifact returned');
record('Ready to install');
