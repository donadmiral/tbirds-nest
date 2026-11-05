#!/usr/bin/env python3
"""Local HLS TLS server and real iOS compositor/Metal runtime driver."""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
import zlib

EXPECTED_CASES = {
    'HLS trim gate and paused grade update display verified pixels',
    'paused and inactive HLS surfaces stop scheduling work',
    'production StoryVideoView switches graded and neutral HLS without duplicate outputs',
    'surface reset and seek discard obsolete pending graded frames',
    'actual OS background and foreground preserve graded HLS ownership',
    'stopped HLS surfaces detach outputs and cancel late callbacks',
    'invalid grade fails once and releases its HLS output',
    'frozen HLS output fails within five seconds despite repeated backward seeks',
}
EXPECTED_PIXELS = {'trim-green': 'green', 'paused-blue': 'blue', 'paused-red': 'red',
                   'inactive-resume-red': 'red', 'foreground-green': 'green', 'wrapper-green': 'green',
                   'wrapper-blue': 'blue', 'wrapper-red': 'red', 'reset-green': 'green'}


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def command(args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def png_center(path):
    """Decode simulator PNG directly, then sample its center 10% in sRGB bytes."""
    data = Path(path).read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Screenshot is not PNG')
    offset, packed, header = 8, bytearray(), None
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        kind, payload = data[offset + 4:offset + 8], data[offset + 8:offset + 8 + size]
        if kind == b'IHDR':
            header = struct.unpack('>IIBBBBB', payload)
        elif kind == b'IDAT':
            packed.extend(payload)
        offset += size + 12
    if not header:
        raise ValueError('PNG has no IHDR')
    width, height, depth, color, compression, filtering, interlace = header
    if depth != 8 or color not in (2, 6) or compression or filtering or interlace:
        raise ValueError('Unexpected screenshot PNG layout')
    channels = 4 if color == 6 else 3
    stride, raw, rows = width * channels, zlib.decompress(packed), []
    if len(raw) != height * (stride + 1):
        raise ValueError('PNG decompressed size differs')
    previous = bytearray(stride)
    for y in range(height):
        row_at = y * (stride + 1)
        filter_type, row = raw[row_at], bytearray(raw[row_at + 1:row_at + 1 + stride])
        for x in range(stride):
            a, b, c = (row[x - channels] if x >= channels else 0), previous[x], (previous[x - channels] if x >= channels else 0)
            if filter_type == 1:
                row[x] = (row[x] + a) & 255
            elif filter_type == 2:
                row[x] = (row[x] + b) & 255
            elif filter_type == 3:
                row[x] = (row[x] + ((a + b) // 2)) & 255
            elif filter_type == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predictor = a if pa <= pb and pa <= pc else b if pb <= pc else c
                row[x] = (row[x] + predictor) & 255
            elif filter_type != 0:
                raise ValueError('Unknown PNG filter')
        rows.append(row)
        previous = row
    def mean_region(left, top, right, bottom):
        samples = [[rows[y][x * channels + c] for c in range(3)]
                   for y in range(max(0, int(top)), min(height, int(bottom)), 3)
                   for x in range(max(0, int(left)), min(width, int(right)), 3)]
        if not samples:
            raise ValueError('No screenshot samples')
        return [round(sum(p[c] for p in samples) / len(samples), 2) for c in range(3)], len(samples)

    center, count = mean_region(width * .45, height * .45, width * .55, height * .55)
    # The real view uses contain on a deterministic 320x240 video. The marker
    # occupies source (0,0)-(40,40). Sample well inside it and the diagonally
    # opposite colored patch, never in letterboxing or on compression edges.
    video_width = min(width, height * 4 / 3)
    video_height = video_width * 3 / 4
    left, top = (width - video_width) / 2, (height - video_height) / 2
    def source_patch(x, y):
        return mean_region(left + x * video_width / 320, top + y * video_height / 240,
                           left + (x + 20) * video_width / 320, top + (y + 20) * video_height / 240)[0]
    return {'width': width, 'height': height, 'centerMeanRGB': center, 'sampleCount': count,
            'topLeftMarkerMeanRGB': source_patch(10, 10),
            'bottomRightMeanRGB': source_patch(290, 210)}


def matches_color(measurement, name):
    channels = measurement['centerMeanRGB']
    expected = {'red': 0, 'green': 1, 'blue': 2}[name]
    return channels[expected] > 150 and all(channels[i] < 70 for i in range(3) if i != expected)


def matches_orientation(measurement, name):
    return max(measurement['topLeftMarkerMeanRGB']) < 45 and matches_color(
        {'centerMeanRGB': measurement['bottomRightMeanRGB']}, name)


def serve(args):
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
            name = urlsplit(self.path).path.removeprefix('/')
            allowed = name == 'fixture.m3u8' or bool(re.fullmatch(r'segment-\d{3}\.ts', name))
            path = args.media / name if allowed else None
            data = path.read_bytes() if path and path.is_file() else b''
            status, start, end = (200 if data else 404), 0, len(data) - 1
            header = self.headers.get('Range')
            if status == 200 and header:
                match = re.fullmatch(r'bytes=(\d+)-(\d*)', header.strip())
                if match:
                    start = int(match.group(1)); end = min(int(match.group(2)) if match.group(2) else end, end)
                status = 206 if match and 0 <= start <= end < len(data) else 416
            size = end - start + 1 if status in (200, 206) else 0
            with lock, args.requests.open('a') as log:
                log.write(json.dumps({'path': '/' + name, 'method': self.command, 'range': header,
                                      'status': status, 'bytes': size, 'at': time.time()}) + '\n')
            try:
                self.send_response(status)
                self.send_header('Content-Type', 'application/vnd.apple.mpegurl' if name.endswith('.m3u8') else 'video/mp2t')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Length', str(size))
                if status == 206:
                    self.send_header('Content-Range', f'bytes {start}-{end}/{len(data)}')
                self.end_headers()
                if body and size:
                    self.wfile.write(data[start:end + 1])
            except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(args.certificate, args.key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    args.ready.write_text(json.dumps({'origin': f'https://127.0.0.1:{server.server_port}'}))
    server.serve_forever(poll_interval=0.1)


def run(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    started = time.time()
    result = {'schemaVersion': 1, 'passed': False, 'device': args.device, 'startedAtUnix': started,
              'scope': 'Real simulator UIKit/AVFoundation HLS/Metal rendering and compositor pixels, not physical-device verification',
              'commands': [], 'pixels': {}}
    located = command(['xcrun', 'simctl', 'get_app_container', args.device, args.bundle, 'data'])
    process = None
    documents = Path(located.stdout.strip()) / 'Documents' if located.returncode == 0 else None
    background, resumed = False, False
    try:
        if documents is None:
            raise RuntimeError('Could not locate fixture data container: ' + located.stderr[-1000:])
        with (output / 'simulator.log').open('w') as log:
            process = subprocess.Popen(['xcrun', 'simctl', 'launch', '--console', '--terminate-running-process', args.device, args.bundle], stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 180
            while process.poll() is None and time.monotonic() < deadline:
                phase = read_json(documents / 'story-hls-grade-phase.json') or {}
                name = phase.get('phase')
                if name in EXPECTED_PIXELS and name not in result['pixels']:
                    if phase.get('color') != EXPECTED_PIXELS[name]:
                        raise RuntimeError('Native screenshot expected color differs from independent driver')
                    screenshot = output / (name + '.png')
                    pixel_deadline = time.monotonic() + 8
                    measurement, passed = {}, False
                    while time.monotonic() < pixel_deadline:
                        shot = command(['xcrun', 'simctl', 'io', args.device, 'screenshot', '--type=png', str(screenshot)], timeout=15)
                        if shot.returncode != 0:
                            raise RuntimeError('Compositor screenshot failed: ' + shot.stderr[-1000:])
                        measurement = png_center(screenshot)
                        passed = (matches_color(measurement, EXPECTED_PIXELS[name])
                                  and matches_orientation(measurement, EXPECTED_PIXELS[name]))
                        if passed:
                            break
                        time.sleep(0.15)
                    result['pixels'][name] = {**measurement, 'passed': passed, 'expected': EXPECTED_PIXELS[name]}
                    ack = documents / 'story-hls-grade-ack.json'
                    temporary = ack.with_suffix('.tmp')
                    temporary.write_text(json.dumps({'phase': name, 'passed': passed}))
                    temporary.replace(ack)
                if name == 'background-ready' and not background:
                    action = ['xcrun', 'simctl', 'launch', args.device, 'com.apple.mobilesafari']
                    change = command(action, timeout=20)
                    result['commands'].append({'stage': 'background', 'exitCode': change.returncode})
                    if change.returncode:
                        raise RuntimeError('Could not background fixture')
                    background = True
                if name == 'background-observed' and not resumed:
                    change = command(['xcrun', 'simctl', 'launch', args.device, args.bundle], timeout=20)
                    result['commands'].append({'stage': 'foreground', 'exitCode': change.returncode})
                    if change.returncode:
                        raise RuntimeError('Could not foreground same fixture process')
                    resumed = True
                time.sleep(0.1)
            if process.poll() is None:
                result['timedOut'] = True
                raise RuntimeError('HLS runtime exceeded bounded deadline')
            result['launchExitCode'] = process.returncode
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        result['error'] = str(error)
    finally:
        if process and process.poll() is None:
            command(['xcrun', 'simctl', 'terminate', args.device, args.bundle], timeout=15)
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
        if documents:
            for path in documents.glob('story-hls-grade-*.json'):
                shutil.copyfile(path, output / path.name)
        for path in (Path.home() / 'Library/Logs/DiagnosticReports').glob('StoryHLSGrade*'):
            if path.is_file() and path.stat().st_mtime >= started - 1:
                (output / 'crashes').mkdir(exist_ok=True)
                shutil.copyfile(path, output / 'crashes' / path.name)
    receipt = read_json(output / 'story-hls-grade-receipt.json') or {}
    cases = receipt.get('cases', [])
    names = [case.get('name') for case in cases if isinstance(case, dict)]
    requests = [json.loads(line) for line in args.requests.read_text().splitlines() if line.strip()] if args.requests.is_file() else []
    successful = [r for r in requests if r['method'] == 'GET' and r['status'] in (200, 206)]
    manifests = sum(r['path'] == '/fixture.m3u8' for r in successful)
    segments = sum(r['path'].endswith('.ts') for r in successful)
    result.update({'runtimeSeconds': time.time() - started, 'completedCases': len(cases),
                   'passedCases': sum(case.get('passed') is True for case in cases),
                   'actualOSBackground': background, 'resumedSameProcess': resumed,
                   'manifestGETs': manifests, 'segmentGETs': segments, 'nativeError': receipt.get('error')})
    result['passed'] = (receipt.get('passed') is True and set(names) == EXPECTED_CASES and len(names) == len(EXPECTED_CASES)
                        and all(case.get('passed') is True for case in cases) and background and resumed
                        and manifests > 0 and segments > 0 and set(result['pixels']) == set(EXPECTED_PIXELS)
                        and all(p['passed'] for p in result['pixels'].values()) and not result.get('error'))
    ongoing = {'driver-result.json', 'https-server.log', 'https-requests.jsonl', 'native-system.log'}
    result['evidenceHashes'] = {str(path.relative_to(output)): hashlib.sha256(path.read_bytes()).hexdigest()
                               for path in output.rglob('*') if path.is_file() and path.name not in ongoing}
    (output / 'driver-result.json').write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    print(json.dumps({key: result[key] for key in ['passed', 'completedCases', 'passedCases', 'runtimeSeconds']}))
    return 0 if result['passed'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    server = sub.add_parser('serve')
    for name in ['media', 'certificate', 'key', 'ready', 'requests']:
        server.add_argument('--' + name, type=Path, required=True)
    runner = sub.add_parser('run')
    runner.add_argument('--device', required=True)
    runner.add_argument('--bundle', required=True)
    runner.add_argument('--output', type=Path, required=True)
    runner.add_argument('--requests', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'serve':
        serve(args); return 0
    if sys.platform != 'darwin' or os.environ.get('CI') != 'true':
        parser.error('Run only on a disposable macOS CI runner')
    return run(args)


if __name__ == '__main__':
    sys.exit(main())
