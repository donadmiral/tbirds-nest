// src/screens/stories/BoomerangWeb.tsx
// Boomerang without native code. The clip is bounced inside a hidden web
// engine: it decodes the frames by seeking a video element, draws them
// forward then backward on a canvas, and records that canvas with the
// browser's own encoder. On iOS that is H.264 in MP4, which every viewer
// plays. Used whenever the native encoder is not in the build.
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

let WebViewComp: any = null;
try { WebViewComp = require('react-native-webview').WebView; } catch { WebViewComp = null; }

const ENGINE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>html,body{margin:0;background:#000}video,canvas{position:absolute;left:0;top:0}</style></head><body>
<video id="v" playsinline muted preload="auto"></video><canvas id="c"></canvas>
<script>
var post=function(o){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); };
function b64ToBlob(b64,type){ var bin=atob(b64); var u8=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return new Blob([u8],{type:type}); }
function seekTo(v,t){ return new Promise(function(res){ var on=function(){ v.removeEventListener('seeked',on); res(); }; v.addEventListener('seeked',on); v.currentTime=t; }); }
function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
window.__bounce = async function(b64, mime, effect){
  try {
    var v=document.getElementById('v'), c=document.getElementById('c'), ctx=c.getContext('2d');
    v.src=URL.createObjectURL(b64ToBlob(b64, mime||'video/mp4'));
    await new Promise(function(res,rej){ v.onloadedmetadata=res; v.onerror=function(){ rej(new Error('the clip would not decode')); }; v.load(); });
    await wait(60);
    var dur=v.duration; if(!isFinite(dur)||dur<0.2) throw new Error('clip too short');
    var scale=Math.min(1, 720/Math.max(v.videoWidth,v.videoHeight));
    c.width=Math.round(v.videoWidth*scale/2)*2; c.height=Math.round(v.videoHeight*scale/2)*2;
    var fps=24, n=Math.max(8, Math.min(48, Math.floor(dur*fps))), frames=[];
    for (var i=0;i<n;i++){ await seekTo(v, Math.min(dur-0.03, i/fps)); ctx.drawImage(v,0,0,c.width,c.height); frames.push(await createImageBitmap(c)); }
    var once=frames.concat(frames.slice(1,-1).reverse()); var seq=once.concat(once);
    // Effects, Instagram's three. Slo-Mo halves the playback speed. Echo draws
    // the two previous frames fading behind the current one. Duo slices the
    // frame into bands shifted sideways and runs a little faster.
    var fx = effect || 'classic';
    var frameMs = fx === 'slomo' ? 2000/fps : fx === 'duo' ? 1000/(fps*1.3) : 1000/fps;
    function drawFrame(k){
      var cur = seq[k % seq.length];
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (fx === 'echo') {
        ctx.drawImage(cur,0,0);
        var p1 = seq[(k+seq.length-2) % seq.length], p2 = seq[(k+seq.length-4) % seq.length];
        ctx.globalAlpha = 0.35; ctx.drawImage(p1,0,0);
        ctx.globalAlpha = 0.18; ctx.drawImage(p2,0,0);
        ctx.globalAlpha = 1;
      } else if (fx === 'duo') {
        ctx.drawImage(cur,0,0);
        var bands = 14, bh = Math.ceil(c.height / bands);
        for (var b = 0; b < bands; b++) {
          var dx = ((b % 2 === 0) ? 1 : -1) * (6 + ((k + b) % 5) * 3);
          ctx.drawImage(cur, 0, b*bh, c.width, bh, dx, b*bh, c.width, bh);
        }
      } else {
        ctx.drawImage(cur,0,0);
      }
    }
    var mimeOut=['video/mp4;codecs=avc1','video/mp4'].filter(function(m){ return window.MediaRecorder && MediaRecorder.isTypeSupported(m); })[0];
    if(!mimeOut) throw new Error('this web engine has no video encoder');
    var stream=c.captureStream(fps), rec=new MediaRecorder(stream,{mimeType:mimeOut, videoBitsPerSecond:5000000}), chunks=[];
    rec.ondataavailable=function(e){ if(e.data&&e.data.size) chunks.push(e.data); };
    var stopped=new Promise(function(res){ rec.onstop=res; });
    rec.start(200);
    var k=0;
    await new Promise(function(res){ var tick=function(){ drawFrame(k); k++; if(k<=seq.length){ setTimeout(tick,frameMs); } else { setTimeout(res,150); } }; tick(); });
    rec.stop(); await stopped;
    var blob=new Blob(chunks,{type:mimeOut}), fr=new FileReader();
    var out=await new Promise(function(res,rej){ fr.onload=function(){ res(fr.result); }; fr.onerror=function(){ rej(new Error('could not read the result')); }; fr.readAsDataURL(blob); });
    post({type:'done', b64:String(out).split(',')[1], mime:mimeOut, frames:seq.length, fps:fps, seconds: Math.round(seq.length*frameMs/1000)});
  } catch(e) { post({type:'error', message:(e&&e.message)||String(e)}); }
};
post({type:'ready'});
</script></body></html>`;

export type BoomerangEffect = 'classic' | 'slomo' | 'echo' | 'duo';

export default function BoomerangWeb({ inputUri, onDone, onError, effect = 'classic' }: { inputUri: string; onDone: (uri: string, durationSec: number) => void; onError: (message: string) => void; effect?: BoomerangEffect }) {
  const ref = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const firedRef = useRef(false);
  const doneRef = useRef(false);

  useEffect(() => { if (!WebViewComp) onError('web engine unavailable'); }, []);

  useEffect(() => {
    if (!ready || firedRef.current) return;
    firedRef.current = true;
    (async () => {
      try {
        const b64 = await FileSystem.readAsStringAsync(inputUri, { encoding: FileSystem.EncodingType.Base64 });
        const mime = /\.mov$/i.test(inputUri) ? 'video/quicktime' : 'video/mp4';
        ref.current?.injectJavaScript(`window.__bounce(${JSON.stringify(b64)}, ${JSON.stringify(mime)}, ${JSON.stringify(effect)}); true;`);
      } catch (e: any) { onError(e?.message || 'could not read the clip'); }
    })();
  }, [ready, inputUri]);

  const onMessage = async (ev: any) => {
    let msg: any = null;
    try { msg = JSON.parse(ev?.nativeEvent?.data || '{}'); } catch { return; }
    if (msg.type === 'ready') { setReady(true); return; }
    if (doneRef.current) return;
    if (msg.type === 'error') { doneRef.current = true; onError(String(msg.message || 'bounce failed')); return; }
    if (msg.type === 'done' && msg.b64) {
      doneRef.current = true;
      try {
        const ext = /webm/.test(String(msg.mime || '')) ? 'webm' : 'mp4';
        const dest = (FileSystem.cacheDirectory || '') + 'boom-' + Date.now() + '.' + ext;
        await FileSystem.writeAsStringAsync(dest, msg.b64, { encoding: FileSystem.EncodingType.Base64 });
        onDone(dest, Math.max(1, Number(msg.seconds) || Math.round((Number(msg.frames) || 48) / (Number(msg.fps) || 24))));
      } catch (e: any) { onError(e?.message || 'could not save the boomerang'); }
    }
  };

  if (!WebViewComp) return null;
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width: 240, height: 240, opacity: 0.01 }} pointerEvents="none">
      <WebViewComp ref={ref} source={{ html: ENGINE, baseUrl: 'https://platinumcircles.app/' }} onMessage={onMessage}
        originWhitelist={['*']} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} javaScriptEnabled
        style={{ width: 240, height: 240, backgroundColor: 'transparent' }} />
    </View>
  );
}