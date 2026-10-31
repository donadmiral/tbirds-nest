#!/usr/bin/env python3
"""Local-only verification receipt collector; production sources are never edited."""
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path('/workspace/scratch/d4753960f6a2/tbirds-nest')
OUT = Path('/tmp/platinum-final-verification')
NODE = subprocess.check_output(['node', '-p', 'process.execPath'], text=True).strip()
OUT.mkdir(parents=True, exist_ok=True)

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def source_snapshot(scope):
    inventory = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT)
    names = set(p.decode() for p in inventory.split(b'\0') if p)
    for generated in ['web/next-env.d.ts', 'admin-web/next-env.d.ts']:
        if (ROOT / generated).is_file():
            names.add(generated)
    files = {}
    for name in sorted(names):
        p = ROOT / name
        if not p.is_file() or name.startswith('docs/') or name.endswith('.tsbuildinfo'):
            continue
        if p.name.startswith('.env'):
            continue
        if any(part in ['node_modules', '.next', '.git'] for part in p.parts):
            continue
        if scope == 'web' and not (name.startswith(('web/', 'shared/')) or name in ['package.json', 'package-lock.json']):
            continue
        if scope == 'admin' and not (name.startswith(('admin-web/', 'shared/')) or name in ['package.json', 'package-lock.json']):
            continue
        if scope == 'native' and name.startswith(('web/', 'admin-web/', 'supabase/', '.github/')):
            continue
        if scope == 'database' and not name.startswith(('supabase/', 'tests/', 'shared/')):
            continue
        files[name] = sha(p)
    encoded = ''.join(f'{name}\0{digest}\n' for name, digest in files.items()).encode()
    return {'scope': scope, 'sha256': hashlib.sha256(encoded).hexdigest(), 'file_count': len(files), 'files': files,
            'exclusions': ['docs/**', '**/*.tsbuildinfo', '**/node_modules/**', '**/.next/**', '**/.git/**', '**/.env*'],
            'additional_inputs': ['web/next-env.d.ts', 'admin-web/next-env.d.ts'],
            'algorithm': 'SHA-256 over sorted UTF-8 path, NUL, lowercase file SHA-256, LF records'}

def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')

def parse_counts(log, include_rpc_custom=False):
    text = log.read_text(errors='replace')
    text = re.sub(r'\x1b\[[0-9;]*m', '', text)
    blocks = []
    current = None
    for line in text.splitlines():
        match = re.match(r'^(?:#|ℹ)\s+(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+([\d.]+)\s*$', line)
        if not match:
            continue
        key, value = match.groups()
        if key == 'tests':
            if current:
                blocks.append(current)
            current = {}
        if current is not None:
            current[key] = float(value) if '.' in value else int(value)
    if current:
        blocks.append(current)
    custom = []
    for match in re.finditer(r'^(\d+)/(\d+) auth regression checks passed\s*$', text, flags=re.M):
        passed, total = map(int, match.groups())
        custom.append({'kind':'auth custom regression runner', 'tests':total, 'pass':passed, 'fail':total-passed, 'skipped':0})
    if include_rpc_custom:
        decoder = json.JSONDecoder()
        for match in re.finditer(r'^\{', text, flags=re.M):
            try:
                report, _ = decoder.raw_decode(text[match.start():])
            except ValueError:
                continue
            count = None
            if isinstance(report.get('testCount'), int) and isinstance(report.get('tests'), list):
                count = report['testCount']
            elif isinstance(report.get('tests'), list) and isinstance(report.get('passed'), int):
                count = len(report['tests'])
            elif isinstance(report.get('checks'), list):
                count = len(report['checks'])
            elif isinstance(report.get('checks'), int) and isinstance(report.get('results'), list):
                count = report['checks']
            if count is not None:
                passed = report.get('passed', count)
                if isinstance(report.get('results'), list):
                    passed = sum(row.get('passed') is True for row in report['results'])
                custom.append({'kind':'RPC custom JSON check runner', 'suite':report.get('suite', report.get('candidate')), 'tests':count, 'pass':passed, 'fail':count-passed, 'skipped':0})
        for match in re.finditer(r'^(\d+) verification integrity database scenarios passed$', text, flags=re.M):
            count = int(match.group(1))
            custom.append({'kind':'RPC verification integrity custom runner','tests':count,'pass':count,'fail':0,'skipped':0})
    return {'node_test_summaries': blocks, 'custom_summaries': custom,
            'eprem_matches': len(re.findall(r'\bEPERM\b', text)),
            'skip_lines': [line for line in text.splitlines() if re.search(r'(?:# SKIP|# TODO|\bSKIP\b)', line)][:80]}

