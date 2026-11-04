const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

test('the setup correction changes only the single creation-origin budget from 300 to 600 seconds', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/quality/native-ui-ios-autofill.py'), 'utf8');
  const current = 'BUDGET_SECONDS = 600\n';
  assert.equal(source.split(current).length, 2);
  assert.equal(sha(source.replace(current, 'BUDGET_SECONDS = 300\n')),
    '122d13cf99c125c05cf8ad1bf71907886a9b3b706348cb41eee610b2b0df4435');
});

test('the only app-runner changes bracket the original exact-UUID boot before QA installation', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/quality/test-ios-app-ui.sh'), 'utf8');
  const before = 'python3 scripts/quality/native-ui-ios-autofill.py verify-created "$ui_simulator" --runtime "$runtime"\n';
  const after = 'python3 scripts/quality/native-ui-ios-autofill.py configure "$ui_simulator"\n';
  assert.equal(source.split(before).length, 2);
  assert.equal(source.split(after).length, 2);
  assert.ok(source.includes('ui_simulator="$(xcrun simctl create "Platinum full app UI ${GITHUB_RUN_ID}" "$ios_device_type" "$runtime")"\n' + before));
  assert.ok(source.includes(before + 'xcrun simctl boot "$ui_simulator"\nxcrun simctl bootstatus "$ui_simulator" -b\n' + after + 'xcrun simctl install "$ui_simulator" "$app"'));
  const restored = source.replace(before, '').replace(after, '');
  assert.equal(sha(restored), '4f52d8cd572d2c38362348902a418d4802f6347bc85905e138e297979bb2613a');
  assert.ok(!restored.includes(before) && !restored.includes(after), 'the original runner lacks the required preflight');
});

test('all actual login, Live, memory, flow aggregation and acceptance assertions remain byte-identical', () => {
  const expected = {
    'tests/native/flows/navigation.yaml': '75d690bac6c858eaf45c52821c98b283ac887ce27a1a2ff30ee429e860a10932',
    'tests/native/flows/memory-capture.yaml': 'a9369904a7e141ae6930981d3d5c5af1f611e7c371919bf6c35b0f788548932d',
    'tests/native/flows/live-immersive.yaml': '2dc6b5838d3ac00a5627ce73599c9bce6cb04fd7f776e637009371c2fadc081e',
    'scripts/quality/run-native-ui-flows.sh': '814e406898cdbeb9335ec2445aa723aa9b89f344c4d36e7863106609a65de65a',
    'scripts/quality/verify-native-ui.cjs': 'f39b2978aac934a6b99a666a3a1eed47e6d4049d6d6dfd777695f72a7757c0db',
  };
  for (const [file, digest] of Object.entries(expected)) assert.equal(sha(fs.readFileSync(path.join(root, file))), digest, file);
});

test('the two Settings flows use only the documented route and one enabled on-state toggle', () => {
  const read = file => YAML.parseAllDocuments(fs.readFileSync(path.join(root, file), 'utf8')).map(doc => {
    assert.deepEqual(doc.errors, []); return doc.toJS();
  });
  const [openConfig, open] = read('tests/native/flows/ios-autofill-open.yaml');
  const [disableConfig, disable] = read('tests/native/flows/ios-autofill-disable.yaml');
  assert.equal(openConfig.appId, 'com.apple.Preferences');
  assert.equal(disableConfig.appId, 'com.apple.Preferences');
  assert.deepEqual(open, [
    { launchApp: { clearState: false, clearKeychain: false, permissions: {} } },
    { scrollUntilVisible: { element: { text: '^General$' }, direction: 'DOWN', timeout: 20000, centerElement: false } },
    { tapOn: '^General$' },
    { scrollUntilVisible: { element: { text: '^AutoFill & Passwords$' }, direction: 'DOWN', timeout: 20000, centerElement: false } },
    { tapOn: '^AutoFill & Passwords$' },
    { assertVisible: '^AutoFill Passwords and Passkeys$' },
  ]);
  const on = { id: '^AutoFillToggle$', text: '^AutoFill Passwords and Passkeys$', checked: true, enabled: true };
  const target = { childOf: { id: '^AutoFillToggle$' }, id: '^$', checked: true, enabled: true };
  assert.deepEqual(disable, [{ assertVisible: on }, { tapOn: target },
    { assertVisible: { ...on, checked: false } }]);
});

