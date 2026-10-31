#!/usr/bin/env python3
"""Independently decode the movie produced by the actual RN capture/export UI.

No encoder mocks, golden movie, provider requests, or external Python packages.
The full-app test retains its PNG captures and returned MP4 before the real UI
closes and proves that its temporary files have been removed.
"""
import array
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'native-ui-logs/memory-capture')
receipt = json.loads((root / 'receipt.json').read_text())
assert receipt['version'] == 1 and receipt['mode'] == 'full-production-memory-capture'
assert receipt['networkForwarded'] is False and receipt['nativeMemoryVersion'] == 1
assert len(receipt['attempts']) == 2, 'Require one real cancelled attempt and one complete retry'
cancelled, complete = receipt['attempts']
assert cancelled['status'] == 'cancelled', cancelled
assert not cancelled.get('movie') and cancelled['cleanup']['passed'] is True
assert any(event['phase'] == 'chunk' and event['bytes'] > 0 for event in cancelled['media'])
assert any(event['phase'] == 'cancelled' for event in cancelled['media']), 'Cancellation must close its actual file reader'
assert complete['status'] == 'ready' and complete['cleanup']['passed'] is True
assert not complete['baseline'] and not cancelled['baseline']
assert complete['movie']['memories'] == 3
assert complete['movie']['width'] == 720 and complete['movie']['height'] == 1280

def verified(item):
    name = item['file']
    assert Path(name).name == name, 'Evidence filenames must remain inside their retained directory'
    file = root / name
    data = file.read_bytes()
    assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], name
    return file

movie = verified(complete['movie'])
captures = complete['captures']
for capture in captures:
    data = verified(capture).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', data[16:24]) == (720, 1280), capture
assert len(captures) == 12, 'Five backgrounds and seven bounded artwork captures must be retained'
scenes = [capture for capture in captures if capture['layer'] == 'background']
assert len(scenes) == 5
assert [scene['card'] for scene in scenes] == ['opening', None, None, None, 'closing']
assert [scene['kind'] for scene in scenes] == ['text', 'image', 'video', 'text', 'text']
expected_duration = sum(scene['duration'] for scene in scenes)
assert abs(expected_duration - 11.7) < .01, expected_duration

def run(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)

def display_size(video):
    """Accept only a square-pixel, right-angle presentation transform."""
    coded = (video['width'], video['height'])
    assert all(type(value) is int and value > 0 for value in coded), coded
    assert video.get('sample_aspect_ratio', '1:1') in ('1:1', 'N/A'), video
    matrices = [item for item in video.get('side_data_list', [])
        if item.get('side_data_type') == 'Display Matrix']
    assert len(matrices) <= 1, 'Ambiguous video display transforms'
    rotation = 0
    if matrices:
        matrix = matrices[0]
        angle = matrix.get('rotation')
        assert type(angle) in (int, float) and math.isfinite(angle) and angle % 90 == 0, matrix
        rotation = int(angle) % 360
        rows = [line.partition(':')[2].split() for line in matrix.get('displaymatrix', '').splitlines() if ':' in line]
        assert len(rows) == 3 and all(len(row) == 3 for row in rows), matrix
        values = tuple(int(value) for row in rows for value in row)
        transforms = {
            0: (65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824),
            90: (0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824),
            180: (-65536, 0, 0, 0, -65536, 0, 0, 0, 1073741824),
            270: (0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824),
        }
        assert values == transforms[rotation], 'Reject scaling, mirroring, shear or translation in the display matrix'
    assert 'rotate' not in video.get('tags', {}), 'Require FFprobe to expose rotation as a verified display matrix'
    return (coded[::-1] if rotation in (90, 270) else coded), rotation

def verify_display_geometry(video, file):
    presented, rotation = display_size(video)
    assert presented == (720, 1280), (video, presented)
    # No scale filter: the actual decoder must produce the promised portrait
    # canvas after applying the container's standard presentation transform.
    png = run(['ffmpeg', '-v', 'error', '-i', str(file), '-frames:v', '1',
        '-c:v', 'png', '-f', 'image2pipe', '-'])
    assert png[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>II', png[16:24]) == presented
    return {'codedWidth': video['width'], 'codedHeight': video['height'],
        'rotationDegrees': rotation, 'decodedWidth': presented[0], 'decodedHeight': presented[1]}

def verify_cadence(times, expected_duration):
    assert len(times) >= int(expected_duration * 27), 'The actual movie must contain a continuous frame sequence'
    assert all(math.isfinite(time) for time in times) and all(b > a for a, b in zip(times, times[1:])), 'Video frame timestamps must advance'
    assert max(b - a for a, b in zip(times, times[1:])) < .10, 'The actual movie has a frame gap of at least 100 ms'
    assert times[-1] > expected_duration - .15

probe = json.loads(run(['ffprobe', '-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,width,height,avg_frame_rate,sample_aspect_ratio,channels:stream_tags=rotate:stream_side_data',
    '-of', 'json', str(movie)]))
video = next(stream for stream in probe['streams'] if stream['codec_type'] == 'video')
geometry = verify_display_geometry(video, movie)
assert any(stream['codec_type'] == 'audio' for stream in probe['streams'])
duration = float(probe['format']['duration'])
assert abs(duration - expected_duration) < .20, (duration, expected_duration)
frames = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(movie)]))['frames']
times = [float(frame['best_effort_timestamp_time']) for frame in frames]
verify_cadence(times, expected_duration)

