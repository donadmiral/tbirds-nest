import assert from 'node:assert/strict';import {test} from 'node:test';import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {verifySource} from '../verify-source.mjs';import {publicationInput,publishImage,validateAcceptance} from '../image-receipt.mjs';
test('ASR source verification rejects altered, extra or out-of-scope files before any build command',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'caption-manifest-'));try{
 await mkdir(path.join(folder,'workers/live-transcription'),{recursive:true});const files=[];
 for(let i=0;i<10;i++){const filename=`workers/live-transcription/unit-${i}.mjs`,bytes=Buffer.from(`export const value=${i};\n`);await writeFile(path.join(folder,filename),bytes);files.push({path:filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 const manifest=Buffer.from(JSON.stringify({schema_version:1,files})),hash=createHash('sha256').update(manifest).digest('hex');await writeFile(path.join(folder,'transcription-source-manifest.json'),manifest);
 assert.equal((await verifySource(folder,hash)).file_count,10);await writeFile(path.join(folder,'extra.env'),'synthetic');await assert.rejects(verifySource(folder,hash),/unexpected_file/);await rm(path.join(folder,'extra.env'));
 await writeFile(path.join(folder,files[0].path),'altered');await assert.rejects(verifySource(folder,hash),/file_mismatch/);await assert.rejects(verifySource(folder,'wrong'),/digest_required/);
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('ASR publication requires passing build and distinct manifest-bound tag before any push',()=>{
 const hash='a'.repeat(64),env={CODEBUILD_BUILD_SUCCEEDING:'1',EXPECTED_MANIFEST_SHA256:hash,ASR_REPOSITORY_URI:'123456789012.dkr.ecr.us-east-2.amazonaws.com/shared-live',ASR_IMAGE_TAG:'asr-source-'+hash.slice(0,32),AWS_DEFAULT_REGION:'us-east-2'};
 let calls=0;assert.throws(()=>publishImage({...env,CODEBUILD_BUILD_SUCCEEDING:'0'},()=>{calls++;}),/not_publishable/);assert.equal(calls,0);
 assert.throws(()=>publicationInput({...env,ASR_IMAGE_TAG:'source-'+hash.slice(0,32)}),/tag_mismatch/);assert.throws(()=>publicationInput({...env,AWS_DEFAULT_REGION:'us-east-1'}),/not_publishable/);
 const receipt=publishImage(env,(binary,args)=>{calls++;if(binary==='docker'){assert.deepEqual(args,['push',env.ASR_REPOSITORY_URI+':'+env.ASR_IMAGE_TAG]);return '';}
 assert.equal(binary,'aws');assert.ok(args.includes('imageTag='+env.ASR_IMAGE_TAG));return JSON.stringify({imageDetails:[{imageDigest:'sha256:'+'b'.repeat(64),imageTags:[env.ASR_IMAGE_TAG]}]});});
 assert.equal(calls,2);assert.equal(receipt.deployed,false);assert.equal(receipt.runtime_admission_changed,false);assert.equal(receipt.event,'transcription_image_published');
});
test('ASR publication requires actual UID1000 acceptance and root-owned read-only public metadata',()=>{
 const base={image:'node@sha256:'+'a'.repeat(64)},inventory={ok:true,ffmpeg_version:'9.0.2',base,vulnerability_free_claim:false};
 const acceptance={audio:{ok:true,source_sha256:'6921fe4c44361a62d42049b8d4eafdfedf9836a24db1dbb5c2921f9ef73bd293'},encoder:{base},hosted_transcription_accepted:false,runtime_uid:1000,base_metadata_owner_uid:0,base_metadata_mode:'0444'};
 assert.equal(validateAcceptance(base,inventory,acceptance),true);
 for(const patch of [{runtime_uid:0},{runtime_uid:undefined},{base_metadata_owner_uid:1000},{base_metadata_mode:'0600'},{base_metadata_mode:'0644'},{hosted_transcription_accepted:true}])assert.throws(()=>validateAcceptance(base,inventory,{...acceptance,...patch}),/image_acceptance_missing/);
});