// Exact nested control attributes from original 216 artifact 13366456861. The
// public Settings row exposes its label and actual switch as separate children.
const recordedAutofillRow = {
  attributes: { 'resource-id': 'AutoFillToggle', accessibilityText: 'AutoFill Passwords and Passkeys',
    text: '1', value: '1', bounds: '[16,151][386,203]' }, enabled: true, checked: true,
  children: [
    { attributes: { 'resource-id': '', accessibilityText: 'AutoFill Passwords and Passkeys',
      text: '', value: '', bounds: '[32,166][282,187]' }, enabled: true, checked: false, children: [] },
    { attributes: { 'resource-id': '', accessibilityText: '',
      text: '1', value: '1', bounds: '[309,163][372,191]' }, enabled: true, checked: true, children: [] },
  ],
};

// Replay only the selector subset used here, following immutable Maestro 2.11.0
// commit c8c361be1cc89b2e742f185466a302a22778be6b: Orchestra.kt 1447-1454
// scopes childOf, 1703-1706 chooses deepest matches, Filters.kt 58-130/260-295
// supplies text/id/state matching. This is a retained-hierarchy regression,
// not a substitute for the required installed-Simulator flow and value 0 readback.
function selectRecordedControl(rootNode, selector) {
  for (const key of Object.keys(selector)) assert.ok(['childOf', 'id', 'text', 'checked', 'enabled'].includes(key));
  const parent = selector.childOf ? selectRecordedControl(rootNode, selector.childOf)[0] : rootNode;
  if (!parent) return [];
  const matches = node => {
    const attrs = node.attributes;
    if (selector.id !== undefined) {
      const id = attrs['resource-id'];
      if (typeof id !== 'string' || !(new RegExp(selector.id).test(id)
        || new RegExp(selector.id).test(id.substring(id.lastIndexOf('/') + 1)))) return false;
    }
    if (selector.text !== undefined && !['text', 'hintText', 'accessibilityText'].some(key =>
      typeof attrs[key] === 'string' && new RegExp(selector.text).test(attrs[key]))) return false;
    return ['checked', 'enabled'].every(key => selector[key] === undefined || node[key] === selector[key]);
  };
  const deepest = node => {
    const children = node.children.flatMap(deepest);
    return children.length ? children : matches(node) ? [node] : [];
  };
  return deepest(parent);
}

function disableCommands() {
  const docs = YAML.parseAllDocuments(fs.readFileSync(path.join(root, 'tests/native/flows/ios-autofill-disable.yaml'), 'utf8'));
  for (const doc of docs) assert.deepEqual(doc.errors, []);
  return docs[1].toJS();
}

test('the recorded nested row resolves the actual enabled switch instead of its label or row center', () => {
  const old = { text: '^AutoFill Passwords and Passkeys$', checked: true, enabled: true };
  assert.deepEqual(selectRecordedControl(recordedAutofillRow, old), [recordedAutofillRow]);
  const target = disableCommands()[1].tapOn;
  const selected = selectRecordedControl(recordedAutofillRow, target);
  assert.equal(selected.length, 1);
  assert.strictEqual(selected[0], recordedAutofillRow.children[1]);
  assert.equal(selected[0].attributes.bounds, '[309,163][372,191]');
  assert.equal(selected[0].attributes.value, '1');
  assert.deepEqual(selectRecordedControl({ ...recordedAutofillRow, children: [recordedAutofillRow.children[0]] }, target), []);
  const disabled = structuredClone(recordedAutofillRow); disabled.children[1].enabled = false;
  assert.deepEqual(selectRecordedControl(disabled, target), []);
  const otherRow = structuredClone(recordedAutofillRow); otherRow.attributes['resource-id'] = 'AnotherToggle';
  assert.deepEqual(selectRecordedControl(otherRow, target), []);
});

test('the recorded static label cannot satisfy the corrected control-scoped off assertion', () => {
  const oldOff = { text: '^AutoFill Passwords and Passkeys$', checked: false, enabled: true };
  assert.deepEqual(selectRecordedControl(recordedAutofillRow, oldOff), [recordedAutofillRow.children[0]]);
  const commands = disableCommands();
  assert.deepEqual(selectRecordedControl(recordedAutofillRow, commands[0].assertVisible), [recordedAutofillRow]);
  assert.deepEqual(selectRecordedControl(recordedAutofillRow, commands[2].assertVisible), []);
  const off = structuredClone(recordedAutofillRow);
  for (const node of [off, off.children[1]]) {
    node.checked = false; node.attributes.value = '0'; node.attributes.text = '0';
  }
  assert.deepEqual(selectRecordedControl(off, commands[2].assertVisible), [off]);
  assert.deepEqual(selectRecordedControl(off, commands[1].tapOn), []);
});

