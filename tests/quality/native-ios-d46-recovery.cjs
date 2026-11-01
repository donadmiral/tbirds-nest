const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const consumer = path.join(root, 'scripts/quality/native-ui-ios-d46-recovery.py');

test('direct diagnostic has an isolated 600s CLI budget, exact original controls and fail-closed outcomes', () => {
  const script = String.raw`
import ast,importlib.util,json,pathlib,subprocess,tempfile,types,unittest
p=pathlib.Path(__import__('sys').argv[1]);spec=importlib.util.spec_from_file_location('consumer',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
helper=m.load_helpers(p.parent);runner=m.load_module('runner',p.with_name('native-ui-audit-runner.py'));repo=p.parents[2]
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.tools=self.root/'consumer';self.tools.mkdir();self.output=self.root/'out';self.output.mkdir();self.baseline=self.root/'baseline';self.baseline.mkdir();f=self.tools/m.DIRECT_FLOW;f.parent.mkdir(parents=True);f.write_bytes((repo/m.DIRECT_FLOW).read_bytes());self.scenarios=json.loads((repo/'tests/native/audit/manifest.json').read_text());self.case=next(c for c in self.scenarios['cases'] if c['id']=='memory-reader-controls');self.calls=[]
 def tearDown(self):self.tmp.cleanup()
 def invoke(self,code=0,xml_change=None,receipt_change=None,error=None):
  def execute(args,timeout,**kwargs):
   self.calls.append({'args':args,'timeout':timeout,'cwd':kwargs['cwd']})
   if error:raise error
   xml='<testsuites><testsuite tests="1" failures="0"><testcase name="'+m.DIRECT_NAME+'" file="'+m.DIRECT_FLOW+'" status="SUCCESS"/></testsuite></testsuites>'
   (self.output/'diagnostic-direct-reader-controls'/'junit.xml').write_text(xml_change(xml) if xml_change else xml)
   return types.SimpleNamespace(returncode=code)
  def collect(platform,device,target):
   value={'mode':'synthetic-native-ui','networkForwarded':False,'requests':[{'path':'/auth/v1/token'}],'unhandled':[],'audit':{'caseId':self.case['id'],'scenario':self.case['fixtureScenario'],'rejected':[],'diagnostics':[],'diagnosticsDropped':0}}
   if receipt_change:receipt_change(value)
   (target/'native-ui-receipt.json').write_text(json.dumps(value));return [{'collected':True}]
  return m.run_direct_reader_diagnostic(helper,types.SimpleNamespace(collect=collect,validate_receipt=runner.validate_receipt),execute,self.baseline,self.tools,self.output,'device',self.scenarios)
 def test_mode_selects_zero_original_cases(self):
  before=json.dumps(self.scenarios);self.assertEqual(m.select_execution_cases(self.scenarios,{'memory'},direct=True),[]);self.assertEqual(len(self.scenarios['cases']),85);self.assertEqual(json.dumps(self.scenarios),before)
 def test_actual_summary_keeps_diagnostic_outcomes_out_of_original_counts(self):
  main=next(n for n in ast.parse(p.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='main')
  statement=next(n for n in ast.walk(main) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='summary' for t in n.targets))
  code=compile(ast.Module(body=[statement],type_ignores=[]),str(p),'exec')
  for passed in [False,True]:
   ns={**m.__dict__,'groups':{'memory'},'scenarios':self.scenarios,'selected_case_ids':[],'unselected_case_ids':[c['id'] for c in self.scenarios['cases']],'results':[],'diagnostic':{'passed':passed},'args':types.SimpleNamespace(direct_reader_diagnostic_only=True,warm_reader_diagnostic=False)}
   exec(code,ns);r=ns['summary'];self.assertEqual((r['attempted'],r['passed'],r['failed']),(0,0,0));self.assertEqual(len(r['unselectedCaseIds']),85);self.assertFalse(r['warmDiagnosticAttempted']);self.assertEqual((r['diagnosticAttempted'],r['diagnosticPassed'],r['diagnosticFailed']),(1,int(passed),int(not passed)))
 def test_mode_rejects_original_or_warm_or_other_groups(self):
  for groups,cases,warm in [({'memory'},'memory-reader-controls',False),({'memory'},None,True),({'memory','feed'},None,False),({'feed'},None,False),(set(),None,False)]:
   with self.subTest(groups=groups,cases=cases,warm=warm),self.assertRaises(ValueError):m.select_execution_cases(self.scenarios,groups,cases,warm,True)
 def test_exact_command_watchdog_and_identity(self):
  r=self.invoke();self.assertTrue(r['passed']);self.assertFalse(r['countedInBaseline85']);self.assertEqual(r['fixtureCaseId'],'memory-reader-controls');self.assertEqual(r['readerRequirementMs'],15000);self.assertEqual(r['timeoutSeconds'],600);self.assertFalse(r['centerElement']);self.assertEqual(r['flowSha256'],m.DIRECT_SHA)
  call=self.calls[0];self.assertEqual(call['timeout'],600);self.assertEqual(call['cwd'],self.tools);self.assertEqual(call['args'][-3:],['-e','D46_BASELINE='+str(self.baseline),m.DIRECT_FLOW]);self.assertEqual(r['junit'],{'passed':True,'executedDiagnostics':1})
 def test_warm_junit_identity_rejected(self):self.assertFalse(self.invoke(xml_change=lambda x:x.replace(m.DIRECT_NAME,'Diagnostic warm tabs then saved memory reader').replace(m.DIRECT_FLOW,m.DIAGNOSTIC_FLOW))['passed'])
 def test_wrong_file_rejected(self):self.assertFalse(self.invoke(xml_change=lambda x:x.replace(m.DIRECT_FLOW,'/wrong/'+m.DIRECT_FLOW))['passed'])
 def test_failed_junit_rejected(self):self.assertFalse(self.invoke(xml_change=lambda x:x.replace('SUCCESS','ERROR'))['passed'])
 def test_fixture_error_rejected(self):self.assertFalse(self.invoke(receipt_change=lambda x:x['audit']['diagnostics'].append({'message':'controlled'}))['passed'])
 def test_wrong_fixture_case_rejected(self):self.assertFalse(self.invoke(receipt_change=lambda x:x['audit'].update(caseId='navigation-warm-tabs'))['passed'])
 def test_nonzero_cli_rejected(self):self.assertFalse(self.invoke(code=1)['passed'])
 def test_timeout_is_failure_and_receipt_still_collected(self):
  r=self.invoke(error=subprocess.TimeoutExpired(['maestro'],600));self.assertFalse(r['passed']);self.assertTrue(r['timedOut']);self.assertTrue(r['fixture']['passed']);self.assertFalse(r['junit']['passed'])
 def test_changed_flow_fails_before_execution(self):
  (self.tools/m.DIRECT_FLOW).write_text('changed')
  with self.assertRaises(ValueError):self.invoke()
  self.assertEqual(self.calls,[])
 def test_cancellation_propagates(self):
  with self.assertRaises(SystemExit) as caught:self.invoke(error=SystemExit(130))
  self.assertEqual(caught.exception.code,130)
unittest.main(argv=['direct-diagnostic'],verbosity=2)
`;
  const result = spawnSync('python3', ['-c', script, consumer], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 13 tests/);
  const parse = relative => YAML.parseAllDocuments(fs.readFileSync(path.join(root, relative), 'utf8')).map(doc => doc.toJSON());
  const [originalConfig, original] = parse('tests/native/audit/flows/memory-reader-controls.yaml');
  const [config, diagnostic] = parse('tests/native/diagnostics/ios-direct-reader-controls.yaml');
  assert.equal(config.appId, originalConfig.appId);
  assert.equal(config.name, 'Diagnostic direct saved memory reader controls');
  const expected = structuredClone(original);
  expected[0].runFlow = '${D46_BASELINE}/tests/native/audit/flows/_signin.yaml';
  expected.find(command => command.scrollUntilVisible).scrollUntilVisible.centerElement = false;
  expected.at(-1).takeScreenshot = 'diagnostic-direct-reader-controls';
  assert.deepEqual(diagnostic, expected, 'all fixture, readiness, page, caption and Next commands stay exact');
  assert.deepEqual(diagnostic.find(command => command.extendedWaitUntil), { extendedWaitUntil: { visible: 'Edit memory book', timeout: 15000 } });
});

