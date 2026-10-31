const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('actual decoder helpers reject distorted geometry, gaps and incorrect per-channel source volume', () => {
  const program = String.raw`
import ast, math, pathlib, struct, unittest
source=pathlib.Path('scripts/quality/verify-native-ui-memory.py')
tree=ast.parse(source.read_text(),filename=str(source))
# Execute the checked-in measurement functions, without running the complete
# evidence gate or substituting a passing movie for its UI-produced input.
definitions=ast.Module(body=[node for node in tree.body if isinstance(node,(ast.Import,ast.ImportFrom,ast.FunctionDef))],type_ignores=[])
ns={};exec(compile(definitions,str(source),'exec'),ns)

def video(rotation=0):
    matrices={0:(65536,0,0,0,65536,0,0,0,1073741824),90:(0,-65536,0,65536,0,0,0,0,1073741824),180:(-65536,0,0,0,-65536,0,0,0,1073741824),270:(0,65536,0,-65536,0,0,0,0,1073741824)}
    values=matrices[rotation%360]
    matrix='\n'.join(str(i)+': '+' '.join(str(x) for x in values[i*3:i*3+3]) for i in range(3))
    return {'width':1280 if rotation%180 else 720,'height':720 if rotation%180 else 1280,'side_data_list':[{'side_data_type':'Display Matrix','rotation':rotation,'displaymatrix':matrix}]}

class Measurements(unittest.TestCase):
    def setUp(self): self.oldrun=ns['run'];self.oldaudio=ns['audio']
    def tearDown(self): ns['run']=self.oldrun;ns['audio']=self.oldaudio
    def test_plain_portrait(self): self.assertEqual(ns['display_size']({'width':720,'height':1280}),((720,1280),0))
    def test_right_angle_matrices(self):
        for angle in [0,90,180,270,-90]:
            with self.subTest(angle=angle): self.assertEqual(ns['display_size'](video(angle)),((720,1280),angle%360))
    def test_actual_unscaled_decode_required(self):
        commands=[]
        def run(args):
            commands.append(args);return b'\x89PNG\r\n\x1a\n'+b'0'*8+struct.pack('>II',720,1280)
        ns['run']=run;result=ns['verify_display_geometry'](video(-90),'actual.mp4')
        self.assertEqual(result['decodedWidth'],720);self.assertEqual(result['codedWidth'],1280)
        self.assertEqual(len(commands),1);self.assertNotIn('-vf',commands[0]);self.assertNotIn('-noautorotate',commands[0])
    def test_rotation_does_not_excuse_wrong_decoded_canvas(self):
        ns['run']=lambda args:b'\x89PNG\r\n\x1a\n'+b'0'*8+struct.pack('>II',1280,720)
        with self.assertRaises(AssertionError):ns['verify_display_geometry'](video(-90),'wrong.mp4')
    def test_reject_non_right_angle_and_ambiguous_rotation(self):
        for bad in [None,True,45,float('nan'),float('inf')]:
            value=video();value['side_data_list'][0]['rotation']=bad
            with self.subTest(bad=bad),self.assertRaises(AssertionError):ns['display_size'](value)
        value=video();value['side_data_list']*=2
        with self.assertRaises(AssertionError):ns['display_size'](value)
    def test_reject_mirror_scale_translation_and_non_square_pixels(self):
        for bad in ['0: -65536 0 0\n1: 0 65536 0\n2: 0 0 1073741824','0: 32768 0 0\n1: 0 65536 0\n2: 0 0 1073741824','0: 65536 0 1\n1: 0 65536 0\n2: 0 0 1073741824']:
            value=video();value['side_data_list'][0]['displaymatrix']=bad
            with self.subTest(matrix=bad),self.assertRaises(AssertionError):ns['display_size'](value)
        value=video();value['sample_aspect_ratio']='2:1'
        with self.assertRaises(AssertionError):ns['display_size'](value)
    def test_reject_landscape_without_valid_rotation(self):
        with self.assertRaises(AssertionError):ns['verify_display_geometry']({'width':1280,'height':720},'wrong.mp4')
    def test_continuous_cadence(self):ns['verify_cadence']([i/30 for i in range(351)],11.7)
    def test_reject_exact_retained_133ms_gap_without_relaxation(self):
        times=[i/30 for i in range(351) if i not in (210,211,212)]
        self.assertAlmostEqual(max(b-a for a,b in zip(times,times[1:])),.1333333333333333)
        with self.assertRaisesRegex(AssertionError,'100 ms'):ns['verify_cadence'](times,11.7)
    def test_reject_nonmonotonic_and_sparse_tail(self):
        for times in [[i/30 for i in range(351)][::-1],[i/30 for i in range(330)],[0,0]*180]:
            with self.assertRaises(AssertionError):ns['verify_cadence'](times,11.7)
    def mock_audio(self,amplitudes=(.1,.1),before=.002,after=.002,source=.2,leak=0):
        calls=[]
        def audio(file,start,channel=0):
            calls.append((str(file),start,channel))
            if str(file).endswith('memory-capture-video.mp4'):return {'sourceTone':source,'rms':source/math.sqrt(2)}
            return {'sourceTone':amplitudes[channel] if start==5.9 else leak,'rms':.1 if start==5.9 else before if start==3 else after}
        ns['audio']=audio;return calls
    def test_same_volume_accepted_for_mono_and_each_stereo_channel(self):
        for channels in [1,2]:
            calls=self.mock_audio();result=ns['verify_audio_mix']('movie.mp4',channels)
            self.assertEqual(len(calls),1+3*channels)
            self.assertEqual([x['sourceToneRatio'] for x in result['outputChannels']],[.5]*channels)
    def test_reject_wrong_volume_in_either_channel_even_if_downmix_looks_correct(self):
        for levels in [(.1,.01),(.01,.1),(.2,.2),(.1388,.1388),(.07,.1),(.1,.13)]:
            self.mock_audio(levels)
            with self.subTest(levels=levels),self.assertRaises(AssertionError):ns['verify_audio_mix']('movie.mp4',2)
    def test_reject_missing_score_leak_and_changed_source(self):
        for values in [dict(before=0),dict(after=0),dict(source=.1),dict(leak=.01)]:
            self.mock_audio(**values)
            with self.subTest(values=values),self.assertRaises(AssertionError):ns['verify_audio_mix']('movie.mp4',2)
    def test_reject_unknown_channel_layouts(self):
        for channels in [0,3,6,True,None]:
            with self.subTest(channels=channels),self.assertRaises(AssertionError):ns['verify_audio_mix']('movie.mp4',channels)
    def test_real_spectral_math_and_explicit_channel_selection(self):
        calls=[]
        def run(args):
            calls.append(args);samples=[.1*math.sin(2*math.pi*1234*i/48000) for i in range(19200)]
            return struct.pack('<'+str(len(samples))+'f',*samples)
        ns['run']=run;result=ns['audio']('movie.mp4',5.9,1)
        self.assertAlmostEqual(result['sourceTone'],.1,delta=.0001)
        self.assertIn('pan=mono|c0=c1',calls[0][calls[0].index('-af')+1])
    def test_reject_incomplete_audio_window(self):
        ns['run']=lambda args:b'\0'*4
        with self.assertRaises(AssertionError):ns['audio']('movie.mp4',5.9,0)

unittest.main()
`;
  const result = spawnSync('python3', ['-c', program], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 16 tests/);
});