def execute(command, name, cwd=ROOT, env=None, timeout=600):
    log = OUT / (name.replace('/', '__') + '.log')
    started_at, start = now(), time.monotonic()
    failure = None
    with log.open('w') as handle:
        try:
            result = subprocess.run(command, cwd=cwd, env=env, stdout=handle, stderr=subprocess.STDOUT, timeout=timeout)
            code = result.returncode
        except subprocess.TimeoutExpired:
            failure, code = 'timeout', 124
        except OSError as error:
            failure, code = f'{type(error).__name__}: {error}', 127
    record = {'command': command, 'cwd': str(cwd), 'started_at':started_at, 'completed_at':now(),
              'duration_seconds':round(time.monotonic()-start, 3), 'exit_code':code,
              'log_path':str(log), 'log_sha256':sha(log), **parse_counts(log, include_rpc_custom=name == "rpc-authorization")}
    if failure:
        record['runner_failure'] = failure
    return record

def main():
    gate = sys.argv[1]
    execution_cwd = ROOT
    if gate.startswith('tsc-'):
        kind = gate[4:]
        package = {'native':'', 'web':'web/', 'admin':'admin-web/'}[kind]
        scope = kind
        commands = [(['node', package+'node_modules/typescript/bin/tsc', '--noEmit', '-p', package+'tsconfig.json'], gate)]
        strategy = 'TypeScript no-emit project check'
    elif gate in ['native-regressions', 'web-regressions', 'admin-regressions', 'supabase-node']:
        is_db = gate == 'supabase-node'
        is_web = gate == 'web-regressions'
        is_admin = gate == 'admin-regressions'
        execution_cwd = ROOT / 'admin-web' if is_admin else ROOT / 'web' if is_web else ROOT
        scope = 'database' if is_db else 'admin' if is_admin else 'web' if is_web else 'all'
        files = sorted(ROOT.glob('supabase/tests/*.test.*')) if is_db else sorted([*execution_cwd.glob('tests/*.cjs'), *execution_cwd.glob('tests/quality/*.cjs')])
        args = ['node', '--experimental-strip-types'] if is_db else ['node']
        commands = [(args + [str(p.relative_to(execution_cwd))], gate+'__'+str(p.relative_to(ROOT))) for p in files]
        strategy = 'Exact CI glob inventory, one isolated Node process per test file, maximum concurrency 2; direct invocation preserves underlying test case and skip summaries hidden by local Node aggregate --test output'
    elif gate == 'rpc-authorization':
        scope = 'database'
        commands = [(['npm', 'test', '--prefix', 'supabase/tests/rpc-authorization'], gate)]
        strategy = 'Unmodified package npm test script'
    else:
        raise SystemExit('Unknown gate '+gate)
    before = source_snapshot(scope)
    write_json(OUT / (gate+'.before-source.json'), before)
    start = now()
    env = os.environ.copy()
    explicit_env = {}
    if gate == 'supabase-node':
        base = ROOT/'supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite/dist'
        explicit_env = {'PGLITE_MODULE':str(base/'index.cjs'), 'TRINITI_PGLITE_MODULE':str(base/'index.js')}
        env.update(explicit_env)
    if len(commands) == 1:
        results = [execute(*commands[0], cwd=execution_cwd, env=env, timeout=1800 if gate == 'rpc-authorization' else 600)]
    else:
        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(execute, command, name, cwd=execution_cwd, env=env, timeout=300) for command, name in commands]
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                results.append(result)
                if result['exit_code'] != 0:
                    print(json.dumps({'gate':gate, 'failed_command':result['command'], 'exit_code':result['exit_code'], 'log_path':result['log_path']}), flush=True)
        results.sort(key=lambda row: row['command'][-1])
    after = source_snapshot(scope)
    write_json(OUT/(gate+'.after-source.json'), after)
    paths = sorted(set(before['files']) | set(after['files']))
    changed = [p for p in paths if before['files'].get(p) != after['files'].get(p)]
    counts = {k:0 for k in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']}
    no_case_summary = []
    for result in results:
        summaries = result['node_test_summaries'] + result['custom_summaries']
        for summary in summaries:
            for key in counts:
                counts[key] += summary.get(key, 0)
        if not summaries and not gate.startswith('tsc-'):
            no_case_summary.append(result['command'][-1])
    receipt = {'gate':gate, 'started_at':start, 'completed_at':now(), 'strategy':strategy,
               'node_version':subprocess.check_output([NODE, '--version'], text=True).strip(),
               'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
               'branch':subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),
               'explicit_environment':explicit_env,
               'processes':{'total':len(results), 'passed':sum(r['exit_code']==0 for r in results), 'failed':sum(r['exit_code']!=0 for r in results)},
               'reported_case_totals':counts if not gate.startswith('tsc-') else None,
               'processes_without_case_summary':no_case_summary,
               'before_source_sha256':before['sha256'], 'after_source_sha256':after['sha256'],
               'source_file_count':before['file_count'], 'source_changed_during_run':changed,
               'before_manifest':str(OUT/(gate+'.before-source.json')), 'after_manifest':str(OUT/(gate+'.after-source.json')),
               'results':results}
    write_json(OUT/(gate+'.json'), receipt)
    print(json.dumps({k:receipt[k] for k in ['gate','processes','reported_case_totals','processes_without_case_summary','source_changed_during_run']}), flush=True)
    return int(any(r['exit_code'] for r in results))

if __name__ == '__main__':
    sys.exit(main())
