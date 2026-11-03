import assert from 'node:assert/strict';import {test} from 'node:test';import os from 'node:os';
import {COMPONENTS,validateComponents} from '../encoder-policy.mjs';import {verifyBundledAudio} from '../acceptance.mjs';
const configuration='--disable-everything --disable-autodetect --disable-network --enable-static --disable-avdevice --disable-swscale --disable-gpl';
const config='#define CONFIG_NETWORK 0\n';
const componentConfig=Object.entries(COMPONENTS).flatMap(([kind,names])=>names.map(name=>`#define CONFIG_${name}_${kind} 1`)).join('\n')+'\n';
const packages=['musl-1.2.5-r0','ca-certificates-20261001-r0'];
test('minimal audio encoder inventory requires FLAC and rejects video/network/unapproved packages',()=>{
 const counts=validateComponents(config,componentConfig,configuration,packages);assert.equal(counts.decoder,2);assert.equal(counts.encoder,2);assert.equal(counts.protocol,2);
 for(const extra of ['#define CONFIG_H264_DECODER 1\n','#define CONFIG_HTTP_PROTOCOL 1\n','#define CONFIG_PNG_ENCODER 1\n','#define CONFIG_HLS_DEMUXER 1\n'])assert.throws(()=>validateComponents(config,componentConfig+extra,configuration,packages),/unapproved/);
 assert.throws(()=>validateComponents(config.replace('CONFIG_NETWORK 0','CONFIG_NETWORK 1'),componentConfig,configuration,packages),/network/);
 assert.throws(()=>validateComponents(config,componentConfig.replace('#define CONFIG_FLAC_ENCODER 1\n',''),configuration,packages),/missing_encoder/);
 assert.throws(()=>validateComponents(config,componentConfig,configuration,packages.concat('ffmpeg-5.1-r0')),/unapproved_package/);
});
test('actual FFmpeg header boundary separates frame-thread support from registered codecs',()=>{
 const support=config+'#define CONFIG_FRAME_THREAD_ENCODER 1\n';
 assert.equal(validateComponents(support,componentConfig,configuration,packages).encoder,2);
 // Unknown codecs still fail even if they look like an internal support name.
 assert.throws(()=>validateComponents(config,componentConfig+'#define CONFIG_FRAME_THREAD_ENCODER 1\n',configuration,packages),/unapproved_encoder/);
 assert.throws(()=>validateComponents(support,componentConfig+'#define CONFIG_PNG_ENCODER 1\n',configuration,packages),/unapproved_encoder/);
});
test('bundled noncustomer H264/AAC fixture extracts and decodes valid FLAC on the local toolchain',async()=>{
 const result=await verifyBundledAudio(os.tmpdir());assert.equal(result.ok,true);assert.equal(result.synthetic,true);assert.equal(result.audio_only,true);assert.equal(result.source_sha256,'6921fe4c44361a62d42049b8d4eafdfedf9836a24db1dbb5c2921f9ef73bd293');assert.ok(Math.abs(result.duration_ms-2000)<750);
});
