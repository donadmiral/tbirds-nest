const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

test('actual audit verifier rejects reported and dropped diagnostics without disclosing payloads', () => {
  const script = String.raw`
import importlib.util,json,tempfile,unittest
from pathlib import Path
p=Path('scripts/quality/native-ui-audit-runner.py');s=importlib.util.spec_from_file_location('runner',p);r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
class Checks(unittest.TestCase):
 def check(self,diagnostics=None,dropped=0,signed_out=False,legacy=False):
  case={'id':'support-reply-error','kind':'signed-out-control' if signed_out else 'entry-smoke','fixtureScenario':'reply-error'}
  audit={'caseId':None if signed_out else case['id'],'scenario':case['fixtureScenario'],'rejected':[],'diagnostics':[] if diagnostics is None else diagnostics,'diagnosticsDropped':dropped}
  if legacy:del audit['diagnostics'];del audit['diagnosticsDropped']
  receipt={'mode':'synthetic-native-ui','networkForwarded':False,'unhandled':[],'requests':[] if signed_out else [{'path':'/auth/v1/token'},{'path':'/rest/v1/rpc/send_member_support_reply','status':500}],'audit':audit}
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'receipt.json';path.write_text(json.dumps(receipt));result=r.validate_receipt(path,case)
  self.assertNotIn('PRIVATE-SENTINEL',json.dumps(result))
  return result
 def test_clean_controlled_support_error_remains_accepted(self):self.assertTrue(self.check()['passed'])
 def test_clean_signed_out_remains_accepted(self):self.assertTrue(self.check(signed_out=True)['passed'])
 def test_older_clean_receipt_remains_compatible(self):self.assertTrue(self.check(legacy=True)['passed'])
 def test_reported_error_is_not_success(self):
  self.assertEqual(self.check([{'category':'TypeError','private':'PRIVATE-SENTINEL'}]),{'passed':False,'issue':'reported-client-error','diagnosticCount':1,'diagnosticsDropped':0})
 def test_dropped_only_still_fails(self):
  self.assertEqual(self.check([],3),{'passed':False,'issue':'reported-client-error','diagnosticCount':0,'diagnosticsDropped':3})
 def test_recorded_and_dropped_are_both_counted(self):
  result=self.check([{'category':'Error'},{'category':'TypeError'}],2);self.assertFalse(result['passed']);self.assertEqual(result['diagnosticCount'],2);self.assertEqual(result['diagnosticsDropped'],2)
 def test_signed_out_cannot_bypass_error_gate(self):self.assertFalse(self.check([{'category':'Error'}],signed_out=True)['passed'])
 def test_malformed_record_collection_fails(self):
  for value in [{},'PRIVATE-SENTINEL',1,False]:
   with self.subTest(value=type(value).__name__):self.assertEqual(self.check(value)['issue'],'malformed-audit-diagnostics')
 def test_malformed_drop_count_fails(self):
  for value in [-1,True,1.5,'PRIVATE-SENTINEL',None,[],{}]:
   with self.subTest(value=type(value).__name__):self.assertEqual(self.check([],value)['issue'],'malformed-audit-diagnostics')
unittest.main()
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 9 tests/);
});

test('successful UI with a client error fails its case and the next independent case still runs', () => {
  const script = String.raw`
import importlib.util,json,tempfile,types
from pathlib import Path
p=Path('scripts/quality/native-ui-audit-runner.py');s=importlib.util.spec_from_file_location('runner',p);r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
cases=[{'id':i,'group':'support','kind':'entry-smoke','fixtureScenario':'baseline','name':'Case '+i,'flow':'flows/'+i+'.yaml'} for i in ['reported','clean']]
calls=[]
def execute(args,**kwargs):
 case=cases[len(calls)];calls.append(case['id']);Path(args[args.index('--output')+1]).write_text('<testsuites><testsuite tests="1" failures="0"><testcase name="'+case['name']+'" status="SUCCESS" file="tests/native/audit/'+case['flow']+'"/></testsuite></testsuites>');return types.SimpleNamespace(returncode=0)
def collect(platform,device,target):
 case=next(c for c in cases if c['id']==target.name);(target/'native-ui-receipt.json').write_text(json.dumps({'mode':'synthetic-native-ui','networkForwarded':False,'unhandled':[],'requests':[{'path':'/auth/v1/token'}],'audit':{'caseId':case['id'],'scenario':'baseline','rejected':[],'diagnostics':[{'category':'Error','source':'render','private':'PRIVATE-SENTINEL'}] if case['id']=='reported' else [],'diagnosticsDropped':0}}));return []
with tempfile.TemporaryDirectory() as d:
 result=r.run_cases(cases,'ios','selected',Path(d),execute,collect)
 assert calls==['reported','clean']
 assert [x['junit']['passed'] for x in result]==[True,True]
 assert [x['status'] for x in result]==['failed','passed']
 assert result[0]['fixture']['issue']=='reported-client-error'
 assert result[0]['fixture']['diagnosticCount']==1
 assert 'PRIVATE-SENTINEL' not in (Path(d)/'results.json').read_text()
print('UI success cannot bypass diagnostics; independent continuation preserved')
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /independent continuation preserved/);
});
