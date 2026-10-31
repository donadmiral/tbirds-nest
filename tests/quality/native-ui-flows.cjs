const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const runner = 'scripts/quality/run-native-ui-flows.sh';
const validator = 'scripts/quality/native-ui-flow-results.py';
const names = ['navigation', 'memory-capture'];

function sandbox(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-required-flows-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const file of [runner, validator]) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  const bin = path.join(directory, 'bin'); fs.mkdirSync(bin);
  function executable(name, source) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${source}`); fs.chmodSync(file, 0o755);
    return file;
  }
  executable('maestro', `
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), flow = path.basename(args.at(-1), '.yaml');
if (!['navigation', 'memory-capture'].includes(flow)) throw new Error('Unexpected flow');
fs.appendFileSync('calls.jsonl', JSON.stringify({flow,args})+'\\n');
if (flow === 'navigation') fs.writeFileSync('session-kept', 'fixture');
else if (!fs.existsSync('session-kept')) throw new Error('Capture lost the preceding fixture session');
const config = JSON.parse(process.env.FLOW_CASES || '{}')[flow] || {};
const output = args[args.indexOf('--output')+1]; fs.mkdirSync(path.dirname(output), {recursive:true});
const title = flow === 'navigation' ? 'Full native app navigation' : 'Actual native memory capture and encoding';
let xml = '<testsuites><testsuite tests="1" failures="0"><testcase name="'+title+'" file="tests/native/flows/'+flow+'.yaml" status="SUCCESS"/></testsuite></testsuites>';
switch(config.report) {
 case 'failed': xml=xml.replace('failures="0"','failures="1"').replace('status="SUCCESS"/>','status="ERROR"><failure>assertion</failure></testcase>'); break;
 case 'skipped': xml=xml.replace('status="SUCCESS"/>','status="SKIPPED"><skipped/></testcase>'); break;
 case 'skippedCount': xml=xml.replace('failures="0"','failures="0" skipped="1"'); break;
 case 'errored': xml=xml.replace('status="SUCCESS"/>','status="ERROR"><error>driver</error></testcase>'); break;
 case 'emptySuite': xml='<testsuites><testsuite tests="1" failures="0"/></testsuites>'; break;
 case 'empty': xml=''; break;
 case 'malformed': xml='<testsuites>'; break;
 case 'wrongFlow': xml=xml.replace('file="tests/native/flows/'+flow+'.yaml"','file="tests/native/flows/other.yaml"'); break;
 case 'missingStatus': xml=xml.replace(' status="SUCCESS"',''); break;
 case 'duplicate': xml=xml.replace('</testsuite>',xml.match(/<testcase[^>]*>/)[0]+'</testsuite>'); break;
}
if (config.report !== 'missing') fs.writeFileSync(output, xml);
for (const key of ['--debug-output', '--test-output-dir']) fs.mkdirSync(args[args.indexOf(key)+1], {recursive:true});
console.log('Executed '+flow); process.exit(config.exit || 0);
`);
  executable('tee', `
