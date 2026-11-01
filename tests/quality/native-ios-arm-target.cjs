const assert = require('node:assert/strict');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

test('explicit native Simulator targets keep ABI, toolchain, ownership and preboot budgets strict', () => {
  const code = String.raw`
import copy,importlib.util,json,plistlib,subprocess,tempfile,unittest
from pathlib import Path
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,Path('scripts/quality')/file)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
c=load('compatibility','native-ui-ios-compatibility.py')
created=load('created','native-ui-ios-created-device.py')
starter=load('starter','native-ui-start-ios-device.py')
uuid='11111111-1111-4111-8111-111111111111'
class NativeTargetTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.app=Path(self.temp.name)/'PlatinumQA.app';self.app.mkdir()
  self.target=c.TARGETS['arm64-ios26.2']
  self.manifest={'applicationSourceCommit':'a'*40,'nativeCompatibility':{
   'targetId':'arm64-ios26.2','abi':'arm64','runtimeIdentifier':self.target['runtimeIdentifier'],
   'deviceTypeIdentifier':self.target['deviceTypeIdentifier'],'sdk':'iphonesimulator26.2','minimumOSVersion':'15.1'},
   'toolchain':{'xcode':self.target['xcode'],'sdkVersion':'26.2'}}
  self.info={'CFBundleIdentifier':c.PACKAGE,'CFBundleExecutable':'PlatinumQA','DTPlatformName':'iphonesimulator','DTSDKName':'iphonesimulator26.2','MinimumOSVersion':'15.1'}
  (self.app/'Info.plist').write_bytes(plistlib.dumps(self.info));(self.app/'PlatinumQA').write_bytes(b'controlled command-boundary fixture')
  self.commands=[['/usr/bin/uname','-m'],['xcodebuild','-version'],['xcrun','--sdk','iphonesimulator','--show-sdk-version'],['xcrun','lipo',str(self.app/'PlatinumQA'),'-archs'],['codesign','--verify','--deep','--strict',str(self.app)]]
  self.outputs=['arm64',self.target['xcode'],'26.2','arm64',''];self.calls=[]
 def tearDown(self):self.temp.cleanup()
 def read(self,command):
  self.assertNotIn('simctl',command);self.calls.append(command)
  return self.outputs[self.commands.index(command)]
 def test_native_arm_uses_all_actual_immutable_probes_and_preserves_intel(self):
  value=c.verify_immutable_compatibility(self.app,self.manifest,self.read,'Darwin')
  self.assertEqual(self.calls,self.commands);self.assertEqual(value['hostArchitecture'],'arm64')
  self.assertEqual(value['actualExecutableArchitecture'],'arm64');self.assertTrue(value['codeSignatureVerified'])
  legacy=copy.deepcopy(self.manifest);legacy['nativeCompatibility']={'abi':'x86_64','runtimeIdentifier':'com.apple.CoreSimulator.SimRuntime.iOS-18-5','sdk':'iphonesimulator18.5','minimumOSVersion':'15.1'}
  legacy['toolchain']={'xcode':'Xcode 16.4\nBuild version 16F6','sdkVersion':'18.5'}
  self.info['DTSDKName']='iphonesimulator18.5';(self.app/'Info.plist').write_bytes(plistlib.dumps(self.info))
  self.outputs=['x86_64',legacy['toolchain']['xcode'],'18.5','x86_64',''];self.calls=[]
  self.assertEqual(c.verify_immutable_compatibility(self.app,legacy,self.read,'Darwin')['hostArchitecture'],'x86_64')
  self.assertEqual(self.calls,self.commands)
 def test_old_or_ambiguous_binary_cannot_be_relabelled_as_arm(self):
  for field,value in [('abi','x86_64'),('runtimeIdentifier','com.apple.CoreSimulator.SimRuntime.iOS-18-5'),('runtimeIdentifier','com.apple.CoreSimulator.SimRuntime.iOS-26-5'),('targetId','intel-ios18.5'),('deviceTypeIdentifier','com.apple.CoreSimulator.SimDeviceType.iPhone-16')]:
   bad=copy.deepcopy(self.manifest);bad['nativeCompatibility'][field]=value
   with self.subTest(field=field,value=value),self.assertRaises(ValueError):c.expected_target(bad)
  for key in ['targetId','deviceTypeIdentifier']:
   bad=copy.deepcopy(self.manifest);del bad['nativeCompatibility'][key]
   with self.subTest(missing=key),self.assertRaises(ValueError):c.expected_target(bad)
  for index,value in [(0,'x86_64'),(1,'Xcode 16.4\nBuild version 16F6'),(2,'18.5'),(3,'x86_64'),(3,'arm64 x86_64')]:
   old=self.outputs[index];self.outputs[index]=value
   with self.subTest(command=index,value=value),self.assertRaises(ValueError):c.verify_immutable_compatibility(self.app,self.manifest,self.read,'Darwin')
   self.outputs[index]=old
  self.info['DTSDKName']='iphonesimulator18.5';(self.app/'Info.plist').write_bytes(plistlib.dumps(self.info))
  with self.assertRaises(ValueError):c.verify_immutable_compatibility(self.app,self.manifest,self.read,'Darwin')
 def prepare(self,fail=False):
  calls=[];runtime=self.target['runtimeIdentifier'];device_type=self.target['deviceTypeIdentifier']
  def read(args,timeout):
   calls.append((args,timeout))
   if args[:3]==['xcrun','simctl','create']:
    self.assertEqual(args[-2:],[device_type,runtime]);return uuid
   if args==['xcrun','simctl','list','runtimes','--json']:
    return json.dumps({'runtimes':[{'identifier':runtime,'version':'26.2','isAvailable':True}]})
   if args==['xcrun','simctl','list','devices','--json']:
    return json.dumps({'devices':{runtime:[{'udid':uuid,'state':'Shutdown','isAvailable':True,'deviceTypeIdentifier':device_type}]}})
   if fail and args[:3]==['xcrun','simctl','bootstatus']:raise subprocess.TimeoutExpired(args,timeout)
   self.assertIn(args,[['xcrun','simctl','boot',uuid],['xcrun','simctl','bootstatus',uuid,'-b'],['xcrun','simctl','shutdown',uuid],['xcrun','simctl','delete',uuid]])
   return ''
  if fail:
   with self.assertRaises(subprocess.TimeoutExpired):starter.prepare(self.manifest,read,read,created)
   return calls
  return starter.prepare(self.manifest,read,read,created),calls
 def test_arm_device_creation_keeps_exact_identity_order_and_original_budgets(self):
  prepared,calls=self.prepare()
  self.assertEqual([row[0][2] for row in calls],['create','list','list','boot','bootstatus'])
  self.assertEqual([row[1] for row in calls],[120,30,30,120,300])
  self.assertEqual(prepared['device'],uuid);self.assertTrue(prepared['created'])
  proof=c.verify_prepared_booted_runtime(self.manifest,uuid,prepared)
  self.assertFalse(proof['postbootMetadataRead']);self.assertTrue(proof['exactUuidBootstatusCompleted'])
  for key,value in [('device','22222222-2222-4222-8222-222222222222'),('created',False),('bootReady',False),('sourceCommit','b'*40),('runtimeIdentifier','com.apple.CoreSimulator.SimRuntime.iOS-18-5')]:
   with self.subTest(key=key),self.assertRaises(ValueError):c.verify_prepared_booted_runtime(self.manifest,uuid,{**prepared,key:value})
 def test_failed_arm_boot_cleans_only_owned_uuid_without_increasing_any_budget(self):
  calls=self.prepare(True)
  self.assertEqual([row[1] for row in calls],[120,30,30,120,300,20,20])
  self.assertEqual(calls[-2:],[(['xcrun','simctl','shutdown',uuid],20),(['xcrun','simctl','delete',uuid],20)])
unittest.main(argv=['native-arm-target'],verbosity=2)
`;
  assert.equal(execFileSync('python3', ['-c', code], { encoding: 'utf8', timeout: 15000 }).trim(), '');
});
