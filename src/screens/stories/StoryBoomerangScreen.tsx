import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { makeBoomerang } from '../../../modules/boomerang';
import BoomerangWeb, { BoomerangEffect } from './BoomerangWeb';
import { useCameraLife } from '../../hooks/useCameraLife';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';

const BOOM_SEC = 1;
const CAPTURE_SIZE = 78;
const RING_R = 36;
const RING_C = 2 * Math.PI * (RING_R + 5);
let CameraView: any = null;
let useCameraPermissions: any = () => [null, async () => ({ granted: false })];
try { const camera = require('expo-camera'); CameraView = camera.CameraView; useCameraPermissions = camera.useCameraPermissions; } catch {}

async function bounded<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

export default function StoryBoomerangScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  if (!CameraView) return <View style={s.fallback}><SafeAreaView style={s.fallbackInner}><Text style={s.fallbackTitle}>Camera not available</Text><Text style={s.fallbackSub}>This feature requires a new app build.</Text><TouchableOpacity style={s.permBtn} onPress={() => navigation.goBack()}><Text style={s.permBtnTxt}>Go back</Text></TouchableOpacity></SafeAreaView></View>;
  return <BoomerangInner navigation={navigation} extraParams={route?.params} insets={insets} />;
}

function BoomerangInner({ navigation, extraParams, insets }: { navigation: any; extraParams?: any; insets: any }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useCameraLife();
  const activeRef = useRef(cam.active); activeRef.current = cam.active;
  const cameraRef = useRef<any>(null), mounted = useRef(true), generation = useRef(0);
  const lock = useRef(false), pending = useRef(false), recordingRef = useRef(false), readyRef = useRef(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [camMode, setCamMode] = useState<'picture' | 'video'>('picture');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'recording' | 'processing'>('idle');
  const [ready, setReady] = useState(false), [progress, setProgress] = useState(0), [cameraEpoch, setCameraEpoch] = useState(0);
  const [error, setError] = useState('');
  const [boomEffect, setBoomEffect] = useState<BoomerangEffect>('classic');
  const effectRef = useRef(boomEffect); effectRef.current = boomEffect;
  const [bounce, setBounce] = useState<{ input: string; effect: BoomerangEffect; generation: number; attempt: number } | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const encoding = useRef<AbortController | null>(null);
  const current = (run: number) => mounted.current && activeRef.current && generation.current === run;
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current.clear(); if (progressTimer.current) clearInterval(progressTimer.current); progressTimer.current = null; };
  const later = (fn: () => void, ms: number) => { const timer = setTimeout(() => { timers.current.delete(timer); fn(); }, ms); timers.current.add(timer); };
  const cancel = useCallback((update = true) => {
    generation.current++; lock.current = false; pending.current = false; recordingRef.current = false; clearTimers();
    encoding.current?.abort(); encoding.current = null;
    try { cameraRef.current?.stopRecording(); } catch {}
    if (update && mounted.current) { setPhase('idle'); setProgress(0); setBounce(null); setCamMode('picture'); }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel(false); }; }, [cancel]);
  useEffect(() => { if (!cam.active) cancel(); }, [cam.active, cancel]);
  useEffect(() => { readyRef.current = false; setReady(false); }, [facing, camMode, cam.active, cam.epoch, cameraEpoch]);
  const finish = (uri: string, durationSec: number, run: number) => {
    if (!current(run) || !uri) return;
    cancel();
    navigation.navigate('StoryComposer', { ...extraParams, mode: 'video', assets: [{ uri, localUri: uri, type: 'video', mediaType: 'video', durationSec }] });
  };
  const fail = (message: string, run: number) => { if (!current(run)) return; cancel(); setError(message); };

  const doRecord = async (attempt: number, run: number) => {
    if (!current(run) || !pending.current || recordingRef.current || !cameraRef.current) return;
    recordingRef.current = true; setPhase('recording'); setProgress(0); clearTimers();
    const started = Date.now();
    progressTimer.current = setInterval(() => { if (current(run)) setProgress(Math.min(1, (Date.now() - started) / 1000)); }, 50);
    later(() => { if (current(run)) try { cameraRef.current?.stopRecording(); } catch {} }, 1300);
    try {
      const video: any = await bounded(cameraRef.current.recordAsync({ maxDuration: BOOM_SEC, codec: 'avc1' }), 6000, 'The camera did not finish the clip. Try again.');
      if (!current(run)) return;
      clearTimers(); recordingRef.current = false; pending.current = false;
      if (!video?.uri) throw new Error('The camera returned no clip. Try again.');
      setPhase('processing'); setProgress(0);
      const effect = effectRef.current;
      // The native encoder implements Classic only. The other real effects
      // must go through the frame engine instead of silently becoming Classic.
      if (effect !== 'classic') { setBounce({ input: video.uri, effect, generation: run, attempt: 0 }); return; }
      let controller: AbortController | undefined;
      try {
        if (!FileSystem.cacheDirectory) throw new Error('Temporary storage unavailable');
        controller = new AbortController(); encoding.current = controller;
        const out = FileSystem.cacheDirectory + 'boom-' + Date.now() + '-' + run + '.mp4';
        const uri = await bounded(makeBoomerang(video.uri, out, 1, controller.signal), 25000, 'Boomerang encoding took too long.');
        if (encoding.current === controller) encoding.current = null;
        if (current(run)) finish(uri || out, BOOM_SEC * 2, run);
      } catch { if (current(run)) setBounce({ input: video.uri, effect, generation: run, attempt: 0 }); }
      finally { if (encoding.current === controller) encoding.current = null; controller?.abort(); }
    } catch (e: any) {
      if (!current(run)) return;
      clearTimers(); recordingRef.current = false;
      if (/not ready/i.test(String(e?.message)) && pending.current && attempt < 20) { setPhase('preparing'); later(() => void doRecord(attempt + 1, run), 150); return; }
      fail(e?.message || 'Could not capture a Boomerang. Try again.', run);
    }
  };
  const shutter = () => {
    if (!cam.active || !readyRef.current || lock.current) return;
    lock.current = true; pending.current = true; setError(''); setPhase('preparing');
    const run = ++generation.current;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    later(() => { if (current(run) && pending.current && !recordingRef.current) fail('The camera did not become ready. Try again.', run); }, 10000);
    if (camMode === 'video') void doRecord(0, run); else setCamMode('video');
  };
  const close = () => { cancel(); navigation.goBack(); };
  const requestAccess = async () => { try { if (permission?.canAskAgain) await requestPermission(); else await Linking.openSettings(); } catch { if (mounted.current) setError('Camera access could not be requested. Try again from settings.'); } };
  if (!permission?.granted) return <View style={s.fallback}><StatusBar barStyle="light-content"/><SafeAreaView style={s.fallbackInner} edges={['top','bottom']}><Feather name="camera-off" size={48} color="#AEB8C6"/><Text style={s.fallbackTitle}>{permission ? 'Camera access needed' : 'Checking camera access…'}</Text>{permission ? <TouchableOpacity style={s.permBtn} onPress={() => void requestAccess()}><Text style={s.permBtnTxt}>{permission.canAskAgain ? 'Allow camera' : 'Open settings'}</Text></TouchableOpacity> : <ActivityIndicator color="#FFF"/>}{error ? <Text style={s.fallbackSub}>{error}</Text> : null}<TouchableOpacity style={s.topBtn} onPress={close} accessibilityLabel="Close Boomerang"><Feather name="x" size={24} color="#FFF"/></TouchableOpacity></SafeAreaView></View>;
  const recording = phase === 'recording', busy = phase !== 'idle';
  const ringSize = CAPTURE_SIZE + 12;
  return <View style={s.root}><StatusBar barStyle="light-content"/>
    {cam.active && phase !== 'processing' ? <CameraView key={facing + ':' + camMode + ':' + cam.epoch + ':' + cameraEpoch} active ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode={camMode} mute videoQuality="1080p" videoBitrate={8000000}
      onCameraReady={() => { readyRef.current = true; setReady(true); if (pending.current && camMode === 'video') void doRecord(0, generation.current); }}
      onMountError={() => { const run = generation.current; fail('This camera could not start. Try again or return to the story camera.', run); readyRef.current = false; setReady(false); }}/>: null}
    {bounce ? <BoomerangWeb key={bounce.input + ':' + bounce.attempt} inputUri={bounce.input} effect={bounce.effect}
      onDone={(uri, duration) => finish(uri, duration, bounce.generation)}
      onError={message => { if (current(bounce.generation)) setError(message || 'This Boomerang could not be created.'); }}/>: null}
    <View style={[s.topBar,{paddingTop:Math.max(insets.top,12)+8}]}><TouchableOpacity style={s.topBtn} onPress={close} accessibilityLabel="Close Boomerang"><Feather name="x" size={24} color="#FFF"/></TouchableOpacity><Text style={s.title}>BOOM</Text><TouchableOpacity disabled={busy} style={s.topBtn} accessibilityLabel="Switch camera" onPress={() => { if (!lock.current) setFacing(f => f === 'back' ? 'front' : 'back'); }}><Feather name="refresh-cw" size={20} color="#FFF"/></TouchableOpacity></View>
    {phase === 'processing' ? <View style={[StyleSheet.absoluteFill,{alignItems:'center',justifyContent:'center',padding:28}]}><ActivityIndicator color="#FFF"/><Text style={[s.fallbackTitle,{marginTop:16}]}>Creating your Boomerang…</Text></View>:null}
    {error ? <View style={[StyleSheet.absoluteFill,{backgroundColor:'#0C1118',alignItems:'center',justifyContent:'center',padding:28}]}><Text accessibilityRole="alert" style={[s.fallbackTitle,{textAlign:'center',lineHeight:24}]}>{error}</Text><TouchableOpacity style={s.permBtn} onPress={() => { setError(''); if (bounce) setBounce({...bounce,attempt:bounce.attempt+1}); else { cancel(); setCameraEpoch(n => n+1); } }}><Text style={s.permBtnTxt}>Try again</Text></TouchableOpacity>{bounce?<TouchableOpacity style={s.permBtn} onPress={() => { setError(''); cancel(); }}><Text style={s.permBtnTxt}>Retake</Text></TouchableOpacity>:null}<TouchableOpacity style={s.permBtn} onPress={close}><Text style={s.permBtnTxt}>Go back</Text></TouchableOpacity></View>:null}
    {!error && phase !== 'processing' ? <View style={[s.bottomControls,{paddingBottom:Math.max(insets.bottom+18,32)}]}>{!busy?<View style={{flexDirection:'row',gap:8,marginBottom:10}}>{([['classic','Classic'],['slomo','Slo-Mo'],['echo','Echo'],['duo','Duo']] as [BoomerangEffect,string][]).map(([effect,label])=><TouchableOpacity key={effect} accessibilityRole="button" accessibilityState={{selected:boomEffect===effect}} onPress={() => { if (!lock.current) setBoomEffect(effect); }} style={{minHeight:44,paddingHorizontal:12,justifyContent:'center',borderRadius:24,backgroundColor:boomEffect===effect?'#FFF':'#303641'}}><Text style={{color:boomEffect===effect?'#0B1E3D':'#FFF',fontSize:13,fontWeight:'600'}}>{label}</Text></TouchableOpacity>)}</View>:null}<Text style={s.hintTxt}>{recording?'Capturing…':busy?'Preparing camera…':ready?'Tap to capture a Boomerang':'Starting camera…'}</Text><TouchableOpacity onPress={shutter} disabled={busy||!ready} accessibilityRole="button" accessibilityLabel="Capture Boomerang" style={[s.captureWrap,{opacity:busy || !ready ? .6 : 1}]}><Svg width={ringSize} height={ringSize} style={StyleSheet.absoluteFill as any}><Circle cx={ringSize/2} cy={ringSize/2} r={RING_R+5} stroke="#FFF" strokeWidth={4} fill="none"/>{recording?<Circle cx={ringSize/2} cy={ringSize/2} r={RING_R+5} stroke="#FF3B30" strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray={RING_C} strokeDashoffset={RING_C*(1-progress)} transform={'rotate(-90 '+ringSize/2+' '+ringSize/2+')'}/>:null}</Svg><View style={[s.captureInner,recording&&s.captureInnerRecording]}/></TouchableOpacity></View>:null}
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fallback: { flex: 1, backgroundColor: '#000' },
  fallbackInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  fallbackTitle: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  fallbackSub: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center' },
  permBtn: { marginTop: 8, backgroundColor: '#FFF', borderRadius: 999, paddingHorizontal: 24, paddingVertical: 11 },
  permBtnTxt: { color: '#000', fontSize: 14, fontWeight: '700' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, zIndex: 10 },
  topBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  title: { color: '#FFF', fontSize: 14, fontWeight: '800', letterSpacing: 1.5 },
  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: 14 },
  hintTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '600' },
  captureWrap: { width: CAPTURE_SIZE + 12, height: CAPTURE_SIZE + 12, alignItems: 'center', justifyContent: 'center' },
  captureInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFF' },
  captureInnerRecording: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#FF3B30' },
});
