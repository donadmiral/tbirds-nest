const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');

test('the recovery partitions exactly the original85 cases and never accepts missing, altered or failed execution', () => {
  const code = String.raw`
import copy,importlib.util,json,tempfile
from pathlib import Path
p=Path('scripts/quality/completion-ios-audit.py');s=importlib.util.spec_from_file_location('audit',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
manifest=json.loads(Path('tests/native/audit/manifest.json').read_text())
all_cases=[case['id'] for shard in m.SHARDS for case in m.selected_cases(manifest,shard)]
assert len(all_cases)==85 and len(set(all_cases))==85
with tempfile.TemporaryDirectory() as directory:
 folder=Path(directory)
 def populate():
  for shard,groups in m.SHARDS.items():
   report=folder/('fresh-ios-audit-'+shard+'-results');report.mkdir(exist_ok=True)
   proof={'applicationSourceCommit':m.JOURNEY.SOURCE,'applicationSourceTree':m.JOURNEY.TREE,'unchangedSourceAndBinaryAfterRun':True}
   summary={'applicationSourceCommit':m.JOURNEY.SOURCE,'platform':'ios','selectedGroups':sorted(groups)}
   rows=[{'id':case['id'],'attempts':1,'status':'passed'} for case in m.selected_cases(manifest,shard)]
   for name,value in [('consumer-proof.json',proof),('summary.json',summary),('results.json',rows)]:
    (report/name).write_text(json.dumps(value))
 populate();result=m.summarize(folder,manifest);assert result['allDeclaredCasesPassed'] and result['passed']==85 and not result['allControlsAccepted']
 report=folder/'fresh-ios-audit-social-results'
 for defect in ['missing','failed','duplicate','wrong-source','mutated-binary','retried']:
  populate();file=report/'results.json';rows=json.loads(file.read_text())
  if defect=='missing':rows.pop()
  if defect=='failed':rows[0]['status']='failed'
  if defect=='duplicate':rows[1]=copy.deepcopy(rows[0])
  if defect=='retried':rows[0]['attempts']=2
  if defect in ['wrong-source','mutated-binary']:
   p=report/'consumer-proof.json';v=json.loads(p.read_text())
   v['applicationSourceCommit' if defect=='wrong-source' else 'unchangedSourceAndBinaryAfterRun']='wrong' if defect=='wrong-source' else False
   p.write_text(json.dumps(v))
  file.write_text(json.dumps(rows))
  result=m.summarize(folder,manifest);assert not result['allDeclaredCasesPassed'],defect
 populate();(report/'summary.json').unlink();assert not m.summarize(folder,manifest)['allDeclaredCasesPassed']
print('Exact85 coverage and failure boundaries preserved')
`;
  assert.match(execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8', timeout: 30000 }), /boundaries preserved/);
});

test('the original iOS collector uses bounded metadata reads and restores its original command after failure', () => {
  const code = String.raw`
import importlib.util,json,subprocess,tempfile,types
from pathlib import Path
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load('consumer','scripts/quality/completion-ios-audit.py');runner=load('runner','scripts/quality/native-ui-audit-runner.py')
original=runner.command
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);container=root/'container';docs=container/'Documents';docs.mkdir(parents=True);target=root/'result';target.mkdir()
 for name in ['native-ui-receipt.json','native-ui-auth-diagnostics.json','native-ui-navigation-timing.json']:(docs/name).write_text(json.dumps({'name':name}))
 capture=docs/'native-memory-capture';capture.mkdir();(capture/'receipt.json').write_text('{"retained":true}')
 reads=[]
 def read(args,stage,timeout,records,output):
  reads.append((args,stage,timeout,str(output)));return str(container)
 helper=types.SimpleNamespace(setup_read=read)
 records=m.collect_with_bounded_commands(runner,helper,'selected-device',target)
 assert runner.command is original and len(reads)==3 and all(row[2]==30 for row in reads)
 assert all(row['collected'] for row in records)
 for name in ['native-ui-receipt.json','native-ui-auth-diagnostics.json','native-ui-navigation-timing.json']:
  assert (docs/name).read_bytes()==(target/name).read_bytes()
 assert (target/'memory-capture/receipt.json').read_bytes()==(capture/'receipt.json').read_bytes()
 def failure(*args):raise subprocess.TimeoutExpired(['xcrun','simctl'],30)
 helper.setup_read=failure
 try:m.collect_with_bounded_commands(runner,helper,'selected-device',target)
 except subprocess.TimeoutExpired:pass
 else:raise AssertionError('A timed-out collector became a success')
 assert runner.command is original
print('Original collector and failure outcomes preserved')
`;
  assert.match(execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8', timeout: 30000 }), /outcomes preserved/);
});

test('all85 recovery consumes the same app with three original groups and no producer build', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/native-completion-ios-audit.yml'), 'utf8');
  const workflow = YAML.parse(source);
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  const job = workflow.jobs['ios-cases'];
  assert.deepEqual(job.strategy.matrix.shard, ['settings', 'account', 'social']);
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job['runs-on'], 'macos-15-intel');
  assert.equal(workflow.env.MAESTRO_DRIVER_STARTUP_TIMEOUT, '180000');
  assert.equal(job.steps.find(step => step.with?.path === 'baseline').with.ref, 'f5be97445ef7223baeb60dd10e8cded05630b6c1');
  assert.equal(job.steps.find(step => step.with?.['artifact-ids']).with['run-id'], 41259529351);
  assert.equal(job.steps.at(-1).if, 'always()');
  assert.doesNotMatch(source, /npm ci|expo prebuild|xcodebuild .*build|codesign .*--sign|pod .*install/);
  const script = fs.readFileSync(path.join(root, 'scripts/quality/completion-ios-audit.py'), 'utf8');
  assert.match(script, /JOURNEY\.prepare_simulator/);
  assert.match(script, /runner\.run_cases\(cases, 'ios'/);
  assert.doesNotMatch(script, /starter\.main\(|runner\.validate_device\(/);
});
