import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const sha=process.env.GITHUB_SHA;
assert.match(sha||'',/^[a-f0-9]{40}$/);
assert.equal(process.env.GITHUB_REPOSITORY,'donadmiral/tbirds-nest');
assert.ok(process.env.GITHUB_TOKEN,'The CI read token is required to verify the release gates');
const qualityDeadline=Date.now()+15*60*1000;
let qualityRun;
while(!qualityRun){
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
  }else{
    assert.ok(Date.now()<qualityDeadline,'Type and quality gates are still pending. No QA build was submitted.');
    await new Promise(resolve=>setTimeout(resolve,20000));
  }
}
console.log(`Required quality gates passed: ${qualityRun.html_url}`);
assert.ok(process.env.EXPO_TOKEN,'EXPO_TOKEN must be provided by the CI secret store');
const profile=JSON.parse(fs.readFileSync('eas.json','utf8')).build.preview;
const app=JSON.parse(fs.readFileSync('app.json','utf8')).expo;
assert.equal(app.extra.eas.projectId,'6962a2bb-3ebe-4ff8-8d35-e4fb58271259');
assert.equal(app.owner,'donadmiral');assert.equal(profile.distribution,'internal');assert.equal(profile.ios.simulator,false);assert.equal(profile.channel,'qa-preview');assert.equal(profile.env.EXPO_PUBLIC_SUPABASE_URL,'https://uaulhuelcfkjwojtymmw.supabase.co');assert.equal(profile.env.EXPO_PUBLIC_APP_ENV,'qa');
const run=args=>JSON.parse(execFileSync('npx',['--yes','eas-cli@27.3.0',...args],{encoding:'utf8',stdio:['ignore','pipe','inherit'],timeout:180000,maxBuffer:8*1024*1024}));
const same=b=>b&&b.gitCommitHash===sha&&b.platform==='IOS'&&b.buildProfile==='preview'&&b.distribution==='INTERNAL';
const active=new Set(['NEW','IN_QUEUE','IN_PROGRESS','FINISHED']);
let builds=run(['build:list','--platform','ios','--build-profile','preview','--git-commit-hash',sha,'--limit','10','--json','--non-interactive']);assert.ok(Array.isArray(builds));
let build=builds.find(b=>same(b)&&active.has(b.status));
if(!build){const submitted=run(['build','--platform','ios','--profile','preview','--non-interactive','--no-wait','--json']);build=Array.isArray(submitted)?submitted[0]:submitted;}
assert.ok(same(build),'Mismatched QA source or profile');assert.match(build.id,/^[a-f0-9-]{36}$/i);
const url=`https://expo.dev/accounts/donadmiral/projects/platinum-circles/builds/${build.id}`;
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nQA build: ${url}\nSource: ${sha}\n`);
const deadline=Date.now()+22*60*1000;
while(build.status!=='FINISHED'){assert.ok(active.has(build.status),`Build failed: ${url}`);assert.ok(Date.now()<deadline,`Build pending: ${url}`);await new Promise(r=>setTimeout(r,20000));build=run(['build:view',build.id,'--json']);assert.ok(same(build));}
assert.ok(typeof build.artifacts?.buildUrl==='string');
const receipt={status:'FINISHED',source:sha,qualityRunId:qualityRun.id,buildId:build.id,installPage:url,buildNumber:build.appBuildVersion};
console.log(JSON.stringify(receipt));fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nReady to install: ${url}\n${JSON.stringify(receipt)}\n`);