const fs = require('node:fs'); let data=''; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => data+=chunk); process.stdin.on('end', () => {
 fs.writeFileSync(process.argv[2], data); process.stdout.write(data);
 process.exit(process.env.FAIL_NAV_TEE === '1' && process.argv[2].includes('navigation.log') ? 9 : 0);
});
`);
  const env = { ...process.env, CI: 'true', PATH: bin + path.delimiter + process.env.PATH,
    FLOW_CASES: JSON.stringify(options.cases || {}), FAIL_NAV_TEE: options.failTee ? '1' : '0' };
  const execute = () => spawnSync('bash', [runner, 'retained-device'], { cwd: directory, env, encoding: 'utf8', timeout: 15000 });
  const read = file => JSON.parse(fs.readFileSync(path.join(directory, 'native-ui-logs', file), 'utf8'));
  const calls = () => fs.readFileSync(path.join(directory, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  return { directory, env, execute, read, calls, executable };
}

function assertBothOnce(h) {
  const calls = h.calls(); assert.deepEqual(calls.map(c => c.flow), names);
  assert.ok(calls.every(c => c.args[0] === '--device' && c.args[1] === 'retained-device'));
  assert.notEqual(calls[0].args[calls[0].args.indexOf('--debug-output')+1], calls[1].args[calls[1].args.indexOf('--debug-output')+1]);
  assert.deepEqual(h.read('flow-results.json').flows.map(f => f.attempts), [1, 1]);
}

test('actual shell requires two separate successful flows without a reset or repeated capture', t => {
  const h = sandbox(t); const result = h.execute(); assert.equal(result.status, 0, result.stdout + result.stderr);
  assertBothOnce(h); assert.equal(h.read('flow-verification.json').passed, true);
  const repeated = h.execute(); assert.equal(repeated.status, 2); assertBothOnce(h);
});

for (const [label, cases, exits] of [
  ['navigation failure still attempts capture', { navigation: { exit: 7, report: 'failed' } }, [7, 0]],
  ['capture failure preserves navigation success and fails the job', { 'memory-capture': { exit: 8, report: 'failed' } }, [0, 8]],
  ['both failures remain recorded', { navigation: { exit: 7 }, 'memory-capture': { exit: 8 } }, [7, 8]],
]) test(label, t => {
  const h = sandbox(t, { cases }); assert.notEqual(h.execute().status, 0); assertBothOnce(h);
  assert.deepEqual(h.read('flow-results.json').flows.map(f => f.exitCode), exits);
  assert.equal(h.read('flow-verification.json').passed, false);
});

test('a tee failure remains nonzero and does not suppress the capture invocation', t => {
  const h = sandbox(t, { failTee: true }); assert.notEqual(h.execute().status, 0); assertBothOnce(h);
  assert.equal(h.read('flow-results.json').flows[0].exitCode, 9);
});

for (const report of ['failed', 'skipped', 'skippedCount', 'errored', 'emptySuite', 'empty', 'missing', 'malformed', 'wrongFlow', 'missingStatus', 'duplicate']) {
  test(`zero CLI exits cannot pass a ${report} capture JUnit report`, t => {
    const h = sandbox(t, { cases: { 'memory-capture': { report } } });
    assert.notEqual(h.execute().status, 0); assertBothOnce(h);
    assert.deepEqual(h.read('flow-results.json').flows.map(f => f.exitCode), [0, 0]);
    assert.equal(h.read('flow-verification.json').passed, false);
  });
}

test('missing, malformed, incomplete or repeated flow results fail closed', t => {
  const h = sandbox(t); assert.equal(h.execute().status, 0);
  const file = path.join(h.directory, 'native-ui-logs/flow-results.json'), original = fs.readFileSync(file, 'utf8');
  for (const mutate of [() => fs.rmSync(file), () => fs.writeFileSync(file, '{'),
    () => fs.writeFileSync(file, '[]'), () => { const x=JSON.parse(original); x.flows[1].attempts=0; x.flows[1].exitCode=null; fs.writeFileSync(file,JSON.stringify(x)); },
    () => { const x=JSON.parse(original); x.flows[1].attempts=2; fs.writeFileSync(file,JSON.stringify(x)); }]) {
    fs.writeFileSync(file, original); mutate();
    const result = spawnSync('python3', [validator, 'native-ui-logs'], { cwd: h.directory, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.equal(JSON.parse(result.stdout).passed, false);
  }
});

for (const platform of ['android', 'ios']) {
  for (const failure of ['none', 'navigation', 'decoder', 'fullVerifier', 'evidence']) {
    test(`actual ${platform} shell tail aggregates ${failure} and always runs both existing verifiers`, t => {
      const h = sandbox(t, { cases: failure === 'navigation' ? { navigation: { exit: 7, report: 'failed' } } : {} });
      const docs = path.join(h.directory, 'container/Documents'); fs.mkdirSync(path.join(docs, 'native-memory-capture'), { recursive: true });
      for (const file of ['native-ui-receipt.json', 'native-ui-auth-diagnostics.json']) fs.writeFileSync(path.join(docs, file), '{}');
      fs.writeFileSync(path.join(docs, 'native-memory-capture/receipt.json'), '{}');
      if (failure === 'evidence') fs.rmSync(path.join(docs, 'native-ui-receipt.json'));
      const adb = h.executable('adb', `
