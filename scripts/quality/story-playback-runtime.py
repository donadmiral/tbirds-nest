#!/usr/bin/env python3
"""Local TLS media and bounded simulator driver for the real StoryVideoView.

No hosted assets, credentials, app backend, simulated AVPlayer, or RN bridge are
used. The driver requires actual decoded-frame receipts from the native app.
"""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit


EXPECTED_CASES = {
    'cold native view displays only the requested trimmed frame',
    'warmed HTTPS handoff repeatedly reaches a real decoded frame',
    'two views of one warmed URL never share an AVPlayerItem',
    'rapid pending source switches cannot report an obsolete frame',
    'warm pool respects capacity capability expiry scope and explicit clear',
    'actual background foreground transition pauses playback and clears warm work',
    'teardown cancels pending loads without retaining native views',
    'unsupported and unavailable sources report errors without a process crash',
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def serve(args):
    video = args.video.read_bytes()
    lock = threading.Lock()

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *_args):
            pass

        def do_HEAD(self):
            self.respond(False)

        def do_GET(self):
            self.respond(True)

        def respond(self, body):
            path = urlsplit(self.path).path
            if path.startswith('/slow-'):
                time.sleep(0.4)
            start, end, status = 0, len(video) - 1, 200
            if not re.fullmatch(r'/[A-Za-z0-9-]+\.mp4', path) or path == '/missing.mp4':
                status = 404
            header = self.headers.get('Range')
            if status == 200 and header:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', header.strip())
                if not match or not any(match.groups()):
                    status = 416
                elif match.group(1):
                    start = int(match.group(1))
                    end = min(int(match.group(2)) if match.group(2) else end, end)
                    status = 206 if 0 <= start <= end < len(video) else 416
                else:
                    start = max(0, len(video) - int(match.group(2)))
                    status = 206 if start <= end else 416
            size = end - start + 1 if status in (200, 206) else 0
            with lock:
                with args.requests.open('a') as log:
                    log.write(json.dumps({'path': path, 'method': self.command, 'range': header,
                                          'status': status, 'bytes': size, 'at': time.time()}) + '\n')
            try:
                self.send_response(status)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(size))
                if status == 206:
                    self.send_header('Content-Range', f'bytes {start}-{end}/{len(video)}')
                elif status == 416:
                    self.send_header('Content-Range', f'bytes */{len(video)}')
                self.end_headers()
                if body and size:
                    self.wfile.write(video[start:end + 1])
            except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                pass  # A real cancelled AVURLAsset may close an in-flight request.

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(args.certificate, args.key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    args.ready.write_text(json.dumps({'origin': f'https://127.0.0.1:{server.server_port}'}))
    server.serve_forever(poll_interval=0.1)


def command(args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def run(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    started = time.time()
    result = {'schemaVersion': 1, 'passed': False, 'device': args.device,
              'scope': 'Actual UIKit/AVFoundation production player runtime with Expo host adapter; no RN bridge or physical-device claim',
              'startedAtUnix': started, 'expectedCases': len(EXPECTED_CASES), 'commands': []}
    container_result = command(['xcrun', 'simctl', 'get_app_container', args.device, args.bundle, 'data'])
    if container_result.returncode != 0:
        result['error'] = 'Unable to locate the installed fixture data container'
        result['containerError'] = container_result.stderr[-4000:]
        (output / 'driver-result.json').write_text(json.dumps(result, indent=2) + '\n')
        return 1
    documents = Path(container_result.stdout.strip()) / 'Documents'
    moved_to_background = False
    resumed = False
    process = None
    try:
        with (output / 'simulator.log').open('w') as log:
            launch = ['xcrun', 'simctl', 'launch', '--console', '--terminate-running-process', args.device, args.bundle]
            result['commands'].append({'stage': 'launch', 'command': launch})
            process = subprocess.Popen(launch, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 200
            while process.poll() is None and time.monotonic() < deadline:
                phase = read_json(documents / 'story-playback-phase.json') or {}
                if phase.get('phase') == 'background-ready' and not moved_to_background:
                    action = ['xcrun', 'simctl', 'launch', args.device, 'com.apple.mobilesafari']
                    change = command(action, timeout=20)
                    result['commands'].append({'stage': 'background', 'command': action, 'exitCode': change.returncode,
                                               'stderr': change.stderr[-2000:]})
                    if change.returncode != 0:
                        raise RuntimeError('Simulator could not background the fixture by opening Safari')
                    moved_to_background = True
                if phase.get('phase') == 'background-observed' and not resumed:
                    # Launch without termination: foreground the same native view,
                    # player, and process after actual UIKit lifecycle callbacks.
                    action = ['xcrun', 'simctl', 'launch', args.device, args.bundle]
                    change = command(action, timeout=20)
                    result['commands'].append({'stage': 'foreground', 'command': action, 'exitCode': change.returncode,
                                               'stderr': change.stderr[-2000:]})
                    if change.returncode != 0:
                        raise RuntimeError('Simulator could not resume the same fixture process')
                    resumed = True
                time.sleep(0.1)
            if process.poll() is None:
                result['timedOut'] = True
                command(['xcrun', 'simctl', 'terminate', args.device, args.bundle], timeout=15)
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            result['launchExitCode'] = process.returncode
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        result['error'] = str(error)
        if process and process.poll() is None:
            command(['xcrun', 'simctl', 'terminate', args.device, args.bundle], timeout=15)
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    finally:
        for name in ['story-playback-receipt.json', 'story-playback-phase.json', 'story-playback-uncaught-exception.json']:
            path = documents / name
            if path.is_file():
                shutil.copyfile(path, output / name)
        crash_dir = Path.home() / 'Library/Logs/DiagnosticReports'
        for pattern in ['StoryVideoPlaybackHarness*', 'StoryPlaybackApp*']:
            for path in crash_dir.glob(pattern):
                if path.is_file() and path.stat().st_mtime >= started - 1:
                    (output / 'crashes').mkdir(exist_ok=True)
                    shutil.copyfile(path, output / 'crashes' / path.name)
    receipt = read_json(output / 'story-playback-receipt.json') or {}
    cases = receipt.get('cases', [])
    if not isinstance(cases, list) or not all(isinstance(case, dict) for case in cases):
        cases = []
        result['error'] = 'Native case receipt is malformed'
    names = [case.get('name') for case in cases if isinstance(case, dict)]
    requests = []
    if args.requests.is_file():
        requests = [json.loads(line) for line in args.requests.read_text().splitlines() if line.strip()]
    successful = [row for row in requests if row['status'] in (200, 206) and row['method'] == 'GET']
    result.update({'finishedAtUnix': time.time(), 'runtimeSeconds': time.time() - started,
                   'completedCases': len(cases), 'passedCases': sum(case.get('passed') is True for case in cases),
                   'actualOSBackground': moved_to_background, 'resumedSameProcess': resumed,
                   'httpsGetCount': len(successful), 'httpsRangeCount': sum(row['status'] == 206 for row in successful),
                   'lastNativeStage': receipt.get('stage'), 'nativeError': receipt.get('error')})
    result['passed'] = (receipt.get('passed') is True and len(cases) == len(EXPECTED_CASES)
                        and len(names) == len(set(names)) and set(names) == EXPECTED_CASES
                        and all(case.get('passed') is True for case in cases)
                        and moved_to_background and resumed and bool(successful)
                        and not result.get('error') and not result.get('timedOut'))
    # The shell stops the server and unified-log stream after this driver exits;
    # these ongoing logs are retained, but are not claimed to be final hashes.
    ongoing = {'driver-result.json', 'https-server.log', 'https-requests.jsonl', 'native-system.log'}
    result['evidenceHashes'] = {str(path.relative_to(output)): digest(path) for path in output.rglob('*')
                                if path.is_file() and path.name not in ongoing}
    (output / 'driver-result.json').write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    print(json.dumps({key: result[key] for key in ['passed', 'completedCases', 'passedCases', 'lastNativeStage', 'runtimeSeconds']}))
    return 0 if result['passed'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    server = sub.add_parser('serve')
    for name in ['video', 'certificate', 'key', 'ready', 'requests']:
        server.add_argument('--' + name, type=Path, required=True)
    runner = sub.add_parser('run')
    runner.add_argument('--device', required=True)
    runner.add_argument('--bundle', required=True)
    runner.add_argument('--output', type=Path, required=True)
    runner.add_argument('--requests', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'serve':
        serve(args)
        return 0
    if sys.platform != 'darwin' or os.environ.get('CI') != 'true':
        parser.error('Use the native driver only on a disposable macOS CI runner')
    return run(args)


if __name__ == '__main__':
    sys.exit(main())
