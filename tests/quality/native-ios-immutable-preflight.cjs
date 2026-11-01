const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

test('actual immutable preflight entry records bounded source-bound probes before any device action', () => {
  const code = String.raw`
import importlib.util,json,os,plistlib,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest import mock
def load(name,file):
 s=importlib.util.spec_from_file_location(name,Path('scripts/quality')/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
p=load('preflight','native-ui-ios-immutable-preflight.py');r=load('runner','native-ui-audit-runner.py');h=load('bounded','native-ui-ios-audit-recovery.py')
class PreflightTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.app=self.root/'PlatinumQA.app';self.app.mkdir()
  (self.app/'PlatinumQA').write_bytes(b'controlled compiled-app identity fixture')
  (self.app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':r.PACKAGE,'CFBundleExecutable':'PlatinumQA','DTPlatformName':'iphonesimulator','DTSDKName':'iphonesimulator18.5','MinimumOSVersion':'15.1'}))
  self.toolchain={'xcode':'Xcode 16.4\nBuild version 16F6','sdkVersion':'18.5'}
  self.manifest={'applicationSourceCommit':'a'*40,'applicationSourceTree':'b'*40,'platform':'ios','packageId':r.PACKAGE,'kind':'disposable-native-audit','configuration':'Release','binarySha256':r.binary_digest(self.app),'auditManifestSha256':'c'*64,'sourceReceiptSha256':'d'*64,'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':'com.apple.CoreSimulator.SimRuntime.iOS-18-5','sdk':'iphonesimulator18.5','minimumOSVersion':'15.1'},'toolchain':self.toolchain}
  self.manifest_path=self.root/'manifest.json';self.manifest_path.write_text(json.dumps(self.manifest));self.output=self.root/'immutable.json'
  self.commands=[['/usr/bin/uname','-m'],['xcodebuild','-version'],['xcrun','--sdk','iphonesimulator','--show-sdk-version'],['xcrun','lipo',str(self.app/'PlatinumQA'),'-archs'],['codesign','--verify','--deep','--strict',str(self.app)]]
  self.values=['x86_64',self.toolchain['xcode'],'18.5','x86_64',''];self.calls=[];self.failure=None
 def tearDown(self):self.temp.cleanup()
 def command(self,command,stage,timeout,records,path):
  index=len(self.calls);self.assertEqual(command,self.commands[index]);self.assertEqual(stage,p.STAGES[index]);self.assertEqual(timeout,30)
  self.assertNotIn('simctl',command);self.calls.append(command)
  if self.failure==index:raise subprocess.TimeoutExpired(command,timeout)
  row={'stage':stage,'status':'completed','exitCode':0,'timeoutSeconds':timeout,'startedAtEpochMs':1000+index*100,'finishedAtEpochMs':1050+index*100,'elapsedSeconds':0.04,'stdoutTail':self.values[index],'stdoutTruncated':False}
  records.append(row);h.atomic_json(path,{'commands':records});return self.values[index]
 def execute(self):
  args=['preflight','--binary',str(self.app),'--manifest',str(self.manifest_path),'--expected-source','a'*40,'--expected-tree','b'*40,'--output',str(self.output)]
  with mock.patch.object(sys,'argv',args),mock.patch.object(p,'load_module',side_effect=lambda name,path:r if path.name=='native-ui-audit-runner.py' else h),mock.patch.object(h,'setup_read',side_effect=self.command),mock.patch('platform.system',return_value='Darwin'),mock.patch.dict(os.environ,{'CI':'true','EXPO_PUBLIC_APP_ENV':'qa'}):return p.main()
 def test_actual_entry_records_exact_real_verification_chain(self):
  self.assertEqual(self.execute(),0);self.assertEqual(self.calls,self.commands)
  proof,sha=p.read_receipt(self.output,self.manifest,p.digest(self.manifest_path),self.app)
  self.assertEqual(sha,p.digest(self.output));self.assertTrue(proof['immutableCompatibility']['codeSignatureVerified'])
  self.assertEqual(len(proof['commands']),5);self.assertEqual(proof['binarySha256'],r.binary_digest(self.app))
  before=len(self.calls)
  with self.assertRaises(ValueError):self.execute()
  self.assertEqual(len(self.calls),before)
 def test_sdk_timeout_retains_failure_and_cannot_create_valid_preflight(self):
  self.failure=2
  with self.assertRaises(subprocess.TimeoutExpired) as error:self.execute()
  self.assertEqual(error.exception.timeout,30);self.assertEqual(self.calls,self.commands[:3]);self.assertFalse(self.output.exists())
 def test_wrong_actual_sdk_or_architecture_is_rejected(self):
  for index in [2,3]:
   with self.subTest(index=index):
    self.calls=[];old=self.values[index];self.values[index]='18.6' if index==2 else 'arm64'
    with self.assertRaises(ValueError):self.execute()
    self.assertFalse(self.output.exists());self.values[index]=old
 def test_changed_app_is_rejected_before_any_host_probe(self):
  (self.app/'PlatinumQA').write_bytes(b'changed binary')
  with self.assertRaises(ValueError):self.execute()
  self.assertEqual(self.calls,[])
 def test_receipt_alias_and_changed_developer_selection_are_rejected(self):
  self.execute();alias=self.root/'alias.json';alias.symlink_to(self.output)
  with self.assertRaises(ValueError):p.read_receipt(alias,self.manifest,p.digest(self.manifest_path),self.app)
  with mock.patch.dict(os.environ,{'DEVELOPER_DIR':'/unrelated/Xcode'}),self.assertRaises(ValueError):p.read_receipt(self.output,self.manifest,p.digest(self.manifest_path),self.app)
unittest.main(argv=['immutable-preflight'],verbosity=2)
`;
  assert.equal(execFileSync('python3', ['-c', code], { encoding: 'utf8', timeout: 15000 }).trim(), '');
  const shell = fs.readFileSync('scripts/quality/run-native-ui-audit-device.sh', 'utf8');
  const preflight = shell.indexOf('python3 scripts/quality/native-ui-ios-immutable-preflight.py');
  const create = shell.indexOf('device="$(python3 scripts/quality/native-ui-start-ios-device.py');
  const cases = shell.indexOf('python3 scripts/quality/native-ui-audit-runner.py --platform');
  assert.ok(preflight >= 0 && preflight < create && create < cases);
  assert.match(shell, /--immutable-preflight native-ui-logs\/immutable-preflight\.json/);
});
