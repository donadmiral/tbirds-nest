const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

test('normal audit runner uses the same actual bundle/host/runtime compatibility check', () => {
  const script = String.raw`
import importlib.util,json,plistlib,tempfile
from pathlib import Path
from unittest import mock
p=Path('scripts/quality/native-ui-audit-runner.py');s=importlib.util.spec_from_file_location('runner',p);r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
with tempfile.TemporaryDirectory() as temp:
 app=Path(temp)/'PlatinumQA.app';app.mkdir();(app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':r.PACKAGE,'CFBundleExecutable':'PlatinumQA','DTPlatformName':'iphonesimulator','DTSDKName':'iphonesimulator18.5','MinimumOSVersion':'15.1'}))
 runtime='com.apple.CoreSimulator.SimRuntime.iOS-18-5';compat={'abi':'x86_64','runtimeIdentifier':runtime,'sdk':'iphonesimulator18.5','minimumOSVersion':'15.1'};toolchain={'xcode':'Xcode 16.4\nBuild version 16F6','sdkVersion':'18.5'}
 outputs={('/usr/bin/uname','-m'):b'x86_64',('xcodebuild','-version'):toolchain['xcode'].encode(),('xcrun','--sdk','iphonesimulator','--show-sdk-version'):b'18.5',('xcrun','lipo',str(app/'PlatinumQA'),'-archs'):b'x86_64',('codesign','--verify','--deep','--strict',str(app)):b'',('xcrun','simctl','list','runtimes','--json'):json.dumps({'runtimes':[{'identifier':runtime,'version':'18.5','isAvailable':True}]}).encode(),('xcrun','simctl','list','devices','--json'):json.dumps({'devices':{runtime:[{'udid':'selected','state':'Booted'}]}}).encode()}
 calls=[]
 def output(args,**kwargs):calls.append(args);return outputs[tuple(args)]
 with mock.patch.object(r.subprocess,'check_output',side_effect=output),mock.patch('platform.system',return_value='Darwin'):
  proof=r.validate_device('ios','selected',compat,binary=app,toolchain=toolchain)
  assert proof['codeSignatureVerified'] and not proof['guestUnameInvoked']
  assert not any('spawn' in args for args in calls)
  outputs[('xcrun','lipo',str(app/'PlatinumQA'),'-archs')]=b'arm64'
  try:r.validate_device('ios','selected',compat,binary=app,toolchain=toolchain)
  except ValueError:pass
  else:raise AssertionError('wrong actual Mach-O was accepted')
  try:r.validate_device('ios','selected',compat)
  except ValueError:pass
  else:raise AssertionError('missing actual binary/toolchain accepted')
print('normal actual-function integration passed')
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /normal actual-function integration passed/);
});
