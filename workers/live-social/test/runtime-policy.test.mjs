import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeInventory,runtimeFailureCode} from '../runtime-policy.mjs';
const base={tag:'node:24.22.2-alpine3.24',image:'node@sha256:'+'a'.repeat(64),node_version:'24.22.2',architecture:'amd64'};
const runtime={version:'v24.22.2',platform:'linux',arch:'x64',getuid:()=>1000,versions:{node:'24.22.2',openssl:'synthetic-3.5.4',undici:'synthetic-7.24.0',v8:'synthetic-13.6',uv:'synthetic-1.51.0'}};
const fixture=patch=>({read:file=>file.endsWith('base-image.json')?JSON.stringify(base):'3.24.1',exists:()=>false,execute:(command,args)=>{assert.equal(command,'apk');assert.deepEqual(args,['info','-v']);return 'musl-1.2.5-r1\nbusybox-1.37.0-r1\n';},runtime,...patch});
test('runtime receipt records exact base, OS packages and bundled components without a vulnerability-free claim',()=>{
 const result=runtimeInventory(fixture());assert.equal(result.ok,true);assert.equal(result.uid,1000);assert.equal(result.base.image,base.image);assert.equal(result.runtime_components.openssl,runtime.versions.openssl);assert.equal(result.ffmpeg_present,false);assert.equal(result.vulnerability_free_claim,false);assert.deepEqual(result.application_dependencies,[]);
});
test('runtime policy refuses root, foreign architecture and mismatched Node version',()=>{
 for(const patch of [{getuid:()=>0},{arch:'arm64'},{platform:'darwin'},{version:'v24.21.0'}])assert.throws(()=>runtimeInventory(fixture({runtime:{...runtime,...patch}})),/runtime_identity_invalid/);
});
test('runtime policy refuses unexpected encoders, compilers and package-manager code',()=>{
 for(const file of ['/usr/bin/ffmpeg','/usr/local/bin/ffprobe','/usr/local/bin/npm','/usr/bin/gcc','/app/workers/live-social/node_modules'])assert.throws(()=>runtimeInventory(fixture({exists:path=>path===file})),/unneeded_runtime_component/);
});
test('runtime inventory requires digest-pinned expected Alpine base and bounded package metadata',()=>{
 for(const patch of [{image:'node:24-alpine'},{tag:'node:24.22.2-bookworm-slim'},{architecture:'arm64'}])assert.throws(()=>runtimeInventory(fixture({read:file=>file.endsWith('base-image.json')?JSON.stringify({...base,...patch}):'3.24.1'})),/base_receipt_invalid/);
 assert.throws(()=>runtimeInventory(fixture({execute:()=>'<untrusted provider text>'})),/runtime_inventory_invalid/);
 assert.throws(()=>runtimeInventory(fixture({runtime:{...runtime,versions:{}}})),/runtime_components_invalid/);
});
test('runtime failure diagnostics expose only finite policy codes and never raw path or process output',()=>{
 assert.equal(runtimeFailureCode(Object.assign(new Error('secret-canary /private/path'),{code:'EACCES'})),'inventory_permission_denied');
 assert.equal(runtimeFailureCode(new Error('runtime_components_invalid')),'runtime_components_invalid');
 assert.equal(runtimeFailureCode(new Error('secret-canary /private/path')),'runtime_inventory_unavailable');
});