test('d46 recovery fails closed on pending producer identities and preserves the reviewed setup ordering', () => {
  const script = String.raw`
import ast, copy, hashlib, importlib.util, json, pathlib, subprocess, tempfile, types, unittest
p=pathlib.Path(__import__('sys').argv[1]);spec=importlib.util.spec_from_file_location('consumer',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
created_path=p.with_name('native-ui-ios-created-device.py');spec=importlib.util.spec_from_file_location('created_device',created_path);created=importlib.util.module_from_spec(spec);spec.loader.exec_module(created)
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def binding(self):
  value=json.loads(p.with_suffix('.json').read_text());value.update(ready=True,producerArtifactId=123,producerArtifactZipBytes=1234)
  for key in ['producerArtifactZipSha256','appArchiveSha256','binaryManifestSha256','binarySha256','sourceReceiptSha256']:value[key]='a'*64
  return value
 def test_pending_binding_cannot_provide_an_artifact(self):
  value=self.binding();value['ready']=False
  with self.assertRaises(ValueError):m.validate_binding(value)
  self.assertEqual(m.validate_binding(self.binding())['producerArtifactId'],123)
 def test_other_source_missing_hash_wrong_types_and_unknown_fields_rejected(self):
  for key,value in [('applicationSourceCommit','0'*40),('applicationSourceTree','0'*40),('producerRunId',1),('producerArtifactName','another'),('producerArtifactId',True),('producerArtifactZipBytes',0),('ready',1),('appArchiveSha256',None),('sourceReceiptSha256','A'*64),('binarySha256','g'*64)]:
   with self.subTest(key=key):
    wrong=self.binding();wrong[key]=value
    with self.assertRaises(ValueError):m.validate_binding(wrong)
  wrong=self.binding();wrong['extra']='unreviewed'
  with self.assertRaises(ValueError):m.validate_binding(wrong)
 def test_download_files_and_embedded_source_are_checked(self):
  binding=self.binding();manifest={'applicationSourceCommit':m.SOURCE,'applicationSourceTree':m.TREE,'platform':'ios','binarySha256':binding['binarySha256'],'sourceReceiptSha256':hashlib.sha256(b'{}').hexdigest(),'auditManifestSha256':m.MANIFEST_SHA}
  for name,data in [('source.json',b'{}'),('qa.app.tar.gz',b'controlled archive bytes'),('binary-manifest.json',json.dumps(manifest).encode())]:(self.root/name).write_bytes(data)
  for name,key in [('source.json','sourceReceiptSha256'),('qa.app.tar.gz','appArchiveSha256'),('binary-manifest.json','binaryManifestSha256')]:binding[key]=m.digest(self.root/name)
  self.assertEqual(m.verify_download(self.root,binding)['applicationSourceCommit'],m.SOURCE)
  (self.root/'qa.app.tar.gz').write_bytes(b'changed')
  with self.assertRaises(ValueError):m.verify_download(self.root,binding)
  binding['appArchiveSha256']=m.digest(self.root/'qa.app.tar.gz');manifest['applicationSourceCommit']='0'*40;(self.root/'binary-manifest.json').write_text(json.dumps(manifest));binding['binaryManifestSha256']=m.digest(self.root/'binary-manifest.json')
  with self.assertRaises(ValueError):m.verify_download(self.root,binding)
 def test_reviewed_helpers_are_hash_guarded_before_import(self):
  self.assertIn('native-ui-ios-created-device.py',m.HELPERS)
  for name in m.HELPERS:(self.root/name).write_bytes((p.parent/name).read_bytes())
  helper=m.load_helpers(self.root);self.assertTrue(callable(helper.verify_setup_immutable));self.assertTrue(callable(helper.verify_setup_booted_runtime))
  for name in ['native-ui-ios-compatibility.py','native-ui-ios-created-device.py']:
   original=(self.root/name).read_bytes();(self.root/name).write_text('raise RuntimeError("must not execute")')
   with self.assertRaisesRegex(ValueError,'dependency changed'):m.load_helpers(self.root)
   (self.root/name).write_bytes(original)
 def inventory(self):
  runtime=created.RUNTIME;device='01234567-89AB-CDEF-0123-456789ABCDEF'
  return {'runtimes':[{'identifier':runtime,'version':'18.5','isAvailable':True}]},{'devices':{runtime:[{'udid':device,'deviceTypeIdentifier':created.DEVICE_TYPE,'isAvailable':True,'state':'Shutdown'}]}}
 def setup_statements(self,phase_error=None,changed=False,inventory=None,returned_device=None,phase_timeout=True):
  main=next(n for n in ast.parse(p.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='main')
  setup=next(n for n in main.body if isinstance(n,ast.Try) and any(isinstance(child,ast.Attribute) and child.attr=='verify_setup_immutable' for child in ast.walk(n)))
  stop=next(i for i,n in enumerate(setup.body) if isinstance(n,ast.With));code=compile(ast.Module(body=setup.body[:stop],type_ignores=[]),str(p),'exec')
  events=[];commands=[];booted=[False];runtime_rows,device_rows=inventory or self.inventory();device='01234567-89AB-CDEF-0123-456789ABCDEF'
  def phase(name):
   def fn(*args,**kwargs):
    events.append(name)
    if phase_error==name:raise ValueError('controlled phase rejection')
    return {'passed':True}
   return fn
  def read(args):
   commands.append(args);events.append(args[3])
   if booted[0]:raise subprocess.TimeoutExpired(args,30)
   if phase_error=='metadata':raise ValueError('controlled unavailable metadata')
   if args==['xcrun','simctl','list','runtimes','--json']:return json.dumps(runtime_rows)
   if args==['xcrun','simctl','list','devices','--json']:return json.dumps(device_rows)
   raise AssertionError('Unexpected command')
  def setup_read(args,stage,budget,*unused):
   events.append((stage,budget));commands.append(args)
   if phase_error==stage:
    if phase_timeout:raise subprocess.TimeoutExpired(args,budget)
    raise ValueError('controlled nonzero setup exit')
   if stage=='boot':booted[0]=True
   return (returned_device if returned_device is not None else device) if stage=='create' else ''
  old_helper=m.load_module('old_compatibility',p.with_name('native-ui-ios-compatibility.py'))
  helper=types.SimpleNamespace(verify_setup_immutable=phase('immutable'),verify_setup_booted_runtime=lambda app,manifest,selected,*args:old_helper.verify_booted_runtime(manifest,selected,read),setup_compatibility_reader=lambda *args:read,atomic_json=lambda *a:None,setup_read=setup_read,read_command=lambda args,timeout:events.append(('install',timeout)) or commands.append(args))
  ns={**m.__dict__,'helper':helper,'created_verifier':created,'app':self.root/'app','manifest':{'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':created.RUNTIME}},'binding':self.binding(),'setup_records':[],'output':self.root,'provenance':{},'runner':types.SimpleNamespace(binary_digest=lambda app:'b'*64 if changed else 'a'*64)}
  try:exec(code,ns)
  except (ValueError,subprocess.TimeoutExpired):return events,commands,False,ns
  return events,commands,True,ns
 def test_actual_setup_avoids_postboot_whole_host_query_without_changing_budget_or_identity(self):
  events,commands,passed,ns=self.setup_statements();self.assertTrue(passed,'Controlled postboot metadata timeout must not block already verified identity')
  self.assertEqual(events,['immutable',('create',120),'runtimes','devices',('boot',120),('bootstatus',300),('install',120)])
  create=next(args for args in commands if args[:3]==['xcrun','simctl','create']);self.assertEqual(create[-2:],[created.DEVICE_TYPE,created.RUNTIME])
  for action in ['boot','bootstatus','install']:
   command=next(args for args in commands if args[:3]==['xcrun','simctl',action]);self.assertEqual(command[3],'01234567-89AB-CDEF-0123-456789ABCDEF')
  self.assertEqual(next(args for args in commands if args[:3]==['xcrun','simctl','bootstatus'])[-1],'-b')
  self.assertEqual(ns['provenance']['createdDeviceVerification']['stateAtVerification'],'Shutdown');self.assertTrue(ns['provenance']['bootedRuntimeVerification']['bootstatusCompleted'])
 def test_rejected_proof_or_changed_app_prevents_install(self):
  for phase in ['immutable','metadata']:
   events,commands,passed,ns=self.setup_statements(phase_error=phase);self.assertFalse(passed);self.assertNotIn(('install',120),events)
  events,commands,passed,ns=self.setup_statements(changed=True);self.assertFalse(passed);self.assertNotIn(('install',120),events)
 def test_actual_boot_or_readiness_failure_never_installs(self):
  for phase in ['boot','bootstatus']:
   for timeout in [False,True]:
    events,commands,passed,ns=self.setup_statements(phase_error=phase,phase_timeout=timeout);self.assertFalse(passed);self.assertNotIn(('install',120),events);self.assertNotIn('bootedRuntimeVerification',ns['provenance'])
    self.assertIn((phase,120 if phase=='boot' else 300),events)
 def test_malformed_created_uuid_is_rejected_before_any_boot(self):
  for value in ['',1,True,'booted','selected','01234567-89AB-CDEF-0123-456789ABCDEF\nother','01234567-89AB-CDEF-0123-456789ABCDEG']:
   events,commands,passed,ns=self.setup_statements(returned_device=value);self.assertFalse(passed);self.assertNotIn(('boot',120),events);self.assertNotIn(('install',120),events)
 def test_missing_ambiguous_unavailable_or_wrong_version_runtime_is_rejected_before_boot(self):
  for mutate in [lambda r:r.clear(),lambda r:r.append(copy.deepcopy(r[0])),lambda r:r[0].update(isAvailable=False),lambda r:r[0].update(isAvailable='true'),lambda r:r[0].update(version='18.4'),lambda r:r[0].update(identifier='other')]:
   runtimes,devices=self.inventory();mutate(runtimes['runtimes']);events,commands,passed,ns=self.setup_statements(inventory=(runtimes,devices));self.assertFalse(passed);self.assertNotIn(('boot',120),events)
 def test_wrong_missing_or_duplicate_device_identity_is_rejected_before_boot(self):
  for key,value in [('udid','11111111-1111-1111-1111-111111111111'),('deviceTypeIdentifier','com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro'),('deviceTypeIdentifier',None),('state','Booted'),('state','Creating'),('isAvailable',False),('isAvailable','true')]:
   runtimes,devices=self.inventory();devices['devices'][created.RUNTIME][0][key]=value;events,commands,passed,ns=self.setup_statements(inventory=(runtimes,devices));self.assertFalse(passed);self.assertNotIn(('boot',120),events)
  for variant in ['missing','duplicate','wrong-runtime','duplicate-other-runtime']:
   runtimes,devices=self.inventory();rows=devices['devices'][created.RUNTIME]
   if variant=='missing':rows.clear()
   elif variant=='duplicate':rows.append(copy.deepcopy(rows[0]))
   elif variant=='wrong-runtime':devices['devices']['other']=devices['devices'].pop(created.RUNTIME)
   else:devices['devices']['other']=copy.deepcopy(rows)
   events,commands,passed,ns=self.setup_statements(inventory=(runtimes,devices));self.assertFalse(passed);self.assertNotIn(('boot',120),events)
 def test_actual_created_device_parser_rejects_wrong_manifest_and_malformed_inventories(self):
  manifest={'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':created.RUNTIME}};device='01234567-89AB-CDEF-0123-456789ABCDEF';runtimes,devices=self.inventory()
  for value in [{'nativeCompatibility':{'abi':'arm64','runtimeIdentifier':created.RUNTIME}},{'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':'other'}}]:
   with self.assertRaises(ValueError):created.verify_created_device(value,device,lambda args:self.fail('No metadata may be queried for a wrong expected identity'))
  for first,second in [('not-json',json.dumps(devices)),('{}',json.dumps(devices)),(json.dumps(runtimes),'{}'),(json.dumps(runtimes),json.dumps({'devices':{created.RUNTIME:{}}}))]:
   values=iter([first,second])
   with self.assertRaises(ValueError):created.verify_created_device(manifest,device,lambda args:next(values))
unittest.main(argv=['review'],verbosity=2)
`;
  const result = spawnSync('python3', ['-c', script, consumer], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 11 tests/);
});

