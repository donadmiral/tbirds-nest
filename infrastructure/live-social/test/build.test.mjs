import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {resolveBase,NODE_TAG} from '../resolve-base.mjs';
import {verifySource} from '../verify-source.mjs';
import {publicationInput,publishImage,validateAcceptance} from '../image-receipt.mjs';
import {reviewScan} from '../scan-receipt.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),digest='sha256:'+'b'.repeat(64),manifest='a'.repeat(64);
const env={CODEBUILD_BUILD_SUCCEEDING:'1',EXPECTED_MANIFEST_SHA256:manifest,RENDERER_REPOSITORY_URI:'518317808503.dkr.ecr.us-east-2.amazonaws.com/reviewed-repository',AWS_DEFAULT_REGION:'us-east-2',SOCIAL_IMAGE_TAG:'social-source-'+manifest.slice(0,32)};
test('base resolver binds exact official Node tag, AMD64 and immutable digest',()=>{
 const calls=[];const run=(command,args)=>{calls.push({command,args});return JSON.stringify([{Architecture:'amd64',Os:'linux',RepoDigests:['node@'+digest],Config:{Env:['NODE_VERSION=24.22.2']}}]);};const receipt=resolveBase(run);assert.equal(receipt.image,'node@'+digest);assert.equal(receipt.tag,NODE_TAG);assert.deepEqual(calls[0].args,['pull','--platform','linux/amd64',NODE_TAG]);
 for(const change of [{Architecture:'arm64'},{RepoDigests:['node:24-alpine']},{Config:{Env:['NODE_VERSION=24.0.0']}}])assert.throws(()=>resolveBase(()=>JSON.stringify([{Architecture:'amd64',Os:'linux',RepoDigests:['node@'+digest],Config:{Env:['NODE_VERSION=24.22.2']},...change}])));
});
test('source gate checks exact manifest and refuses additions, traversal, symlinks and modified files',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'social-build-'));
 try{
  const files=[];for(let i=0;i<10;i++){const name=`workers/live-social/test/fixture${i}.mjs`,bytes=Buffer.from(`export const fixture=${i};`);await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),bytes);files.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}
  const text=JSON.stringify({schema_version:1,files}),expected=hash(text);await writeFile(path.join(root,'social-source-manifest.json'),text);
  assert.equal((await verifySource(root,expected)).file_count,10);await assert.rejects(verifySource(root,'b'.repeat(64)),/source_manifest_mismatch/);
  await writeFile(path.join(root,'unexpected-secret.env'),'synthetic');await assert.rejects(verifySource(root,expected),/source_unexpected_file/);await rm(path.join(root,'unexpected-secret.env'));
  await writeFile(path.join(root,files[0].path),'tampered');await assert.rejects(verifySource(root,expected),/source_file_mismatch/);
  await rm(path.join(root,files[0].path));await symlink(path.join(root,files[1].path),path.join(root,files[0].path));await assert.rejects(verifySource(root,expected),/source_file_mismatch/);
  const traversed=JSON.stringify({schema_version:1,files:[{...files[0],path:'../foreign.mjs'},...files.slice(1)]});await writeFile(path.join(root,'social-source-manifest.json'),traversed);await assert.rejects(verifySource(root,hash(traversed)),/source_entry_invalid/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('publication uses a distinct immutable social source tag and refuses failed builds before any push',()=>{
 assert.equal(publicationInput(env).tag,env.SOCIAL_IMAGE_TAG);let calls=0;
 for(const patch of [{CODEBUILD_BUILD_SUCCEEDING:'0'},{SOCIAL_IMAGE_TAG:'source-'+manifest.slice(0,32)},{AWS_DEFAULT_REGION:'eu-west-1'},{RENDERER_REPOSITORY_URI:'https://evil.example'}])assert.throws(()=>publishImage({...env,...patch},()=>{calls++;}));assert.equal(calls,0);
 const result=publishImage(env,(command,args)=>{calls++;return command==='aws'?JSON.stringify({imageDetails:[{imageDigest:digest,imageTags:[env.SOCIAL_IMAGE_TAG]}]}):'';});assert.equal(calls,2);assert.equal(result.image_digest,digest);assert.equal(result.image_scan_status,'pending_owner_review');assert.equal(result.deployed,false);
});
test('image publication requires actual container inventory and explicitly synthetic offline acceptance',()=>{
 const base={image:'node@'+digest,node_version:'24.22.2',tag:NODE_TAG};const inventory={ok:true,node_version:'v24.22.2',uid:1000,base,vulnerability_free_claim:false,ffmpeg_present:false,package_managers_removed:true,application_dependencies:[],packages:['musl-1.2.5-r1']};const accepted={ok:true,base_image:base.image,base_metadata_owner_uid:0,base_metadata_mode:'0444',actual_worker_flow_passed:true,private_scratch_permissions:true,scratch_cleanup_passed:true,provider_responses:'synthetic_offline_fixtures',hosted_provider_accepted:false,external_posts_created:false};
 assert.equal(validateAcceptance(base,inventory,accepted),true);for(const patch of [{ok:false},{hosted_provider_accepted:true},{scratch_cleanup_passed:false},{base_image:'node@sha256:'+'c'.repeat(64)},{base_metadata_mode:'0600'},{base_metadata_owner_uid:1000}])assert.throws(()=>validateAcceptance(base,inventory,{...accepted,...patch}));assert.throws(()=>validateAcceptance(base,{...inventory,uid:0},accepted));
});
test('scan metadata binds exact digest and never treats pending or severe findings as an activation pass',()=>{
 const input={repositoryName:'reviewed-repository',imageId:{imageDigest:digest},imageScanStatus:{status:'COMPLETE'},imageScanFindings:{findingSeverityCounts:{HIGH:1}}};assert.equal(reviewScan(input,digest,input.repositoryName).passes_high_critical_gate,false);
 const clean={...input,imageScanFindings:{findingSeverityCounts:{}}};assert.equal(reviewScan(clean,digest,input.repositoryName).passes_high_critical_gate,true);assert.equal(reviewScan(clean,digest,input.repositoryName).vulnerability_free_claim,false);assert.equal(reviewScan({...clean,imageScanStatus:{status:'IN_PROGRESS'}},digest,input.repositoryName).passes_high_critical_gate,false);assert.throws(()=>reviewScan(clean,'sha256:'+'c'.repeat(64),input.repositoryName));assert.throws(()=>reviewScan({...clean,imageScanFindings:undefined},digest,input.repositoryName));
});
test('shared CodeBuild specification requires offline resource-bounded containers and an explicit separate buildspec',async()=>{
 const text=await readFile(new URL('../buildspec.yml',import.meta.url),'utf8');assert.match(text,/node infrastructure\/live-social\/verify-source\.mjs/);assert.match(text,/social-source-/);assert.equal((text.match(/docker run/g)||[]).length,3);assert.equal((text.match(/--network none/g)||[]).length,3);assert.equal((text.match(/--read-only/g)||[]).length,3);assert.equal((text.match(/--cap-drop ALL/g)||[]).length,3);assert.ok(!text.includes('LIVE_SOCIAL_WORKER_SECRET'));assert.ok(!text.includes('secretsmanager'));
 const docker=await readFile(new URL('../../../workers/live-social/Dockerfile',import.meta.url),'utf8');assert.match(docker,/ARG SOCIAL_NODE_IMAGE\nFROM \$\{SOCIAL_NODE_IMAGE\}/);assert.match(docker,/USER node/);assert.ok(!docker.includes('apk add'));assert.match(docker,/rm -rf \/usr\/local\/lib\/node_modules/);
 // The generated file is0600/root-owned; plain COPY makes the runtime's first
 // metadata read fail. Keep it root-owned but explicitly readable/nonwritable.
 assert.match(docker,/COPY --chmod=0444 social-base-image\.json \/usr\/local\/share\/pc-live-social\/base-image\.json/);
});
