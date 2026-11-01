const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');

test('reviewed iOS interaction copies reject altered resets, missing assertions and source edits', () => {
  execFileSync('python3', ['-c', String.raw`
import hashlib,importlib.util,json,pathlib,shutil,tempfile,unittest
root=pathlib.Path.cwd()
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
f=load('corrections',root/'scripts/quality/completion-ios-social-flow-corrections.py')
r=load('remaining',root/'scripts/quality/completion-ios-ecf-remaining.py')
fixtures=root/'tests/quality/fixtures/completion-ios-social'
class ExecutionCopyBoundary(unittest.TestCase):
 def setup_copy(self,folder):
  baseline=folder/'baseline';target=baseline/f.PREFIX/'flows';target.mkdir(parents=True)
  hashes={}
  for name in ['jobs-application-entry.yaml','feed-article-draft.yaml','_signin.yaml']:
   value=(fixtures/name).read_bytes();(target/name).write_bytes(value);hashes[f.PREFIX+'flows/'+name]=f.digest(value)
  return baseline,{'hashes':hashes}
 def test_exact_reviewed_originals_transform_and_reverse(self):
  for name,contract in f.CORRECTIONS.items():
   original=(fixtures/name).read_bytes();self.assertEqual(f.digest(original),contract['before'])
   changed=f.transform(name,original);self.assertEqual(f.digest(changed),contract['after'])
   self.assertEqual(f.reverse(name,changed),original)
   if name=='feed-article-draft.yaml':
    self.assertIn(('- assertVisible: '+f.PARAGRAPH+'\n').encode(),changed)
    self.assertIn(b'- assertVisible: An audit article\n',changed)
 def test_unapproved_source_or_executed_change_is_rejected(self):
  for name in f.CORRECTIONS:
   original=(fixtures/name).read_bytes();changed=f.transform(name,original)
   for candidate in [original+b'\n',original.replace(b'15000',b'30000')]:
    with self.assertRaises(ValueError):f.transform(name,candidate)
   with self.assertRaises(ValueError):f.reverse(name,changed+b'\n')
  name='feed-article-draft.yaml';changed=f.transform(name,(fixtures/name).read_bytes())
  with self.assertRaises(ValueError):f.reverse(name,changed.replace(('- assertVisible: '+f.PARAGRAPH+'\n').encode(),b''))
  with self.assertRaises(ValueError):f.transform('unreviewed.yaml',b'anything')
 def test_fresh_disposable_tree_preserves_every_canonical_byte(self):
  with tempfile.TemporaryDirectory() as temporary:
   folder=pathlib.Path(temporary);baseline,source=self.setup_copy(folder);execution=folder/'execution'
   proof=f.materialize(baseline,execution,source);f.verify_execution(execution,proof)
   self.assertEqual(len(proof['corrections']),2)
   self.assertEqual(proof['originalSignInSha256'],f.SIGNIN_SHA)
   for name,expected in source['hashes'].items():self.assertEqual(f.digest((baseline/name).read_bytes()),expected)
   self.assertEqual((baseline/f.SIGNIN).read_bytes(),(execution/f.SIGNIN).read_bytes())
   with self.assertRaises(ValueError):f.materialize(baseline,execution,source)
   with self.assertRaises(ValueError):f.materialize(baseline,baseline/'execution',source)
   target=execution/f.PREFIX/'flows/feed-article-draft.yaml';original=target.read_bytes()
   target.write_bytes(original.replace(('- assertVisible: '+f.PARAGRAPH+'\n').encode(),b''))
   with self.assertRaises(ValueError):f.verify_execution(execution,proof)
   target.write_bytes(original);extra=execution/f.PREFIX/'flows/unreviewed.yaml';extra.write_bytes(b'new')
   with self.assertRaises(ValueError):f.verify_execution(execution,proof)
   extra.unlink();reset=execution/f.SIGNIN;reset.write_bytes(reset.read_bytes()+b'\n')
   with self.assertRaises(ValueError):f.verify_execution(execution,proof)
 def test_altered_signin_and_aliases_are_rejected_before_copy(self):
  with tempfile.TemporaryDirectory() as temporary:
   folder=pathlib.Path(temporary);baseline,source=self.setup_copy(folder);reset=baseline/f.SIGNIN;original=reset.read_bytes()
   reset.write_bytes(original+b'\n')
   with self.assertRaises(ValueError):f.materialize(baseline,folder/'execution',source)
   reset.write_bytes(original);other=folder/'alias-source';other.write_bytes(original);reset.unlink();reset.symlink_to(other)
   with self.assertRaises(ValueError):f.materialize(baseline,folder/'execution',source)
   reset.unlink();reset.write_bytes(original);changed={'hashes':{**source['hashes'],f.SIGNIN:'f'*64}}
   with self.assertRaises(ValueError):f.materialize(baseline,folder/'execution',changed)
 def test_only_failed_social_and_settings_partitions_are_selected(self):
  manifest=json.loads((root/'tests/native/audit/manifest.json').read_text())
  self.assertEqual(len(r.selected_cases(manifest,'social')),31)
  self.assertEqual(len(r.selected_cases(manifest,'settings')),27)
  with self.assertRaises(ValueError):r.selected_cases(manifest,'account')
  manifest['cases'][0]['id']=manifest['cases'][1]['id']
  with self.assertRaises(ValueError):r.selected_cases(manifest,'social')
unittest.main(argv=['execution-copy'],verbosity=2)
`], { stdio: 'inherit', timeout: 15000 });
});

test('remaining recovery cannot duplicate the active account or original journey', () => {
  const workflow = YAML.parse(fs.readFileSync('.github/workflows/completion-ios-ecf-remaining.yml', 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  const job = workflow.jobs['ios-remaining'];
  assert.deepEqual(job.strategy.matrix.shard, ['social', 'settings']);
  assert.equal(job['timeout-minutes'], 100);
  assert.equal(workflow.env.MAESTRO_DRIVER_STARTUP_TIMEOUT, '180000');
  assert.equal(job.steps.find(step => step.name === 'Read the exact current source used to build the app').with.ref,
    'ecf5e5a960106d7cb04c211ee99e9e89c09642cc');
  assert.equal(job.steps.find(step => step.name === 'Retrieve the verified current Simulator app').with['run-id'], 41266020074);
  assert.ok(workflow.on.push.paths.every(path => !path.includes('ecf-account') && !path.includes('journey')));
});