test('prepared d46 workflow selects only the separately counted direct reader diagnostic without rebuilding', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/native-audit-ios-d46-recovery.yml'), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['codex/native-audit-ios-d46-recovery-20261031']);
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  const job = workflow.jobs['recover-ios'];
  assert.equal(job['runs-on'], 'macos-15-intel'); assert.equal(job['timeout-minutes'], 25);
  assert.equal(job.strategy['fail-fast'], false);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests/native/audit/manifest.json')));
  assert.deepEqual(job.strategy.matrix.include, [{ shard: 'memory', groups: 'memory' }]);
  assert.equal(manifest.cases.length, 85, 'other original scenarios remain declared, not reported as executed');
  assert.equal(job.steps.find(step => step.with?.path === 'baseline').with.ref, 'd46c50f09164c75c7fe8cdba0c3470c272b1ab4e');
  const download = job.steps.find(step => step.with?.['run-id']);
  assert.equal(download.with['run-id'], 41235679679);
  assert.equal(download.with['artifact-ids'], '${{ steps.binding.outputs.artifact_id }}');
  assert.equal(download.with['merge-multiple'], true, 'pinned download action otherwise nests downloads selected by ID');
  assert.equal(download.with.path, 'baseline/native-audit-binary');
  assert.equal(job.steps.at(-1).if, 'always()');
  const commands = job.steps.map(step => step.run || '').join('\n');
  assert.match(commands, /--artifact-id/); assert.match(commands, /--recovery-source/);
  assert.match(commands, /--direct-reader-diagnostic-only/);
  assert.doesNotMatch(commands, /--cases|--warm-reader-diagnostic/);
  assert.equal(job.steps.some(step => step.env?.AUDIT_CASES), false);
  assert.doesNotMatch(commands, /npm ci|expo prebuild|xcodebuild .*build|codesign .*--sign|pod .*install/);
});

