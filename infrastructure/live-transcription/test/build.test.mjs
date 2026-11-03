import assert from 'node:assert/strict';import {test} from 'node:test';import {readFile} from 'node:fs/promises';import {resolveBase,NODE_TAG} from '../resolve-base.mjs';
test('base resolution requires official amd64 digest and exact Node release before emitting manifest',()=>{
 const calls=[],run=(binary,args)=>{calls.push([binary,args]);return JSON.stringify([{Architecture:'amd64',Os:'linux',RepoDigests:['node@sha256:'+'a'.repeat(64)],Config:{Env:['NODE_VERSION=24.22.2']}}]);};
 const base=resolveBase(run);assert.equal(base.image,'node@sha256:'+'a'.repeat(64));assert.equal(base.node_version,'24.22.2');assert.equal(calls[0][1][3],NODE_TAG);
 assert.throws(()=>resolveBase((binary,args)=>args[0]==='pull'?'':JSON.stringify([{Architecture:'arm64',Os:'linux'}])),/architecture/);
 assert.throws(()=>resolveBase((binary,args)=>args[0]==='pull'?'':JSON.stringify([{Architecture:'amd64',Os:'linux',RepoDigests:['node:mutable'],Config:{Env:['NODE_VERSION=24.22.2']}}])),/digest/);
});
test('Docker production build omits broad OS FFmpeg, authenticates exact source and removes package managers',async()=>{
 const docker=await readFile(new URL('../../../workers/live-transcription/Dockerfile',import.meta.url),'utf8');
 const script=await readFile(new URL('../../../workers/live-transcription/build-encoder.sh',import.meta.url),'utf8');
 assert.ok(docker.includes('ARG ASR_NODE_IMAGE'));assert.ok(!docker.includes('apt-get'));assert.ok(!/apk add[^\n]*ffmpeg/.test(docker));assert.ok(docker.includes('encoder-policy.mjs --write-inventory'));assert.ok(docker.includes('rm -f /usr/local/bin/npm'));
 assert.match(docker,/COPY --chmod=0444 transcription-base-image\.json \/usr\/local\/share\/pc-live-transcription\/base-image\.json/);
 assert.ok(script.includes('FFMPEG_VERSION=9.0.2'));assert.ok(script.includes('sha256sum -c -'));assert.ok(script.includes('VALIDSIG'));assert.ok(script.includes('--disable-network'));assert.ok(script.includes('--enable-encoder=flac,pcm_s16le'));assert.ok(!script.includes('--enable-decoder=h264'));
});