test('actual preflight guards reject wrong identity, ambiguous controls, stale ownership and incomplete readback', () => {
  const code = String.raw`
import copy,importlib.util,json,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest import mock
spec=importlib.util.spec_from_file_location('autofill',Path('scripts/quality/native-ui-ios-autofill.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
UUID='11111111-1111-4111-8111-111111111111'
def node(value='',label=None,checked=None,enabled=True,children=None):
 if checked is None:checked=value=='1'
 return {'attributes':{'accessibilityText':m.SETTING if label is None else label,'value':value,
  'checked':str(checked).lower(),'enabled':str(enabled).lower(),'bounds':'[10,10][350,60]','resource-id':''},
  'checked':checked,'enabled':enabled,'children':children or []}
def tree(*controls):return node(label='AutoFill & Passwords',children=list(controls))
class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  for file in m.BOUND_FILES:
   target=self.root/file;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((Path.cwd()/file).read_bytes())
  (self.root/'native-ui-logs').mkdir()
  self.env={'CI':'true','EXPO_PUBLIC_APP_ENV':'qa','EXPO_PUBLIC_SUPABASE_URL':'https://uaulhuelcfkjwojtymmw.supabase.co',
   'EXPO_PUBLIC_SUPABASE_ANON_KEY':'native-ui-synthetic-no-provider-key','GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'12345',
   'GITHUB_RUN_ATTEMPT':'1','PLATINUM_NATIVE_IOS_TARGET':'arm64-ios26.2'}
  self.source={'commit':'a'*40,'workflowRun':'12345','hashes':{file:m.digest((self.root/file).read_bytes()) for file in m.BOUND_FILES}}
  (self.root/'native-ui-logs/source.json').write_text(json.dumps(self.source))
  self.ctx=m.context(self.root,self.env,'Darwin','arm64');self.now=110.0
  self.runtimes={'runtimes':[{'identifier':self.ctx['runtimeIdentifier'],'version':'26.2','isAvailable':True}]}
  self.row={'udid':UUID,'name':self.ctx['name'],'state':'Shutdown','deviceTypeIdentifier':self.ctx['deviceTypeIdentifier'],'isAvailable':True}
  self.devices={'devices':{self.ctx['runtimeIdentifier']:[self.row]}}
  verified=m.verify_identity(self.ctx,UUID,self.runtimes,self.devices,'Shutdown')
  self.owner={'context':self.ctx,'device':UUID,'verification':verified,'startedMonotonic':100.0,'budgetSeconds':600}
  self.dir=self.root/'native-ui-logs/ios-autofill-preflight';self.dir.mkdir()
  self.calls=[]
 def tearDown(self):self.temp.cleanup()
 def read(self,args,name,before=None,after=None):
  m.validate_ownership(self.ctx,UUID,self.owner,lambda:self.now).remaining()
  self.calls.append((args,name));self.now+=1
  if name=='booted-runtimes.json':return json.dumps(self.runtimes).encode()
  if name=='booted-devices.json':
   data=copy.deepcopy(self.devices);data['devices'][self.ctx['runtimeIdentifier']][0]['state']='Booted';return json.dumps(data).encode()
  if name=='maestro-version.txt':return b'2.11.0\n'
  if name=='before-hierarchy.json':return json.dumps(before if before is not None else tree(node('1'))).encode()
  if name=='after-hierarchy.json':return json.dumps(after if after is not None else tree(node('0'))).encode()
  return b''
 def configure(self,before=None,after=None):
  return m.configure(self.ctx,UUID,self.owner,self.dir,lambda args,name:self.read(args,name,before,after),lambda:self.now)
 def test_exact_settings_on_to_off_uses_one_toggle_and_same_uuid_for_every_device_command(self):
  result=self.configure();self.assertTrue(result['passed']);self.assertTrue(result['changed'])
  self.assertEqual(result['before']['nativeValue'],'1');self.assertEqual(result['after']['nativeValue'],'0')
  names=[name for _,name in self.calls]
  self.assertEqual(names,['booted-runtimes.json','booted-devices.json','maestro-version.txt','open-settings.log',
   'before-hierarchy.json','before-screenshot.log','disable-autofill.log','after-hierarchy.json','after-screenshot.log'])
  for args,name in self.calls:
   if args[:1]==['maestro'] and '--device' in args:self.assertEqual(args[args.index('--device')+1],UUID)
   if args[:3]==['xcrun','simctl','io']:self.assertEqual(args[3],UUID)
  disable=next(args for args,name in self.calls if name=='disable-autofill.log')
  self.assertIn('--no-reinstall-driver',disable);self.assertEqual(disable[-1],m.DISABLE_FLOW)
  self.assertNotIn('defaults',repr(self.calls));self.assertNotIn('privacy',repr(self.calls));self.assertNotIn('keychain',repr(self.calls))
 def test_already_off_requires_fresh_after_state_without_any_toggle(self):
  result=self.configure(tree(node('0')));self.assertTrue(result['passed']);self.assertFalse(result['changed'])
  self.assertNotIn('disable-autofill.log',[name for _,name in self.calls]);self.assertIn('after-hierarchy.json',[name for _,name in self.calls])
 def test_static_label_with_false_flag_never_proves_off(self):
  with self.assertRaisesRegex(m.PreflightError,'missing_or_ambiguous_switch'):self.configure(tree(node()))
  self.assertNotIn('disable-autofill.log',[name for _,name in self.calls])
  self.assertIn('before-screenshot.log',[name for _,name in self.calls])
 def test_static_label_plus_one_actual_control_is_unambiguous(self):
  self.assertEqual(m.switch_state(tree(node(),node('0')))['nativeValue'],'0')
 def test_duplicate_or_conflicting_value_controls_fail_before_toggle(self):
  for data in [tree(node('0'),node('1')),tree(node('1'),node('1')),tree(node('0'),node('0'))]:
   self.calls=[]
   with self.assertRaisesRegex(m.PreflightError,'ambiguous'):self.configure(data)
   self.assertNotIn('disable-autofill.log',[name for _,name in self.calls])
 def test_unknown_values_disabled_or_inconsistent_native_states_fail_before_toggle(self):
  invalid=[node('on'),node('2'),node('1',checked=False),node('0',checked=True),node('1',enabled=False),node('0',enabled=False)]
  for item in invalid:
   self.calls=[]
   with self.assertRaises(m.PreflightError):self.configure(tree(item))
   self.assertNotIn('disable-autofill.log',[name for _,name in self.calls])
 def test_off_readback_cannot_be_faked_by_a_successful_tap_or_on_state(self):
  for data in [tree(node('1')),tree(node()),tree(node('0'),node('1'))]:
   self.calls=[]
   with self.assertRaises(m.PreflightError):self.configure(after=data)
   self.assertEqual([name for _,name in self.calls].count('disable-autofill.log'),1)
   self.assertIn('after-screenshot.log',[name for _,name in self.calls])
 def test_exact_created_uuid_name_type_runtime_and_state_are_required(self):
  for key,value in [('name','Another job'),('deviceTypeIdentifier','wrong'),('state','Booted'),('isAvailable',False)]:
   data=copy.deepcopy(self.devices);data['devices'][self.ctx['runtimeIdentifier']][0][key]=value
   with self.subTest(key=key),self.assertRaises(m.PreflightError):m.verify_identity(self.ctx,UUID,self.runtimes,data,'Shutdown')
  for uuid in ['booted','all','',UUID+'\n',UUID+' '+UUID]:
   with self.assertRaises(m.PreflightError):m.verify_identity(self.ctx,uuid,self.runtimes,self.devices,'Shutdown')
  duplicate=copy.deepcopy(self.devices);duplicate['devices']['other']=[self.row]
  with self.assertRaisesRegex(m.PreflightError,'ambiguous'):m.verify_identity(self.ctx,UUID,self.runtimes,duplicate,'Shutdown')
 def test_wrong_unavailable_or_duplicate_runtime_is_rejected(self):
  for rows in [[],self.runtimes['runtimes']*2,[{**self.runtimes['runtimes'][0],'isAvailable':False}],
   [{**self.runtimes['runtimes'][0],'version':'26.5'}]]:
   with self.assertRaises(m.PreflightError):m.verify_identity(self.ctx,UUID,{'runtimes':rows},self.devices,'Shutdown')
 def test_changed_booted_identity_fails_before_settings_launch(self):
  def read(args,name):
   if name=='booted-devices.json':return json.dumps({'devices':{self.ctx['runtimeIdentifier']:[{**self.row,'state':'Booted','name':'different job'}]}}).encode()
   return self.read(args,name)
  with self.assertRaisesRegex(m.PreflightError,'device_identity_mismatch'):m.configure(self.ctx,UUID,self.owner,self.dir,read,lambda:self.now)
  self.assertNotIn('open-settings.log',[name for _,name in self.calls])
 def test_source_and_run_binding_rejects_old_attempt_other_target_or_modified_helper(self):
  for key,value in [('workflowRun','12346'),('workflowAttempt','2'),('sourceCommit','b'*40),('target','intel-ios18.5')]:
   changed={**self.ctx,key:value}
   with self.assertRaisesRegex(m.PreflightError,'stale_ownership'):m.validate_ownership(changed,UUID,self.owner,lambda:self.now)
  for key,value in [('name','old'),('runtimeVersion','26.5'),('state','Booted')]:
   bad=copy.deepcopy(self.owner);bad['verification'][key]=value
   with self.assertRaisesRegex(m.PreflightError,'stale_ownership'):m.validate_ownership(self.ctx,UUID,bad,lambda:self.now)
  (self.root/m.BOUND_FILES[0]).write_text('changed helper')
  with self.assertRaisesRegex(m.PreflightError,'preflight_source_mismatch'):m.context(self.root,self.env,'Darwin','arm64')
 def test_only_the_disposable_qa_host_and_exact_supported_target_are_accepted(self):
  for system,machine in [('Linux','arm64'),('Darwin','x86_64')]:
   with self.assertRaisesRegex(m.PreflightError,'unsupported_host'):m.context(self.root,self.env,system,machine)
  for key,value in [('CI','false'),('EXPO_PUBLIC_APP_ENV','production'),('EXPO_PUBLIC_SUPABASE_ANON_KEY','real-key'),
   ('EXPO_PUBLIC_SUPABASE_URL','https://wrong.invalid'),('GITHUB_RUN_ATTEMPT',''),('GITHUB_SHA','branch'),('PLATINUM_NATIVE_IOS_TARGET','unknown')]:
   with self.subTest(key=key),self.assertRaises(m.PreflightError):m.context(self.root,{**self.env,key:value},'Darwin','arm64')
 def test_pinned_maestro_version_is_checked_before_settings_action(self):
  def read(args,name):return b'2.12.0\n' if name=='maestro-version.txt' else self.read(args,name)
  with self.assertRaisesRegex(m.PreflightError,'maestro_version_mismatch'):m.configure(self.ctx,UUID,self.owner,self.dir,read,lambda:self.now)
  self.assertNotIn('open-settings.log',[name for _,name in self.calls])
 def test_original_clock_budget_cannot_reset_between_phases_or_allow_future_origin(self):
  self.now=699.5;deadline=m.validate_ownership(self.ctx,UUID,self.owner,lambda:self.now);self.assertEqual(deadline.remaining(),0.5)
  self.now=700
  with self.assertRaisesRegex(m.PreflightError,'setup_deadline'):m.validate_ownership(self.ctx,UUID,self.owner,lambda:self.now)
  self.now=99
  with self.assertRaisesRegex(m.PreflightError,'setup_deadline'):m.validate_ownership(self.ctx,UUID,self.owner,lambda:self.now)
  bad={**self.owner,'budgetSeconds':300}
  with self.assertRaisesRegex(m.PreflightError,'stale_ownership'):m.validate_ownership(self.ctx,UUID,bad,lambda:110)
 def test_observed_cold_setup_and_full_driver_allowance_consume_one_original_budget(self):
  self.assertEqual(m.BUDGET_SECONDS,600)
  self.now=316.0
  deadline=m.validate_ownership(self.ctx,UUID,self.owner,lambda:self.now)
  self.assertEqual(deadline.remaining(),384.0)
  waits=[]
  class Process:
   pid=2468
   def wait(inner,timeout):
    waits.append(timeout);self.now+=180.0;return 0
  runner=m.Commands(self.root,self.env,self.dir,deadline)
  with mock.patch.object(m.subprocess,'Popen',return_value=Process()) as launch,mock.patch.object(m.os,'killpg') as kill:
   self.assertEqual(runner(['maestro','--device',UUID,'test',m.OPEN_FLOW],'cold-start.log'),b'')
   self.assertEqual(launch.call_count,1);kill.assert_not_called()
  self.assertEqual(waits,[384.0]);self.assertEqual(deadline.started,100.0)
  self.assertEqual(deadline.remaining(),204.0)
  self.assertEqual(m.validate_ownership(self.ctx,UUID,self.owner,lambda:self.now).remaining(),204.0)
  result=self.configure();self.assertTrue(result['passed']);self.assertEqual(result['after']['nativeValue'],'0')
  self.assertLess(m.validate_ownership(self.ctx,UUID,self.owner,lambda:self.now).remaining(),204.0)
 def test_a_late_command_consumes_the_shared_deadline_before_any_toggle(self):
  def read(args,name):
   data=self.read(args,name)
   if name=='before-screenshot.log':self.now=700
   return data
  with self.assertRaisesRegex(m.PreflightError,'setup_deadline'):m.configure(self.ctx,UUID,self.owner,self.dir,read,lambda:self.now)
  self.assertNotIn('disable-autofill.log',[name for _,name in self.calls])
 def test_subprocess_timeout_kills_only_its_group_and_never_restarts_it(self):
  waits=[]
  class Process:
   pid=2468
   def wait(inner,timeout):
    waits.append(timeout)
    if len(waits)==1:raise subprocess.TimeoutExpired(['maestro'],timeout)
    return -9
  runner=m.Commands(self.root,self.env,self.dir,m.Deadline(100,lambda:699))
  with mock.patch.object(m.subprocess,'Popen',return_value=Process()) as launch,mock.patch.object(m.os,'killpg') as kill:
   with self.assertRaisesRegex(m.PreflightError,'setup_deadline'):runner(['maestro','--device',UUID,'hierarchy'],'timed-out.log')
   self.assertEqual(launch.call_count,1);self.assertTrue(launch.call_args.kwargs['start_new_session']);kill.assert_called_once_with(2468,m.signal.SIGKILL)
  self.assertEqual(waits,[1,5])
 def test_failure_receipt_is_bounded_and_does_not_disclose_raw_command_error(self):
  m.write_json(self.dir/'ownership.json',self.owner)
  with mock.patch.object(m,'ROOT',self.root),mock.patch.dict(os.environ,self.env,clear=True),\
   mock.patch.object(m.platform,'system',return_value='Darwin'),mock.patch.object(m.platform,'machine',return_value='arm64'),\
   mock.patch.object(m.time,'monotonic',return_value=110),mock.patch.object(m,'validate_ownership',return_value=m.Deadline(100,lambda:110)),\
   mock.patch.object(m,'configure',side_effect=RuntimeError('secret response must stay out')),\
   mock.patch.object(m.sys,'argv',['preflight','configure',UUID]):
   self.assertEqual(m.main(),1)
  result=json.loads((self.dir/'result.json').read_text());self.assertFalse(result['passed']);self.assertEqual(result['device'],UUID)
  self.assertEqual(result['errorCode'],'preflight_evidence_or_execution_failed');self.assertNotIn('secret',json.dumps(result))
 def test_repeat_configuration_is_rejected_before_settings_and_preserves_prior_result(self):
  m.write_json(self.dir/'ownership.json',self.owner);m.write_json(self.dir/'configure-attempt.json',{'attempts':1})
  original=b'{"passed":true,"original":true}\n';(self.dir/'result.json').write_bytes(original)
  with mock.patch.object(m,'ROOT',self.root),mock.patch.dict(os.environ,self.env,clear=True),\
   mock.patch.object(m.platform,'system',return_value='Darwin'),mock.patch.object(m.platform,'machine',return_value='arm64'),\
   mock.patch.object(m,'validate_ownership',return_value=m.Deadline(100,lambda:110)),\
   mock.patch.object(m,'configure') as configure,mock.patch.object(m.sys,'argv',['preflight','configure',UUID]):
   self.assertEqual(m.main(),1);configure.assert_not_called()
  self.assertEqual((self.dir/'result.json').read_bytes(),original)
  self.assertFalse(json.loads((self.dir/'rejected-repeat.json').read_text())['passed'])
unittest.main(argv=['native-ios-autofill'],verbosity=2)
`;
  execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
});
