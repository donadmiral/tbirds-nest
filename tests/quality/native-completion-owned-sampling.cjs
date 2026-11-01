const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('failure sampling accepts only the exact owned app and driver without Simulator metadata clients', () => {
  const code = String.raw`
import copy,ctypes,importlib.util,json,os,plistlib,tempfile,unittest
from pathlib import Path
from unittest import mock
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load('owned_sampling','scripts/quality/completion-ios-owned-sampling.py')
h=load('sample_helper','scripts/quality/native-ui-ios-audit-recovery.py')
class Fn:
 def __init__(self,fn):self.fn=fn
 def __call__(self,*args):return self.fn(*args)
class Library:
 def __init__(self,rows):
  self.rows=rows;self.count=None;self.list_calls=0;self.info_calls={};self.reuse=None
  self.proc_listallpids=Fn(self.pids);self.proc_pidinfo=Fn(self.info);self.proc_pidpath=Fn(self.path)
 def pids(self,out,size):
  self.list_calls+=1
  for i,pid in enumerate(self.rows):out[i]=pid
  return len(self.rows) if self.count is None else self.count
 def info(self,pid,flavor,arg,out,size):
  assert flavor==3 and arg==0 and size==ctypes.sizeof(h.ProcBsdInfo)
  row=self.rows[pid];self.info_calls[pid]=self.info_calls.get(pid,0)+1
  value=ctypes.cast(out,ctypes.POINTER(h.ProcBsdInfo)).contents
  value.pid=pid;value.uid=row['uid'];value.startSeconds=2 if self.reuse==pid and self.info_calls[pid]>1 else 1;value.startMicroseconds=3
  return size
 def path(self,pid,out,size):
  raw=os.fsencode(self.rows[pid]['path'])+b'\0';ctypes.memmove(out,raw,len(raw));return len(raw)-1
class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  self.device='AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB';self.other='CCCCCCCC-1111-2222-3333-DDDDDDDDDDDD'
  self.runtime='com.apple.CoreSimulator.SimRuntime.iOS-18-5';self.kind='com.apple.CoreSimulator.SimDeviceType.iPhone-16'
  self.manifest={'applicationSourceCommit':m.SOURCE,'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':self.runtime}}
  self.prepared={'device':self.device,'created':True,'bootReady':True,'sourceCommit':m.SOURCE,'runtimeIdentifier':self.runtime,'deviceTypeIdentifier':self.kind,'verification':{'selectedDevice':self.device,'runtimeIdentifier':self.runtime,'runtimeVersion':'18.5','deviceTypeIdentifier':self.kind,'runtimeAvailabilityVerified':True,'stateAtVerification':'Shutdown'}}
  self.app=self.bundle(self.device,'PlatinumQA',h.PACKAGE,'00000000-1111-2222-3333-000000000001')
  self.driver=self.bundle(self.device,'maestro-driver-iosUITests-Runner',h.DRIVER_PACKAGE,'00000000-1111-2222-3333-000000000002')
  self.library=Library({11:{'uid':501,'path':str(self.app)},12:{'uid':501,'path':str(self.driver)}})
  self.uid=mock.patch.object(m.os,'getuid',return_value=501);self.uid.start()
 def tearDown(self):self.uid.stop();self.temp.cleanup()
 def bundle(self,device,name,package,container):
  folder=self.root/device/'data/Containers/Bundle/Application'/container/(name+'.app');folder.mkdir(parents=True)
  (folder/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':package,'CFBundleExecutable':name}))
  p=folder/name;p.write_bytes(b'controlled executable identity fixture');return p
 def found(self):return m.owned_processes(h,self.device,self.root,self.library)
 def capture(self,budget=None,prepared=None,manifest=None,target='capture'):
  return m.capture_failed_reader_threads(h,self.device,self.root/target,budget if budget is not None else {'used':False},manifest=manifest or self.manifest,prepared=prepared or self.prepared,devices_root=self.root,library=self.library)
 def test_exact_two_bundles_are_selected(self):
  found=self.found();self.assertEqual([x['pid'] for x in found['app']],[11]);self.assertEqual([x['pid'] for x in found['driver']],[12])
  with mock.patch.object(h,'sample_process',return_value={'complete':True}) as sample,mock.patch.object(h,'read_command',side_effect=AssertionError('No host client permitted')):
   result=self.capture();self.assertTrue(result['attempted']);self.assertFalse(result['changesVerdict']);self.assertEqual(sample.call_count,2)
   self.assertEqual([x.args[0]['pid'] for x in sample.call_args_list],[11,12]);self.assertTrue(all(x['complete'] for x in result['samples']))
 def test_foreign_uid_and_other_device_are_never_selected(self):
  foreign=self.bundle(self.other,'PlatinumQA',h.PACKAGE,'00000000-1111-2222-3333-000000000003')
  self.library.rows[13]={'uid':0,'path':str(self.app)};self.library.rows[14]={'uid':501,'path':str(foreign)}
  self.assertEqual([x['pid'] for x in self.found()['app']],[11])
 def test_wrong_package_or_executable_declaration_is_rejected(self):
  p=self.app.parent/'Info.plist';original=p.read_bytes()
  for changed in [{'CFBundleIdentifier':'unrelated.app','CFBundleExecutable':'PlatinumQA'},{'CFBundleIdentifier':h.PACKAGE,'CFBundleExecutable':'other'}]:
   with self.subTest(changed=changed):p.write_bytes(plistlib.dumps(changed));self.assertEqual(self.found()['app'],[])
  p.write_bytes(original)
 def test_executable_or_plist_symlink_is_rejected(self):
  original=self.app.read_bytes();outside=self.root/'outside';outside.write_bytes(original);self.app.unlink();self.app.symlink_to(outside)
  self.assertEqual(self.found()['app'],[]);self.app.unlink();self.app.write_bytes(original)
  p=self.app.parent/'Info.plist';outside.write_bytes(p.read_bytes());p.unlink();p.symlink_to(outside)
  self.assertEqual(self.found()['app'],[])
 def test_duplicate_app_processes_fail_closed_for_that_role(self):
  self.library.rows[13]={'uid':501,'path':str(self.app)}
  with mock.patch.object(h,'sample_process',return_value={'complete':True}) as sample:
   result=self.capture();self.assertEqual(sample.call_count,1);self.assertEqual(sample.call_args.args[0]['pid'],12)
   self.assertEqual(result['samples'][0],{'role':'app','complete':False,'issue':'ExpectedOneOwnedProcess','matches':2})
 def test_missing_or_truncated_inventory_is_rejected(self):
  for count in [0,-1,8192,8193]:
   with self.subTest(count=count):
    self.library.count=count
    with self.assertRaises(ValueError):self.found()
 def test_process_reuse_during_identity_read_is_rejected(self):
  self.library.reuse=11;self.assertEqual(self.found()['app'],[])
 def test_unowned_or_unready_source_receipt_never_reads_processes(self):
  changed=[]
  for key,value in [('created',False),('bootReady',False),('device',self.other),('sourceCommit','a'*40)]:
   proof=copy.deepcopy(self.prepared);proof[key]=value;changed.append(proof)
  with mock.patch.object(h,'sample_process',side_effect=AssertionError('No sample permitted')):
   for index,proof in enumerate(changed):
    result=self.capture(prepared=proof,target='invalid'+str(index));self.assertFalse(result['attempted']);self.assertEqual(result['issue'],'ValueError')
   result=self.capture(manifest={**self.manifest,'applicationSourceCommit':'a'*40});self.assertFalse(result['attempted'])
  self.assertEqual(self.library.list_calls,0)
 def test_sample_errors_and_repeated_budget_never_change_verdict(self):
  budget={'used':False}
  with mock.patch.object(h,'sample_process',side_effect=PermissionError('controlled sample denial')) as sample:
   first=self.capture(budget=budget);second=self.capture(budget=budget,target='again')
   self.assertEqual(sample.call_count,2);self.assertFalse(first['changesVerdict']);self.assertTrue(all(x['issue']=='PermissionError' for x in first['samples']))
   self.assertFalse(second['attempted']);self.assertEqual(second['issue'],'sample-pair-budget-already-used');self.assertFalse((self.root/'again').exists())
 def test_device_uuid_symlink_is_not_treated_as_owned(self):
  selected=self.root/self.device;real=self.root/'foreign-device';selected.rename(real);selected.symlink_to(real,target_is_directory=True)
  with self.assertRaises(ValueError):self.found()
suite=unittest.defaultTestLoader.loadTestsFromTestCase(Tests);result=unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():raise SystemExit(1)
print(json.dumps({'tests':result.testsRun,'passed':True}))
`;
  const result = JSON.parse(execFileSync('python3', ['-c', code], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 15000, stdio: 'pipe',
  }));
  assert.deepEqual(result, { tests: 10, passed: true });
});
