const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const consumer = path.join(root, 'scripts/quality/native-ui-ios-d46-recovery.py');

test('warm reader executes the original single tab journey with unique page content and both book pages', () => {
  const parse = relative => YAML.parseAllDocuments(fs.readFileSync(path.join(root, relative), 'utf8')).map(doc => doc.toJSON());
  const [config, flow] = parse('tests/native/diagnostics/ios-warm-reader-controls.yaml');
  const [, original] = parse('tests/native/flows/navigation.yaml');
  const [, reader] = parse('tests/native/flows/memory-navigation.yaml');
  assert.equal(config.name, 'Diagnostic original tabs to saved memory reader controls');
  assert.equal(config.appId, 'app.platinumcircles.mobile.qa');
  assert.equal(flow[0].runFlow, '../../../../baseline/tests/native/audit/flows/_signin.yaml');
  const start = original.findIndex(command => command.tapOn === 'Latest');
  const end = original.findIndex(command => command.runFlow === 'memory-navigation.yaml');
  const originalTaps = original.slice(start, end).filter(command => command.tapOn).map(command => command.tapOn);
  const journey = flow.slice(flow.findIndex(command => command.tapOn === 'Latest'), flow.findIndex(command => command.scrollUntilVisible));
  assert.deepEqual(journey.filter(command => command.tapOn).map(command => command.tapOn), originalTaps);
  assert.equal(flow.some(command => command.repeat || command.retry), false);
  for (const command of flow.filter(command => command.extendedWaitUntil)) assert.equal(command.extendedWaitUntil.timeout, 15000);
  assert.equal(flow.some(command => command.assertVisible === 'Jobs' || command.assertVisible === 'Messages'), false);
  for (const placeholder of ['Search jobs by title, keyword, or company', 'Search messages']) {
    assert.ok(flow.some(command => command.assertVisible === placeholder));
  }
  const originalJobs = original.find(command => command.extendedWaitUntil?.visible?.includes('Product designer'));
  const originalMessages = original.find(command => command.extendedWaitUntil?.visible?.includes('Jordan Ellis'));
  assert.deepEqual(flow.find(command => command.extendedWaitUntil?.visible?.includes('Product designer')), originalJobs);
  assert.deepEqual(flow.find(command => command.extendedWaitUntil?.visible?.includes('Jordan Ellis')), originalMessages);
  const readerStart = reader.findIndex(command => command.tapOn === 'Open book');
  const readerEnd = reader.findIndex(command => command.takeScreenshot === 'memory-reader');
  const warmReaderStart = flow.findIndex(command => command.tapOn === 'Open book');
  assert.deepEqual(flow.slice(warmReaderStart, -1), reader.slice(readerStart, readerEnd));
});

