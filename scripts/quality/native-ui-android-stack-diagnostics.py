#!/usr/bin/env python3
"""One failure-only Java stack request for the existing synthetic QA emulator."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time

PACKAGE = 'app.platinumcircles.mobile.qa'
DEVICE = 'emulator-5556'
HELPER = 'scripts/quality/native-ui-android-stack-diagnostics.py'
OUTPUT = Path('native-ui-logs/android-failure-stacks.json')
TOTAL_SECONDS = 12.0
COMMAND_SECONDS = 2.0
DUMP_SECONDS = 8.0
MAX_DUMP_BYTES = 512 * 1024
MAX_STDERR_BYTES = 4096
MAX_FRAMES = 64
THREAD_NAMES = {'main', 'mqt_js', 'mqt_native_modules', 'mqt_v_native', 'mqt_v_js', 'RenderThread'}


class Unavailable(Exception):
    pass


def command(argv, seconds, maximum):
    """Bound time and pipe bytes. Raw stderr is never retained."""
    started = time.monotonic()
    process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE)
    selector = selectors.DefaultSelector()
    output = {'stdout': b'', 'stderrBytes': 0, 'timedOut': False, 'limitHit': False}
    try:
        selector.register(process.stdout, selectors.EVENT_READ, 'stdout')
        selector.register(process.stderr, selectors.EVENT_READ, 'stderr')
        while selector.get_map():
            remaining = seconds - (time.monotonic() - started)
            if remaining <= 0:
                output['timedOut'] = True
                break
            for key, _ in selector.select(min(remaining, 0.05)):
                name = key.data
                used = len(output['stdout']) if name == 'stdout' else output['stderrBytes']
                limit = maximum if name == 'stdout' else MAX_STDERR_BYTES
                chunk = os.read(key.fileobj.fileno(), min(8192, limit + 1 - used))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                if name == 'stdout':
                    output['stdout'] += chunk[:max(0, maximum - used)]
                else:
                    output['stderrBytes'] += min(len(chunk), max(0, MAX_STDERR_BYTES - used))
                if used + len(chunk) > limit:
                    output['limitHit'] = True
                    break
            if output['limitHit']:
                break
        if process.poll() is None and not (output['timedOut'] or output['limitHit']):
            try:
                process.wait(timeout=max(0.001, seconds - (time.monotonic() - started)))
            except subprocess.TimeoutExpired:
                output['timedOut'] = True
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
        process.wait(timeout=0.5)
        process.stdout.close()
        process.stderr.close()
    output.update(exitCode=process.returncode,
                  elapsedMs=round((time.monotonic() - started) * 1000, 3))
    return output


def read_json(path):
    with path.open('rb') as stream:
        data = stream.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise Unavailable('receipt-too-large')
    return json.loads(data)


def context(args):
    if (sys.platform != 'linux' or os.environ.get('CI') != 'true'
            or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_URL') != 'https://uaulhuelcfkjwojtymmw.supabase.co'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key'
            or args.device != DEVICE or os.environ.get('ANDROID_SERIAL') != DEVICE
            or not 1 <= args.flow_exit <= 255 or not os.path.isabs(args.adb)):
        raise Unavailable('requires-failed-disposable-qa-flow')
    source, run = os.environ.get('GITHUB_SHA', ''), os.environ.get('GITHUB_RUN_ID', '')
    if not re.fullmatch(r'[0-9a-f]{40}', source) or not re.fullmatch(r'[1-9][0-9]{0,19}', run):
        raise Unavailable('invalid-run-identity')
    manifest = read_json(Path('native-ui-logs/source.json'))
    digest = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if (manifest.get('commit') != source or str(manifest.get('workflowRun')) != run
            or manifest.get('hashes', {}).get(HELPER) != digest):
        raise Unavailable('source-receipt-mismatch')
    flows = read_json(Path('native-ui-logs/flow-results.json')).get('flows')
    if (not isinstance(flows, list) or len(flows) != 2
            or [item.get('name') for item in flows] != ['navigation', 'memory-capture']
            or any(item.get('attempts') != 1 or type(item.get('exitCode')) is not int
                   or not 0 <= item['exitCode'] <= 255 for item in flows)):
        raise Unavailable('both-required-flows-must-have-finished')
    return {'source': source, 'workflowRun': run, 'helperSha256': digest,
            'flows': [{key: item[key] for key in ('name', 'attempts', 'exitCode')} for item in flows]}


def selected_threads(data, pid):
    text = data.decode('utf8', errors='replace')
    if (not re.search(r'^----- pid ' + str(pid) + r' at [^\r\n]{1,64} -----$', text, re.M)
            or re.findall(r'^Cmd line: ([^\r\n]*)$', text, re.M) != [PACKAGE]):
        raise Unavailable('dump-process-identity-mismatch')
    threads, current = [], None
    for line in text.splitlines():
        if line.startswith('"'):
            current = None
            header = re.fullmatch(r'"([^"]{1,80})"[^\r\n]{0,120}\btid=([0-9]{1,8}) ([A-Za-z]{1,40})', line)
            if header and header[1] in THREAD_NAMES and len(threads) < len(THREAD_NAMES):
                current = {'name': header[1], 'threadId': int(header[2]),
                           'state': header[3], 'frames': [], 'truncated': False}
                threads.append(current)
            continue
        if current is None or len(line) > 1024:
            continue
        tid = re.search(r'\bsysTid=([0-9]{1,10})\b', line)
        if line.startswith('  |') and tid:
            current['systemThreadId'] = int(tid[1])
        frame = None
        if re.fullmatch(r'\s+at [A-Za-z0-9_.$/-]+\((?:[A-Za-z0-9_.$-]+(?::[0-9]+)?|Native method|Unknown Source)\)', line):
            frame = line.strip()
        elif re.fullmatch(r'\s+- (?:waiting to lock|locked|waiting on|sleeping on) <0x[0-9a-f]+> \(a [A-Za-z0-9_.$]+\)(?: held by thread [0-9]+)?', line):
            frame = line.strip()
        else:
            native = re.fullmatch(r'\s+native: #([0-9]+) pc ([0-9a-f]+) (\S+)(?: \(([A-Za-z0-9_:.<>+*/&=,()\[\] $~-]{1,500})\))?', line)
            if native:
                module = Path(native[3]).name
                symbol = native[4] or ''
                if (re.fullmatch(r'(?:lib[A-Za-z0-9_.+-]{1,90}\.so|base\.apk|\[vdso\])', module)
                        and not re.search(r'://|(?:token|authorization|bearer|password|cookie)[ =]', symbol, re.I)):
                    frame = {'nativeFrame': int(native[1]), 'pc': native[2],
                             'module': module, 'symbol': native[4]}
        if frame is not None:
            if len(current['frames']) < MAX_FRAMES:
                current['frames'].append(frame)
            else:
                current['truncated'] = True
    if not any(item['name'] == 'main' and item.get('systemThreadId') == pid and item['frames'] for item in threads):
        raise Unavailable('main-thread-stack-unavailable')
    return threads


def collect(args, receipt, deadline):
    def adb(arguments, maximum=4096, seconds=COMMAND_SECONDS):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise Unavailable('collector-deadline')
        result = command([args.adb, '-s', DEVICE, 'exec-out', *arguments],
                         min(seconds, remaining), maximum)
        receipt['commands'].append({key: value for key, value in result.items() if key != 'stdout'})
        return result

    def required(result):
        if result['timedOut']:
            raise Unavailable('identity-command-timeout')
        if result['limitHit'] or result['exitCode'] != 0:
            raise Unavailable('identity-command-failed')
        return result['stdout']

    properties = required(adb(['/system/bin/sh', '-c',
        '/system/bin/id -u; /system/bin/getprop ro.kernel.qemu; '
        '/system/bin/getprop ro.build.version.sdk; /system/bin/getprop ro.product.cpu.abi'], 128))
    if properties.replace(b'\r', b'').splitlines() != [b'0', b'1', b'35', b'x86_64']:
        raise Unavailable('unexpected-emulator-or-root-identity')
    pid_bytes = required(adb(['/system/bin/pidof', PACKAGE], 64)).strip()
    if not re.fullmatch(rb'[1-9][0-9]{0,9}', pid_bytes) or int(pid_bytes) >= 2**31:
        raise Unavailable('missing-or-ambiguous-qa-process')
    pid = int(pid_bytes)
    identity = required(adb(['/system/bin/cat', f'/proc/{pid}/cmdline', f'/proc/{pid}/stat']))
    expected = PACKAGE.encode() + b'\0'
    if not identity.startswith(expected):
        raise Unavailable('qa-process-command-mismatch')
    process = identity[len(expected):].decode('ascii')
    stat = re.fullmatch(str(pid) + r' \([A-Za-z0-9_.:-]+\) ([^\r\n]+)\s*', process)
    fields = stat[1].split() if stat else []
    if (len(fields) < 20 or fields[0] in ('Z', 'X', 'x')
            or not fields[19].isdigit() or int(fields[19]) <= 0):
        raise Unavailable('invalid-qa-process-start-identity')
    start = fields[19]
    receipt['process'] = {'pid': pid, 'startTicks': start, 'package': PACKAGE}
    # Recheck the exact process immediately before the single Java-stack request.
    # AOSP debuggerd -j uses the Java trace transport, not a full tombstone.
    # https://android.googlesource.com/platform/system/core/+/master/debuggerd/debuggerd.cpp
    script = (f'test "$(/system/bin/cat /proc/{pid}/cmdline | /system/bin/tr -d \'\\000\')" = {PACKAGE} || exit 42\n'
              f'test "$(/system/bin/awk \'{{print $22}}\' /proc/{pid}/stat)" = {start} || exit 43\n'
              f'exec /system/bin/timeout -k 1 6 /system/bin/debuggerd -j {pid}')
    receipt['dumpRequestedAtUnixMs'] = int(time.time() * 1000)
    dump = adb(['/system/bin/sh', '-c', script], MAX_DUMP_BYTES, DUMP_SECONDS)
    receipt.update(dumpBytes=len(dump['stdout']),
                   dumpSha256=hashlib.sha256(dump['stdout']).hexdigest())
    if dump['exitCode'] in (42, 43):
        raise Unavailable('qa-process-changed-before-dump')
    try:
        receipt['threads'] = selected_threads(dump['stdout'], pid)
    except Unavailable:
        if dump['timedOut'] or dump['exitCode'] in (124, 137):
            raise Unavailable('java-dump-timeout') from None
        if dump['limitHit']:
            raise Unavailable('java-dump-byte-limit') from None
        if dump['exitCode'] != 0:
            raise Unavailable('java-dump-command-failed') from None
        raise
    receipt['status'] = 'partial' if dump['timedOut'] or dump['limitHit'] or dump['exitCode'] != 0 else 'available'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', required=True)
    parser.add_argument('--device', required=True)
    parser.add_argument('--flow-exit', required=True, type=int)
    args = parser.parse_args(argv)
    began = time.monotonic()
    try:
        identity = context(args)
    except (Unavailable, OSError, ValueError, TypeError, AttributeError):
        print('Android stack diagnostic unavailable: failed synthetic QA context required.', file=sys.stderr)
        return 2
    receipt = {'schemaVersion': 1, 'mode': 'failure-only-android-java-stacks', **identity,
               'flowExitCode': args.flow_exit, 'status': 'unavailable', 'commands': [],
               'startedAtUnixMs': int(time.time() * 1000),
               'limits': {'totalSeconds': TOTAL_SECONDS, 'identityCommandSeconds': COMMAND_SECONDS,
                          'dumpHostSeconds': DUMP_SECONDS, 'dumpDeviceSeconds': 6,
                          'dumpDeviceKillGraceSeconds': 1, 'dumpBytes': MAX_DUMP_BYTES,
                          'stderrBytes': MAX_STDERR_BYTES, 'threads': len(THREAD_NAMES), 'framesPerThread': MAX_FRAMES},
               'meaning': 'Post-failure diagnostic only. Both required flows already finished. The original gate result stays authoritative. The Java stack request can briefly suspend the failed app. No heap, input values, environment, raw stderr or unrelated process trace is retained.'}
    try:
        collect(args, receipt, began + TOTAL_SECONDS)
    except Unavailable as error:
        receipt['reason'] = str(error)
    except (OSError, ValueError, TypeError, UnicodeError, subprocess.SubprocessError):
        receipt['reason'] = 'diagnostic-tool-or-input-unavailable'
    receipt['elapsedMs'] = round((time.monotonic() - began) * 1000, 3)
    try:
        with OUTPUT.open('x') as stream:
            json.dump(receipt, stream, indent=2)
            stream.write('\n')
    except OSError:
        print('Android stack receipt unavailable. Original flow result is unchanged.', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