test('actual d46 case selector preserves order and rejects invalid or out-of-group subsets without changing the manifest', () => {
  const script = String.raw`
import copy, importlib.util, pathlib, unittest
p=pathlib.Path(__import__('sys').argv[1]);spec=importlib.util.spec_from_file_location('consumer',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def setUp(self):
  self.value={'groups':['memory','other'],'cases':[{'id':'memory-memoryalbum','group':'memory','flow':'original-a.yaml'},{'id':'other-case','group':'other','flow':'other.yaml'},{'id':'memory-reader-controls','group':'memory','flow':'original-b.yaml'},{'id':'memory-unselected','group':'memory','flow':'original-c.yaml'}]}
 def test_exact_subset_keeps_original_objects_order_and_input(self):
  before=copy.deepcopy(self.value);result=m.select_cases(self.value,{'memory'},'memory-reader-controls,memory-memoryalbum')
  self.assertEqual([x['id'] for x in result],['memory-memoryalbum','memory-reader-controls']);self.assertIs(result[0],self.value['cases'][0]);self.assertIs(result[1],self.value['cases'][2]);self.assertEqual(self.value,before)
 def test_omitted_subset_preserves_all_selected_group_cases(self):
  self.assertEqual([x['id'] for x in m.select_cases(self.value,{'memory'})],['memory-memoryalbum','memory-reader-controls','memory-unselected'])
 def test_duplicates_rejected(self):
  with self.assertRaises(ValueError):m.select_cases(self.value,{'memory'},'memory-memoryalbum,memory-memoryalbum')
 def test_unknown_and_out_of_group_rejected(self):
  for value in ['unknown','other-case','memory-memoryalbum,other-case']:
   with self.subTest(value=value),self.assertRaises(ValueError):m.select_cases(self.value,{'memory'},value)
 def test_empty_malformed_and_nonstring_rejected(self):
  for value in ['',',','memory-memoryalbum,',',memory-memoryalbum','memory-memoryalbum,,memory-reader-controls',' memory-memoryalbum','memory-memoryalbum\n',False,[],1]:
   with self.subTest(value=value),self.assertRaises(ValueError):m.select_cases(self.value,{'memory'},value)
 def test_unknown_and_empty_groups_rejected(self):
  for groups in [set(),{'unknown'},{'memory','unknown'}]:
   with self.subTest(groups=groups),self.assertRaises(ValueError):m.select_cases(self.value,groups,'memory-memoryalbum')
unittest.main(argv=['selection'],verbosity=2)
`;
  const result = spawnSync('python3', ['-c', script, consumer], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 6 tests/);
});