test('warm diagnostic fails closed, captures exact failed processes once, and never counts as original acceptance', () => {
  const script = String.raw`
import ast,copy,importlib.util,json,pathlib,plistlib,subprocess,tempfile,types,unittest
p=pathlib.Path(__import__('sys').argv[1]);spec=importlib.util.spec_from_file_location('consumer',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=m.load_helpers(p.parent);runner=m.load_module('runner',p.with_name('native-ui-audit-runner.py'));repo=p.parents[2]
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.tools=self.root/'recovery-tools';self.tools.mkdir();self.baseline=self.root/'baseline';self.baseline.mkdir();self.output=self.root/'out';self.output.mkdir();self.calls=[];self.budget={'used':False}
  for target,source in [(self.tools/m.WARM_CONTROLS_FLOW,repo/m.WARM_CONTROLS_FLOW),(self.baseline/m.SIGNIN_FLOW,repo/m.SIGNIN_FLOW)]:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read_bytes())
  self.scenarios=json.loads((repo/'tests/native/audit/manifest.json').read_text());self.case=next(c for c in self.scenarios['cases'] if c['id']=='navigation-warm-tabs');self.bundles={}
  for package,name in [(original.PACKAGE,'PlatinumQA'),(original.DRIVER_PACKAGE,'Runner')]:
   bundle=self.root/package;bundle.mkdir();(bundle/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':package,'CFBundleExecutable':name}));(bundle/name).write_bytes(b'controlled executable');self.bundles[package]=bundle
  def container(device,package,kind):self.calls.append(('container',device,package,kind));return self.bundles[package]
  def find(executable):self.calls.append(('find',str(executable)));return {'pid':123,'executable':str(executable)}
  def sample(identity,target):self.calls.append(('sample',identity['executable']));return {'complete':True,'durationSeconds':3,'wallBudgetSeconds':8}
  self.helper=types.SimpleNamespace(atomic_json=original.atomic_json,PACKAGE=original.PACKAGE,DRIVER_PACKAGE=original.DRIVER_PACKAGE,scoped_container=container,find_process=find,sample_process=sample)
 def tearDown(self):self.tmp.cleanup()
 def invoke(self,code=0,bad_xml=False,bad_fixture=False,error=None):
  def execute(args,timeout,**kwargs):
   self.calls.append(('execute',args,timeout,kwargs['cwd']))
   if error:raise error
   xml='<testsuites><testsuite tests="1" failures="0"><testcase name="'+m.WARM_CONTROLS_NAME+'" file="'+m.WARM_CONTROLS_FLOW+'" status="SUCCESS"/></testsuite></testsuites>'
   (self.output/'diagnostic-warm-reader-controls'/'junit.xml').write_text(xml.replace('SUCCESS','ERROR') if bad_xml else xml);return types.SimpleNamespace(returncode=code)
  def collect(platform,device,target):
   self.calls.append(('collect',platform,device));receipt={'mode':'synthetic-native-ui','networkForwarded':False,'requests':[{'path':'/auth/v1/token'}],'unhandled':[],'audit':{'caseId':self.case['id'],'scenario':self.case['fixtureScenario'],'rejected':[],'diagnostics':[],'diagnosticsDropped':0}}
   if bad_fixture:receipt['audit']['caseId']='memory-reader-controls'
   (target/'native-ui-receipt.json').write_text(json.dumps(receipt));return [{'collected':True}]
  return m.run_warm_reader_controls_diagnostic(self.helper,types.SimpleNamespace(collect=collect,validate_receipt=runner.validate_receipt),execute,self.baseline,self.tools,self.output,'exact-device',self.scenarios,self.budget)
 def test_pass_requires_real_identity_fixture_and_junit_without_sampling(self):
  r=self.invoke();self.assertTrue(r['passed']);self.assertFalse(r['countedInBaseline85']);self.assertEqual(r['timeoutSeconds'],600);self.assertEqual(r['readerRequirementMs'],15000);self.assertEqual(r['navigationCycles'],1);self.assertEqual(self.calls[0][1][-1],m.WARM_CONTROLS_FLOW);self.assertEqual(self.calls[0][2],600);self.assertEqual(self.calls[0][3],self.tools);self.assertFalse(self.budget['used']);self.assertNotIn('failureCapture',r)
 def test_ui_failure_samples_app_and_driver_before_collection_without_busy_marker(self):
  r=self.invoke(code=1);self.assertFalse(r['passed']);self.assertTrue(r['failureCapture']['attempted']);self.assertFalse(r['failureCapture']['changesVerdict']);self.assertEqual([x['role'] for x in r['failureCapture']['samples']],['app','driver']);self.assertEqual(len([x for x in self.calls if x[0]=='sample']),2);self.assertEqual(self.calls[-1][0],'collect');self.assertTrue(self.budget['used'])
 def test_timeout_samples_and_remains_failed(self):
  r=self.invoke(error=subprocess.TimeoutExpired(['maestro'],600));self.assertFalse(r['passed']);self.assertTrue(r['timedOut']);self.assertTrue(r['failureCapture']['attempted'])
 def test_false_positive_cli_without_valid_junit_samples_and_fails(self):
  r=self.invoke(bad_xml=True);self.assertFalse(r['passed']);self.assertTrue(r['failureCapture']['attempted'])
 def test_wrong_fixture_case_samples_and_fails(self):
  r=self.invoke(bad_fixture=True);self.assertFalse(r['passed']);self.assertTrue(r['failureCapture']['attempted'])
 def test_sampling_error_cannot_change_failure(self):
  def sample(*args):raise OSError('controlled denied sample')
  self.helper.sample_process=sample;r=self.invoke(code=1);self.assertFalse(r['passed']);self.assertEqual([row['complete'] for row in r['failureCapture']['samples']],[False,False])
 def test_previously_used_sample_budget_prevents_repeated_sampling(self):
  self.budget['used']=True;r=self.invoke(code=1);self.assertFalse(r['passed']);self.assertFalse(r['failureCapture']['attempted']);self.assertFalse(any(x[0]=='sample' for x in self.calls))
 def test_wrong_bundle_id_cannot_be_sampled(self):
  for package,bundle in self.bundles.items():(bundle/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'wrong','CFBundleExecutable':'PlatinumQA'}))
  r=self.invoke(code=1);self.assertFalse(r['passed']);self.assertFalse(any(x[0]=='sample' for x in self.calls));self.assertEqual(len(r['failureCapture']['samples']),2)
 def test_executable_cannot_escape_selected_bundle(self):
  outside=self.root/'other-executable';outside.write_bytes(b'other')
  for package,bundle in self.bundles.items():
   info=plistlib.loads((bundle/'Info.plist').read_bytes());executable=bundle/info['CFBundleExecutable'];executable.unlink();executable.symlink_to(outside)
  r=self.invoke(code=1);self.assertFalse(r['passed']);self.assertFalse(any(x[0]=='sample' for x in self.calls))
 def test_changed_signin_fails_before_execute(self):
  (self.baseline/m.SIGNIN_FLOW).write_text('changed')
  with self.assertRaises(ValueError):self.invoke()
  self.assertEqual(self.calls,[])
 def test_cancellation_propagates_without_diagnostic_sampling(self):
  with self.assertRaises(SystemExit):self.invoke(error=SystemExit(130))
  self.assertFalse(self.budget['used'])
 def test_selection_cannot_combine_original_direct_and_warm_modes(self):
  self.assertEqual(m.select_execution_cases(self.scenarios,{'memory'},warm_controls=True),[])
  for kwargs in [{'direct':True},{'warm':True},{'requested_ids':'memory-reader-controls'}]:
   with self.assertRaises(ValueError):m.select_execution_cases(self.scenarios,{'memory'},warm_controls=True,**kwargs)
 def test_summary_keeps_all_original_cases_unselected(self):
  main=next(n for n in ast.parse(p.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='main');statement=next(n for n in ast.walk(main) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='summary' for t in n.targets));code=compile(ast.Module(body=[statement],type_ignores=[]),str(p),'exec')
  for passed in [True,False]:
   ns={**m.__dict__,'groups':{'memory'},'scenarios':self.scenarios,'selected_case_ids':[],'unselected_case_ids':[c['id'] for c in self.scenarios['cases']],'results':[],'diagnostic':{'passed':passed},'args':types.SimpleNamespace(direct_reader_diagnostic_only=False,warm_reader_diagnostic=False,warm_reader_controls_diagnostic_only=True)};exec(code,ns);r=ns['summary'];self.assertEqual((r['attempted'],r['passed'],r['failed']),(0,0,0));self.assertEqual(len(r['unselectedCaseIds']),85);self.assertEqual(r['diagnosticPassed'],int(passed));self.assertTrue(r['diagnosticOnly'])
unittest.main(argv=['warm-reader-controls'],verbosity=2)
`;
  const result = spawnSync('python3', ['-c', script, consumer], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 13 tests/);
});
