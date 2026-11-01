const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

test('normal audit requires exact preboot immutable proof and never repeats host clients after boot', () => {
  const script = String.raw`
import copy,importlib.util,json,os,plistlib,subprocess,tempfile,types
from pathlib import Path
from unittest import mock
p=Path('scripts/quality/native-ui-audit-runner.py');s=importlib.util.spec_from_file_location('runner',p);r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
with tempfile.TemporaryDirectory() as temp:
 app=Path(temp)/'PlatinumQA.app';app.mkdir();(app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':r.PACKAGE,'CFBundleExecutable':'PlatinumQA','DTPlatformName':'iphonesimulator','DTSDKName':'iphonesimulator18.5','MinimumOSVersion':'15.1'}))
 runtime='com.apple.CoreSimulator.SimRuntime.iOS-18-5';device_type='com.apple.CoreSimulator.SimDeviceType.iPhone-16';device='11111111-1111-4111-8111-111111111111';source='a'*40
 compat={'abi':'x86_64','runtimeIdentifier':runtime,'sdk':'iphonesimulator18.5','minimumOSVersion':'15.1'};toolchain={'xcode':'Xcode 16.4\nBuild version 16F6','sdkVersion':'18.5'}
 prepared={'device':device,'created':True,'bootReady':True,'sourceCommit':source,'runtimeIdentifier':runtime,'deviceTypeIdentifier':device_type,'verification':{'selectedDevice':device,'runtimeIdentifier':runtime,'runtimeVersion':'18.5','deviceTypeIdentifier':device_type,'runtimeAvailabilityVerified':True,'stateAtVerification':'Shutdown'}}
 outputs={('/usr/bin/uname','-m'):'x86_64',('xcodebuild','-version'):toolchain['xcode'],('xcrun','--sdk','iphonesimulator','--show-sdk-version'):'18.5',('xcrun','lipo',str(app/'PlatinumQA'),'-archs'):'x86_64',('codesign','--verify','--deep','--strict',str(app)):''}
 def load(name,file):
  spec=importlib.util.spec_from_file_location(name,Path('scripts/quality')/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
 pre=load('preflight','native-ui-ios-immutable-preflight.py');verification=load('compatibility','native-ui-ios-compatibility.py')
 bound={'applicationSourceCommit':source,'applicationSourceTree':'b'*40,'binarySha256':r.binary_digest(app),'nativeCompatibility':compat,'toolchain':toolchain}
 calls=[]
 def output(args,timeout):
  calls.append((args,timeout))
  if 'simctl' in args:raise subprocess.TimeoutExpired(args,timeout)
  return outputs[tuple(args)]
 actual=verification.verify_immutable_compatibility(app,bound,lambda args:output(args,30),host_system='Darwin')
 records=[{'stage':stage,'status':'completed','exitCode':0,'timeoutSeconds':30,'startedAtEpochMs':1000+i*100,'finishedAtEpochMs':1050+i*100,'elapsedSeconds':0.04,'stdoutTruncated':False,'stdoutTail':outputs[tuple(calls[i][0])]} for i,stage in enumerate(pre.STAGES)]
 immutable={'schemaVersion':1,'kind':'native-ios-immutable-preflight','applicationSourceCommit':source,'applicationSourceTree':'b'*40,'binaryManifestSha256':'c'*64,'binarySha256':bound['binarySha256'],'binaryPath':str(app.resolve()),'developerDirectory':os.environ.get('DEVELOPER_DIR'),'immutableCompatibility':actual,'commands':records}
 prepared.update(immutablePreflightSha256='d'*64,immutablePreflightFinishedAtEpochMs=1450,createdAfterImmutablePreflightAtEpochMs=1500)
 def validate(receipt=prepared,immutable_proof=immutable):
  return r.validate_device('ios',device,compat,binary=app,toolchain=toolchain,prepared=receipt,source_commit=source,source_tree='b'*40,binary_manifest_sha='c'*64,preflight=immutable_proof,preflight_sha='d'*64)
 with mock.patch.object(r,'ios_setup_helper',side_effect=AssertionError('No postboot host tool')),mock.patch.object(r.subprocess,'check_output',side_effect=AssertionError('No postboot raw host tool')):
  proof=validate()
  assert proof['codeSignatureVerified'] and not proof['guestUnameInvoked']
  assert proof['exactUuidBootstatusCompleted'] and proof['prebootRuntimeAvailabilityVerified']
  assert not proof['postbootMetadataRead'] and not proof['postbootIdentityAndVersionReadFromDevice']
  assert proof['immutableCompatibilityVerifiedBeforeDeviceCreation'] and not proof['postbootImmutableProbesRepeated']
  assert len(calls)==5 and all(timeout==30 for args,timeout in calls)
  assert not any('simctl' in args for args,timeout in calls)
  for field,value in [('device','22222222-2222-4222-8222-222222222222'),('sourceCommit','b'*40),('created',False),('bootReady',False),('runtimeIdentifier','wrong'),('deviceTypeIdentifier','wrong')]:
   changed=copy.deepcopy(prepared);changed[field]=value;before=len(calls)
   try:validate(changed)
   except ValueError:pass
   else:raise AssertionError('Wrong setup proof accepted: '+field)
   assert len(calls)==before
  for field,value in [('selectedDevice','wrong'),('runtimeIdentifier','wrong'),('runtimeVersion','18.6'),('deviceTypeIdentifier','wrong'),('runtimeAvailabilityVerified',False),('stateAtVerification','Booted')]:
   changed=copy.deepcopy(prepared);changed['verification'][field]=value
   try:validate(changed)
   except ValueError:pass
   else:raise AssertionError('Unverified preboot metadata accepted: '+field)
  bad=[]
  for field,value in [('binarySha256','e'*64),('applicationSourceTree','e'*40),('developerDirectory','/different/Xcode')]:
   changed=copy.deepcopy(immutable);changed[field]=value;bad.append(changed)
  for field,value in [('actualExecutableArchitecture','arm64'),('codeSignatureVerified',False),('sdkVersion','18.6')]:
   changed=copy.deepcopy(immutable);changed['immutableCompatibility'][field]=value;bad.append(changed)
  for field,value in [('exitCode',False),('timeoutSeconds',60),('status','failed'),('stdoutTail','18.6'),('elapsedSeconds',float('nan'))]:
   changed=copy.deepcopy(immutable);changed['commands'][2][field]=value;bad.append(changed)
  for changed in bad:
   try:validate(immutable_proof=changed)
   except ValueError:pass
   else:raise AssertionError('Unbound or failed immutable preflight accepted')
  for field,value in [('immutablePreflightSha256','e'*64),('immutablePreflightFinishedAtEpochMs',True),('createdAfterImmutablePreflightAtEpochMs',1400)]:
   changed=copy.deepcopy(prepared);changed[field]=value
   try:validate(changed)
   except ValueError:pass
   else:raise AssertionError('Unbound preboot ordering accepted')
  before=len(calls);original=(app/'Info.plist').read_bytes();(app/'Info.plist').write_bytes(original+b' ')
  try:validate()
  except ValueError:pass
  else:raise AssertionError('Changed actual app bytes accepted')
  (app/'Info.plist').write_bytes(original);assert len(calls)==before
  for kwargs in [{},{'binary':app,'toolchain':toolchain},{'binary':app,'toolchain':toolchain,'prepared':prepared}]:
   try:r.validate_device('ios',device,compat,**kwargs)
   except ValueError:pass
   else:raise AssertionError('missing actual binary/toolchain/source/setup accepted')
 outputs[('xcrun','lipo',str(app/'PlatinumQA'),'-archs')]='arm64'
 try:verification.verify_immutable_compatibility(app,bound,lambda args:output(args,30),host_system='Darwin')
 except ValueError:pass
 else:raise AssertionError('wrong actual preboot Mach-O was accepted')
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
 manifest=root/'manifest.json';manifest.write_text(json.dumps({'applicationSourceCommit':source,'applicationSourceTree':tree,'platform':'ios','packageId':r.PACKAGE,'kind':'disposable-native-audit','configuration':'Release','binarySha256':r.binary_digest(app),'auditManifestSha256':r.sha256_file(Path('tests/native/audit/manifest.json')),'nativeCompatibility':compat,'toolchain':toolchain,'sourceReceiptSha256':'c'*64}))
 outputs={('/usr/bin/uname','-m'):'x86_64',('xcodebuild','-version'):toolchain['xcode'],('xcrun','--sdk','iphonesimulator','--show-sdk-version'):'18.5',('xcrun','lipo',str(app/'PlatinumQA'),'-archs'):'x86_64',('codesign','--verify','--deep','--strict',str(app)):''}
 calls=[]
 def read(args,timeout):assert timeout==30;return outputs[tuple(args)]
 def load(name,file):
  spec=importlib.util.spec_from_file_location(name,Path('scripts/quality')/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
 pre=load('preflight','native-ui-ios-immutable-preflight.py');verification=load('compatibility','native-ui-ios-compatibility.py')
 bound=json.loads(manifest.read_text());actual=verification.verify_immutable_compatibility(app,bound,lambda args:read(args,30),host_system='Darwin')
 records=[{'stage':stage,'status':'completed','exitCode':0,'timeoutSeconds':30,'startedAtEpochMs':1000+i*100,'finishedAtEpochMs':1050+i*100,'elapsedSeconds':0.04,'stdoutTruncated':False,'stdoutTail':value} for i,(stage,value) in enumerate(zip(pre.STAGES,outputs.values()))]
 immutable={'schemaVersion':1,'kind':'native-ios-immutable-preflight','applicationSourceCommit':source,'applicationSourceTree':tree,'binaryManifestSha256':r.sha256_file(manifest),'binarySha256':bound['binarySha256'],'binaryPath':str(app.resolve()),'developerDirectory':os.environ.get('DEVELOPER_DIR'),'immutableCompatibility':actual,'commands':records}
 preflight=root/'immutable.json';preflight.write_text(json.dumps(immutable));prepared.update(immutablePreflightSha256=r.sha256_file(preflight),immutablePreflightFinishedAtEpochMs=1450,createdAfterImmutablePreflightAtEpochMs=1500)
 receipt=root/'setup.json';receipt.write_text(json.dumps(prepared))
 def fail_install(command,stage,timeout,records,path):
  calls.append((command,stage,timeout));assert command==['xcrun','simctl','install',device,str(app)] and stage=='install' and timeout==120
  raise subprocess.TimeoutExpired(command,timeout)
 helper=types.SimpleNamespace(read_command=lambda *a,**k:(_ for _ in ()).throw(AssertionError('No postboot host probe')),setup_read=fail_install)
 arguments=['runner','--platform','ios','--device',device,'--binary',str(app),'--binary-manifest',str(manifest),'--expected-source',source,'--expected-tree',tree,'--output',str(root/'result')]
 with mock.patch.object(r,'ios_setup_helper',return_value=helper),mock.patch.object(r,'run_cases') as cases,mock.patch('platform.system',return_value='Darwin'),mock.patch.dict(os.environ,{'CI':'true'}):
  with mock.patch.object(sys,'argv',arguments):
   try:r.main()
   except ValueError as error:assert 'receipt' in str(error)
   else:raise AssertionError('Missing setup receipt was accepted')
  assert not calls and not cases.called
  with mock.patch.object(sys,'argv',arguments+['--device-setup',str(receipt)]):
   try:r.main()
   except ValueError as error:assert 'preflight' in str(error)
   else:raise AssertionError('Missing immutable preflight was accepted')
  assert not calls and not cases.called
  with mock.patch.object(sys,'argv',arguments+['--device-setup',str(receipt),'--immutable-preflight',str(preflight)]):assert r.main()==1
  assert len(calls)==1 and not cases.called
  failure=json.loads((root/'result/setup-failure.json').read_text());assert failure['stage']=='install' and failure['attemptedCases']==0
  proof=json.loads((root/'result/device-compatibility.json').read_text());assert proof['exactUuidBootstatusCompleted'] and not proof['postbootMetadataRead']
print('Actual runner main retains install failure and requires real starter receipt')
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Actual runner main retains install failure/);
});