def pixels(file, time=None):
    args = ['ffmpeg', '-v', 'error']
    if time is not None:
        args += ['-ss', str(time)]
    data = run(args + ['-i', str(file), '-frames:v', '1', '-vf', 'scale=180:320',
        '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
    assert len(data) == 180 * 320 * 3, (file, time, len(data))
    return data

def pixel(data, x, y):
    offset = (int(y * 320) * 180 + int(x * 180)) * 3
    return list(data[offset:offset + 3])

def bright_count(data):
    return sum(all(channel > 180 for channel in data[index:index + 3])
        for index in range(0, len(data), 3))

def green_count(data):
    return sum(data[index] < 50 and data[index + 1] > 180 and data[index + 2] < 50
        for index in range(0, len(data), 3))

measurements = {'duration': duration, 'expectedDuration': expected_duration,
    'geometry': geometry,
    'decodedFrames': len(times), 'maximumFrameGap': max(b - a for a, b in zip(times, times[1:])),
    'captures': len(captures), 'scenes': []}
clock = 0
for scene in scenes:
    midpoint = clock + scene['duration'] / 2
    actual = pixels(movie, midpoint)
    entry = {'page': scene['page'], 'kind': scene['kind'], 'card': scene['card'], 'time': midpoint}
    if scene['kind'] == 'text':
        captured = pixels(root / scene['file'])
        original_bright, encoded_bright = bright_count(captured), bright_count(actual)
        assert original_bright > 100 and encoded_bright >= original_bright * .65, (entry, original_bright, encoded_bright)
        error = sum(abs(a - b) for a, b in zip(captured, actual)) / len(actual)
        assert error < 12, (entry, error)
        entry.update(capturedWritingPixels=original_bright, encodedWritingPixels=encoded_bright, meanPixelError=error)
    elif scene['kind'] == 'image':
        captured = pixels(root / scene['file'])
        swatches = []
        # Sample quadrant interiors. The automatic photo movement deliberately
        # shifts the exact central boundary while preserving each quadrant.
        for x, y in [(.25, .25), (.75, .25), (.25, .75), (.75, .75)]:
            expected, observed = pixel(captured, x, y), pixel(actual, x, y)
            assert max(abs(a - b) for a, b in zip(expected, observed)) < 25, (entry, expected, observed)
            swatches.append({'expected': expected, 'observed': observed})
        before, during, after = [green_count(pixels(movie, clock + second)) for second in [.5, 1.5, 2.5]]
        assert before < 20 and during > 100 and after < 20, (before, during, after)
        entry.update(photoSwatches=swatches, timedArtworkPixels=[before, during, after])
    else:
        # The fixture video has red/blue halves. Its saved brightness edit is
        # independently compared with the source's ungraded decoded pixels.
        source = pixels(Path('tests/native/assets/memory-capture-video.mp4'), .5 + scene['duration'] / 2)
        swatches = []
        for x in [.25, .75]:
            ungraded, observed = pixel(source, x, .5), pixel(actual, x, .5)
            strongest = max(range(3), key=lambda index: ungraded[index])
            assert observed[strongest] > 80 and observed[strongest] < ungraded[strongest] - 10, (ungraded, observed)
            assert all(observed[index] < 25 for index in range(3) if index != strongest), observed
            swatches.append({'ungraded': ungraded, 'observed': observed})
        entry['gradedVideoSwatches'] = swatches
    measurements['scenes'].append(entry)
    clock += scene['duration']

def audio(file, start, channel=0):
    assert type(channel) is int and channel in (0, 1), channel
    raw = run(['ffmpeg', '-v', 'error', '-i', str(file), '-af',
        f'pan=mono|c0=c{channel},aresample=48000,atrim=start_sample={round(start * 48000)}:end_sample={round(start * 48000) + 19200},asetpts=PTS-STARTPTS',
        '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'])
    assert len(raw) == 19200 * 4, 'Require a complete independently decoded audio window'
    values = array.array('f'); values.frombytes(raw)
    if sys.byteorder != 'little': values.byteswap()
    amplitude = 2 * abs(sum(value * complex(math.cos(2 * math.pi * 1234 * index / 48000),
        math.sin(2 * math.pi * 1234 * index / 48000)) for index, value in enumerate(values))) / len(values)
    return {'rms': math.sqrt(sum(value * value for value in values) / len(values)), 'sourceTone': amplitude}

def verify_audio_mix(file, channels):
    assert type(channels) is int and channels in (1, 2), 'Require independently measurable mono or stereo output'
    source = audio(Path('tests/native/assets/memory-capture-video.mp4'), .8)
    assert .18 < source['sourceTone'] < .22, 'The source fixture must retain its independently measured original tone'
    output = []
    for channel in range(channels):
        before, during, after = audio(file, 3, channel), audio(file, 5.9, channel), audio(file, 8, channel)
        assert before['rms'] > .001 and after['rms'] > .001, 'The packaged original score must reach every movie channel'
        assert before['sourceTone'] < .004 and after['sourceTone'] < .004
        # Compare corresponding channels. FFmpeg's default stereo-to-mono mix
        # adds correlated channels with sqrt(1/2) gain and would inflate the
        # measured amplitude despite a correct selected 50% source volume.
        assert .07 < during['sourceTone'] < .13, ('Original video audio must retain its selected 50% mix', channel, during)
        output.append({'channel': channel, 'beforeVideo': before, 'insideVideo': during, 'afterVideo': after,
            'sourceToneRatio': during['sourceTone'] / source['sourceTone']})
    return {'sourceVideo': source, 'outputChannels': output}

audio_stream = next(stream for stream in probe['streams'] if stream['codec_type'] == 'audio')
measurements['audio'] = verify_audio_mix(movie, audio_stream['channels'])
measurements.update(passed=True, cancelledReaderClosed=True, cancelledAndCompletedTemporaryFilesRemoved=True,
    providerAcceptance=False, physicalDevice=False, photosLibraryWrite=False)
(root / 'decoded.json').write_text(json.dumps(measurements, indent=2) + '\n')
print(json.dumps(measurements, indent=2))
