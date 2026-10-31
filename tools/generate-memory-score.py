"""Reproduce the original Platinum Circles 'Quiet light' instrumental.

No external recordings, melodies, pretrained music model, or sample library.
Deterministic additive synthesis; a circular score renders the end into the start.
Requires numpy and ffmpeg. Writes identical native/web AAC assets and an analysis receipt.
"""
from pathlib import Path
import hashlib, json, subprocess, tempfile, wave
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RATE, BPM, BARS = 48000, 75, 8
BEAT = 60 / BPM
DURATION = BARS * 4 * BEAT
COUNT = round(DURATION * RATE)
mix = np.zeros((COUNT, 2), dtype=np.float64)

def note(midi, at, duration, gain, pan, soft=False):
    n = round(duration * RATE)
    t = np.arange(n) / RATE
    hz = 440 * 2 ** ((midi - 69) / 12)
    attack = .18 if soft else .015
    envelope = np.minimum(1, t / attack) * np.minimum(1, (duration - t) / .45)
    envelope *= np.exp(-t / (duration * (.8 if soft else .28)))
    tone = np.sin(2*np.pi*hz*t) + (.12 if soft else .24)*np.sin(2*np.pi*hz*2*t) + .04*np.sin(2*np.pi*hz*3*t)
    signal = tone * envelope * gain
    index = (np.arange(n) + round(at * RATE)) % COUNT
    np.add.at(mix[:, 0], index, signal * np.sqrt((1 - pan) / 2))
    np.add.at(mix[:, 1], index, signal * np.sqrt((1 + pan) / 2))

# Original, deliberately sparse eight-bar arrangement. C major / related modes.
chords = [(48,55,59,64),(45,52,55,60),(41,48,55,60),(43,50,55,60),
          (40,47,55,62),(41,48,57,64),(38,45,53,60),(43,50,57,62)]
melody = [(76,74,71),(72,67,69),(69,72,76),(74,72,67),
          (71,74,79),(76,72,69),(74,69,65),(67,71,74)]
for bar, chord in enumerate(chords):
    start = bar * 4 * BEAT
    for j, pitch in enumerate(chord): note(pitch, start, 5.2, .045, (j-1.5)/3, True)
    for j, pitch in enumerate(melody[bar]): note(pitch, start + (.5 + j*1.15)*BEAT, 2.7, .07, [-.3,.22,.05][j])
    note(chord[0]-12, start, 3.3, .035, 0, True)
mix *= .46 / np.max(np.abs(mix))
# A 20 ms cosine declick at the file seam also bounds AAC encoder start/end ringing.
edge = round(.02 * RATE)
ramp = np.sin(np.linspace(0, np.pi/2, edge)) ** 2
mix[:edge] *= ramp[:, None]; mix[-edge:] *= ramp[::-1, None]
pcm = np.clip(mix * 32767, -32767, 32767).astype('<i2')
native = ROOT/'assets/audio/platinum-memory-score.m4a'
web = ROOT/'web/public/audio/platinum-memory-score.m4a'
native.parent.mkdir(parents=True, exist_ok=True); web.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='platinum-memory-score-') as scratch:
    wav = Path(scratch)/'score.wav'
    with wave.open(str(wav), 'wb') as handle:
        handle.setnchannels(2); handle.setsampwidth(2); handle.setframerate(RATE); handle.writeframes(pcm.tobytes())
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-c:a','aac','-b:a','128k','-movflags','+faststart','-metadata','title=Quiet light','-metadata','artist=Platinum Circles',str(native)],check=True)
web.write_bytes(native.read_bytes())
probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(native)]))
stream = probe['streams'][0]
decoded = subprocess.check_output(['ffmpeg','-hide_banner','-loglevel','error','-i',str(native),'-f','f32le','-acodec','pcm_f32le','-ac','2','-ar',str(RATE),'-'])
samples = np.frombuffer(decoded, dtype='<f4').reshape(-1,2)[:COUNT]
receipt = {
    'title':'Quiet light','provenance':'Original procedural instrumental; no third-party samples or named-song imitation.',
    'generator':'tools/generate-memory-score.py','seconds':DURATION,'codec':stream['codec_name'],
    'sample_rate':int(stream['sample_rate']),'channels':stream['channels'],'container_seconds':float(probe['format']['duration']),
    'peak':float(np.max(np.abs(mix))),'source_loop_boundary_delta':float(np.max(np.abs(mix[0]-mix[-1]))),
    'decoded_peak':float(np.max(np.abs(samples))),'decoded_loop_boundary_delta':float(np.max(np.abs(samples[0]-samples[-1]))),
    'sha256':hashlib.sha256(native.read_bytes()).hexdigest(),'bytes':native.stat().st_size,
    'native_and_web_identical':native.read_bytes()==web.read_bytes(),
    'listening_acceptance':'Device/browser loop and audio-session listening still required; numeric checks are not an audible-quality rating.'
}
assert receipt['codec']=='aac' and receipt['channels']==2 and abs(receipt['container_seconds']-DURATION)<.05
assert receipt['source_loop_boundary_delta']<.001 and receipt['decoded_loop_boundary_delta']<.005 and receipt['decoded_peak']<.8
(ROOT/'assets/audio/platinum-memory-score.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
