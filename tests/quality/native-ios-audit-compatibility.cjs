const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

test('normal audit requires the original exact-device readiness proof and bounded actual bundle checks', () => {
  const script = String.raw`
import copy,importlib.util,json,plistlib,subprocess,tempfile,types
from pathlib import Path
from unittest import mock
p=Path('scripts/quality/native-ui-audit-runner.py');s=importlib.util.spec_from_file_location('runner',p);r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
with tempfile.TemporaryDirectory() as temp:
 app=Path(temp)/'PlatinumQA.app';app.mkdir();(app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':r.PACKAGE,'CFBundleExecutable':'PlatinumQA','DTPlatformName':'iphonesimulator','DTSDKName':'iphonesimulator18.5','MinimumOSVersion':'15.1'}))
 runtime='com.apple.CoreSimulator.SimRuntime.iOS-18-5';device_type='com.apple.CoreSimulator.SimDeviceType.iPhone-16';device='11111111-1111-4111-8111-111111111111';source='a'*40
 compat={'abi':'x86_64','runtimeIdentifier':runtime,'sdk':'iphonesimulator18.5','minimumOSVersion':'15.1'};toolchain={'xcode':'Xcode 16.4\nBuild version 16F6','sdkVersion':'18.5'}
 prepared={'device':device,'created':True,'bootReady':True,'sourceCommit':source,'runtimeIdentifier':runtime,'deviceTypeIdentifier':device_type,'verification':{'selectedDevice':device,'runtimeIdentifier':runtime,'runtimeVersion':'18.5','deviceTypeIdentifier':device_type,'runtimeAvailabilityVerified':True,'stateAtVerification':'Shutdown'}}
 outputs={('/usr/bin/uname','-m'):'x86_64',('xcodebuild','-version'):toolchain['xcode'],('xcrun','--sdk','iphonesimulator','--show-sdk-version'):'18.5',('xcrun','lipo',str(app/'PlatinumQA'),'-archs'):'x86_64',('codesign','--verify','--deep','--strict',str(app)):''}
 calls=[]
 def output(args,timeout):
  calls.append((args,timeout))
  if 'simctl' in args:raise subprocess.TimeoutExpired(args,timeout)
  return outputs[tuple(args)]
 bounded=types.SimpleNamespace(read_command=output)
 with mock.patch.object(r,'ios_setup_helper',return_value=bounded),mock.patch.object(r.subprocess,'check_output',side_effect=AssertionError('Raw subprocess read must not run')),mock.patch('platform.system',return_value='Darwin'):
  proof=r.validate_device('ios',device,compat,binary=app,toolchain=toolchain,prepared=prepared,source_commit=source)
  assert proof['codeSignatureVerified'] and not proof['guestUnameInvoked']
  assert proof['exactUuidBootstatusCompleted'] and proof['prebootRuntimeAvailabilityVerified']
  assert not proof['postbootMetadataRead'] and not proof['postbootIdentityAndVersionReadFromDevice']
  assert len(calls)==5 and all(timeout==30 for args,timeout in calls)
  assert not any('simctl' in args for args,timeout in calls)
  for field,value in [('device','22222222-2222-4222-8222-222222222222'),('sourceCommit','b'*40),('created',False),('bootReady',False),('runtimeIdentifier','wrong'),('deviceTypeIdentifier','wrong')]:
   changed=copy.deepcopy(prepared);changed[field]=value;before=len(calls)
   try:r.validate_device('ios',device,compat,binary=app,toolchain=toolchain,prepared=changed,source_commit=source)
   except ValueError:pass
   else:raise AssertionError('Wrong setup proof accepted: '+field)
   assert len(calls)==before
  for field,value in [('selectedDevice','wrong'),('runtimeIdentifier','wrong'),('runtimeVersion','18.6'),('deviceTypeIdentifier','wrong'),('runtimeAvailabilityVerified',False),('stateAtVerification','Booted')]:
   changed=copy.deepcopy(prepared);changed['verification'][field]=value
   try:r.validate_device('ios',device,compat,binary=app,toolchain=toolchain,prepared=changed,source_commit=source)
   except ValueError:pass
   else:raise AssertionError('Unverified preboot metadata accepted: '+field)
  outputs[('xcrun','lipo',str(app/'PlatinumQA'),'-archs')]='arm64'
  try:r.validate_device('ios',device,compat,binary=app,toolchain=toolchain,prepared=prepared,source_commit=source)
  except ValueError:pass
  else:raise AssertionError('wrong actual Mach-O was accepted')
  for kwargs in [{},{'binary':app,'toolchain':toolchain},{'binary':app,'toolchain':toolchain,'prepared':prepared}]:
   try:r.validate_device('ios',device,compat,**kwargs)
   except ValueError:pass
   else:raise AssertionError('missing actual binary/toolchain/source/setup accepted')
print('normal actual-function integration preserves original readiness and actual app checks')
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /normal actual-function integration preserves/);
});

test('normal iOS runner requires the starter receipt and never launches cases after a failed120-second install', () => {
  const script = String.raw`
import importlib.util,json,os,plistlib,subprocess,sys,tempfile,types
from pathlib import Path
from unittest import mock
p=Path('scripts/quality/native-ui-audit-runner.py');s=importlib.util.spec_from_file_location('runner',p);r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);app=root/'PlatinumQA.app';app.mkdir();(app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':r.PACKAGE,'CFBundleExecutable':'PlatinumQA','DTPlatformName':'iphonesimulator','DTSDKName':'iphonesimulator18.5','MinimumOSVersion':'15.1'}));(app/'PlatinumQA').write_bytes(b'controlled-binary-boundary')
 runtime='com.apple.CoreSimulator.SimRuntime.iOS-18-5';device_type='com.apple.CoreSimulator.SimDeviceType.iPhone-16';device='11111111-1111-4111-8111-111111111111';source='a'*40;tree='b'*40
 compat={'abi':'x86_64','runtimeIdentifier':runtime,'sdk':'iphonesimulator18.5','minimumOSVersion':'15.1'};toolchain={'xcode':'Xcode 16.4\nBuild version 16F6','sdkVersion':'18.5'}
 prepared={'device':device,'created':True,'bootReady':True,'sourceCommit':source,'runtimeIdentifier':runtime,'deviceTypeIdentifier':device_type,'verification':{'selectedDevice':device,'runtimeIdentifier':runtime,'runtimeVersion':'18.5','deviceTypeIdentifier':device_type,'runtimeAvailabilityVerified':True,'stateAtVerification':'Shutdown'}}
 receipt=root/'setup.json';receipt.write_text(json.dumps(prepared))
 manifest=root/'manifest.json';manifest.write_text(json.dumps({'applicationSourceCommit':source,'applicationSourceTree':tree,'platform':'ios','packageId':r.PACKAGE,'kind':'disposable-native-audit','configuration':'Release','binarySha256':r.binary_digest(app),'auditManifestSha256':r.sha256_file(Path('tests/native/audit/manifest.json')),'nativeCompatibility':compat,'toolchain':toolchain,'sourceReceiptSha256':'c'*64}))
 outputs={('/usr/bin/uname','-m'):'x86_64',('xcodebuild','-version'):toolchain['xcode'],('xcrun','--sdk','iphonesimulator','--show-sdk-version'):'18.5',('xcrun','lipo',str(app/'PlatinumQA'),'-archs'):'x86_64',('codesign','--verify','--deep','--strict',str(app)):''}
 calls=[]
 def read(args,timeout):assert timeout==30;return outputs[tuple(args)]
 def fail_install(command,stage,timeout,records,path):
  calls.append((command,stage,timeout));assert command==['xcrun','simctl','install',device,str(app)] and stage=='install' and timeout==120
  raise subprocess.TimeoutExpired(command,timeout)
 helper=types.SimpleNamespace(read_command=read,setup_read=fail_install)
 arguments=['runner','--platform','ios','--device',device,'--binary',str(app),'--binary-manifest',str(manifest),'--expected-source',source,'--expected-tree',tree,'--output',str(root/'result')]
 with mock.patch.object(r,'ios_setup_helper',return_value=helper),mock.patch.object(r,'run_cases') as cases,mock.patch('platform.system',return_value='Darwin'),mock.patch.dict(os.environ,{'CI':'true'}):
  with mock.patch.object(sys,'argv',arguments):
   try:r.main()
   except ValueError as error:assert 'receipt' in str(error)
   else:raise AssertionError('Missing setup receipt was accepted')
  assert not calls and not cases.called
  with mock.patch.object(sys,'argv',arguments+['--device-setup',str(receipt)]):assert r.main()==1
  assert len(calls)==1 and not cases.called
  failure=json.loads((root/'result/setup-failure.json').read_text());assert failure['stage']=='install' and failure['attemptedCases']==0
  proof=json.loads((root/'result/device-compatibility.json').read_text());assert proof['exactUuidBootstatusCompleted'] and not proof['postbootMetadataRead']
print('Actual runner main retains install failure and requires real starter receipt')
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Actual runner main retains install failure/);
});