test('actual warm diagnostic preserves its original flow and requires real fixture/JUnit success separately from the original case', () => {
  const script = String.raw`
import ast, importlib.util, json, pathlib, shutil, subprocess, tempfile, types, unittest
p=pathlib.Path(__import__('sys').argv[1]);spec=importlib.util.spec_from_file_location('consumer',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
helper=m.load_helpers(p.parent);runner=m.load_module('runner',p.with_name('native-ui-audit-runner.py'));repo=p.parents[2]
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.output=self.root/'output';self.output.mkdir();flow=self.root/m.DIAGNOSTIC_FLOW;flow.parent.mkdir(parents=True);shutil.copyfile(repo/m.DIAGNOSTIC_FLOW,flow)
  self.scenarios=json.loads((repo/'tests/native/audit/manifest.json').read_text());self.case=next(c for c in self.scenarios['cases'] if c['id']=='navigation-warm-tabs');self.calls=[]
 def tearDown(self):self.tmp.cleanup()
 def invoke(self,code=0,bad_fixture=False,bad_xml=False,error=None):
  def execute(args,timeout,**unused):
   self.calls.append(('execute',args,timeout))
   if error:raise error
   target=self.output/'diagnostic-warm-tabs-reader'
   xml='<testsuites><testsuite tests="1" failures="0"><testcase name="Diagnostic warm tabs then saved memory reader" file="tests/native/diagnostics/ios-warm-tabs-reader.yaml" status="SUCCESS"/></testsuite></testsuites>'
   (target/'junit.xml').write_text(xml.replace('SUCCESS','ERROR') if bad_xml else xml)
   return types.SimpleNamespace(returncode=code)
  def collect(platform,device,target):
   self.calls.append(('collect',platform,device))
   receipt={'mode':'synthetic-native-ui','networkForwarded':False,'requests':[{'path':'/auth/v1/token'}],'unhandled':[],'audit':{'caseId':self.case['id'],'scenario':self.case['fixtureScenario'],'rejected':[],'diagnostics':[{'error':'controlled'}] if bad_fixture else [],'diagnosticsDropped':0}}
   (target/'native-ui-receipt.json').write_text(json.dumps(receipt));return [{'collected':True}]
  fake=types.SimpleNamespace(collect=collect,validate_receipt=runner.validate_receipt)
  return m.run_warm_reader_diagnostic(helper,fake,execute,self.root,self.output,'owned-device',self.scenarios)
 def test_valid_actual_validators_and_exact_diagnostic_identity(self):
  result=self.invoke();self.assertTrue(result['passed']);self.assertFalse(result['countedInBaseline85']);self.assertEqual(result['attempts'],1);self.assertEqual(result['readerRequirementMs'],15000);self.assertEqual(result['timeoutSeconds'],600);self.assertEqual(self.calls[0][1][-1],m.DIAGNOSTIC_FLOW);self.assertEqual(self.calls[0][2],600);self.assertEqual(self.calls[1],('collect','ios','owned-device'))
  self.assertEqual(m.digest(self.root/m.DIAGNOSTIC_FLOW),m.DIAGNOSTIC_SHA)
 def test_reported_client_error_fails_even_with_successful_cli_and_junit(self):self.assertFalse(self.invoke(bad_fixture=True)['passed'])
 def test_failed_junit_fails_even_with_successful_cli_and_fixture(self):self.assertFalse(self.invoke(bad_xml=True)['passed'])
 def test_nonzero_cli_fails_even_with_valid_evidence(self):self.assertFalse(self.invoke(code=1)['passed'])
 def test_timeout_retains_failed_result_and_attempts_collection(self):
  result=self.invoke(error=subprocess.TimeoutExpired(['maestro'],600));self.assertFalse(result['passed']);self.assertTrue(result['timedOut']);self.assertEqual(self.calls[-1],('collect','ios','owned-device'))
 def test_changed_flow_rejected_before_execution(self):
  (self.root/m.DIAGNOSTIC_FLOW).write_text('changed')
  with self.assertRaises(ValueError):self.invoke()
  self.assertEqual(self.calls,[])
 def test_cancellation_propagates(self):
  with self.assertRaises(SystemExit) as caught:self.invoke(error=SystemExit(130))
  self.assertEqual(caught.exception.code,130)
 def test_actual_main_exit_requires_both_outcomes(self):
  main=next(n for n in ast.parse(p.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='main')
  terminal=next(n for n in ast.walk(main) if isinstance(n,ast.Return) and n.value and 'summary' in ast.unparse(n.value))
  expression=compile(ast.Expression(body=terminal.value),str(p),'eval')
  for failures,passed,expected in [(0,True,0),(0,False,1),(1,True,1),(1,False,1)]:self.assertEqual(eval(expression,{'summary':{'failed':failures},'diagnostic':{'passed':passed}}),expected)
unittest.main(argv=['warm-diagnostic'],verbosity=2)
`;
  const result = spawnSync('python3', ['-c', script, consumer], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 8 tests/);
  const [config, commands] = YAML.parseAllDocuments(fs.readFileSync(path.join(root, 'tests/native/diagnostics/ios-warm-tabs-reader.yaml'), 'utf8')).map(doc => doc.toJSON());
  assert.equal(config.name, 'Diagnostic warm tabs then saved memory reader');
  assert.equal(commands[0].runFlow, '../audit/flows/navigation-warm-tabs.yaml');
  assert.deepEqual(commands.at(-1), { extendedWaitUntil: { visible: 'Edit memory book', timeout: 15000 } });
});