const fs=require('node:fs');
if(process.argv[2]==='exec-out'){if(process.env.FAIL_EVIDENCE==='1'&&process.argv.at(-1).endsWith('/native-ui-receipt.json'))process.exit(6);console.log('{}');}
else if(process.argv[2]==='pull'){fs.mkdirSync(process.argv.at(-1),{recursive:true});}
else throw new Error('Unexpected adb mutation');
`);
      h.executable('xcrun', `if(process.argv.slice(2,4).join(' ')!=='simctl get_app_container')throw new Error('Unexpected xcrun mutation');console.log(process.env.TEST_CONTAINER);`);
      fs.writeFileSync(path.join(h.directory, 'scripts/quality/verify-native-ui-memory.py'),
        "from pathlib import Path\nimport os,sys\nwith Path('verified.jsonl').open('a') as out: out.write('memory\\n')\nsys.exit(int(os.environ['DECODER_EXIT']))\n");
      fs.writeFileSync(path.join(h.directory, 'scripts/quality/verify-native-ui.cjs'),
        "require('node:fs').appendFileSync('verified.jsonl','full\\n');process.exit(Number(process.env.FULL_VERIFIER_EXIT));\n");
      const source = fs.readFileSync(path.join(root, `scripts/quality/test-${platform}-app-ui.sh`), 'utf8');
      const marker = '\nflow_status=0\n'; assert.equal(source.split(marker).length, 2);
      const tail = source.slice(source.indexOf(marker)+1);
      const env = { ...h.env, TEST_CONTAINER: path.join(h.directory, 'container'), TEST_ADB: adb,
        ANDROID_SERIAL: 'retained-device', TEST_DEVICE: 'retained-device', FAIL_EVIDENCE: failure === 'evidence' ? '1' : '0',
        DECODER_EXIT: failure === 'decoder' ? '4' : '0', FULL_VERIFIER_EXIT: failure === 'fullVerifier' ? '5' : '0' };
      const result = spawnSync('bash', ['-c', 'set -euo pipefail\nui_simulator="$TEST_DEVICE"\nadb_bin="$TEST_ADB"\n'+tail],
        { cwd: h.directory, env, encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, failure === 'none' ? 0 : 1, result.stdout + result.stderr); assertBothOnce(h);
      assert.equal(fs.readFileSync(path.join(h.directory, 'verified.jsonl'), 'utf8'), 'memory\nfull\n');
      const phases = h.read('phase-results.json');
      assert.equal(phases.flows, failure === 'navigation' ? 1 : 0);
      assert.equal(phases.evidence, failure === 'evidence' ? 1 : 0);
      assert.equal(phases.memoryDecoder, failure === 'decoder' ? 4 : 0);
      assert.equal(phases.fullAppVerifier, failure === 'fullVerifier' ? 5 : 0);
    });
  }
}

test('capture remains a single separate deep-link flow and source receipts bind its runner', () => {
  const capture = fs.readFileSync(path.join(root, 'tests/native/flows/memory-capture.yaml'), 'utf8');
  assert.match(capture, /- openLink: platinum-circles-qa:\/\/ui-fixture\/memory/);
  assert.doesNotMatch(capture, /launchApp|clearState|clearKeychain|stopApp|Sign in/);
  const navigation = fs.readFileSync(path.join(root, 'tests/native/flows/navigation.yaml'), 'utf8');
  assert.doesNotMatch(navigation, /runFlow: memory-capture\.yaml/);
  const manifest = fs.readFileSync(path.join(root, 'scripts/quality/prepare-native-ui.cjs'), 'utf8');
  assert.ok(manifest.includes(runner)); assert.ok(manifest.includes(validator));
  const fullVerifier = fs.readFileSync(path.join(root, 'scripts/quality/verify-native-ui.cjs'), 'utf8');
  assert.match(fullVerifier, /execFileSync\('python3', \[path\.join\(__dirname, 'native-ui-flow-results\.py'\), evidence\]/);
  assert.match(fullVerifier, /const captured = collect\(path\.join\(evidence, 'maestro'\)\)/);
});
