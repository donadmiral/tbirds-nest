// A bounded local frame encoder for non-Classic effects and binaries without
// the native encoder. It emits a real bounced clip, never a renamed straight clip.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
let WebViewComp: any = null;
try { WebViewComp = require('react-native-webview').WebView; } catch {}

import { BOOMERANG_ENGINE as ENGINE } from '../../../shared/boomerangEngine';

export type BoomerangEffect = 'classic' | 'slomo' | 'echo' | 'duo';
export default function BoomerangWeb({ inputUri, onDone, onError, effect='classic' }: { inputUri:string; onDone:(uri:string,durationSec:number)=>void; onError:(message:string)=>void; effect?:BoomerangEffect }) {
  const ref=useRef<any>(null),callbacks=useRef({onDone,onError});callbacks.current={onDone,onError};
  const [ready,setReady]=useState(false);
  const scope=useMemo(()=>({live:true,finished:false,started:false,saving:false,timer:null as ReturnType<typeof setTimeout>|null}),[inputUri,effect]);
  const current=useRef(scope);current.current=scope;
  const isCurrent=()=>scope.live&&current.current===scope&&!scope.finished;
  const fail=(message:string)=>{if(!isCurrent())return;scope.finished=true;if(scope.timer)clearTimeout(scope.timer);callbacks.current.onError(message);};
  useEffect(()=>{const engine=ref.current;scope.live=true;setReady(false);scope.timer=setTimeout(()=>fail('The Boomerang took too long to create. Please retry.'),60000);if(!WebViewComp)fail('This app build has no local Boomerang encoder.');return()=>{scope.live=false;if(scope.timer)clearTimeout(scope.timer);engine?.injectJavaScript('window.__cancel=true;true;');};},[scope]);
  useEffect(()=>{
    if(!ready||scope.started||!isCurrent())return;scope.started=true;
    void (async()=>{try{const b64=await FileSystem.readAsStringAsync(inputUri,{encoding:FileSystem.EncodingType.Base64});if(!isCurrent())return;if(!ref.current)throw new Error('The local video encoder did not open.');const mime=/\.mov(?:\?|$)/i.test(inputUri)?'video/quicktime':'video/mp4';ref.current.injectJavaScript('window.__bounce('+JSON.stringify(b64)+','+JSON.stringify(mime)+','+JSON.stringify(effect)+');true;');}catch(e:any){fail(e?.message||'Could not read the clip.');}})();
  },[ready,scope,inputUri,effect]);
  const message=async(event:any)=>{
    if(!isCurrent())return;let msg:any;try{msg=JSON.parse(event?.nativeEvent?.data||'{}');}catch{return;}
    if(msg.type==='ready'){setReady(true);return;}if(msg.type==='error'){fail(String(msg.message||'This Boomerang could not be created.'));return;}
    if(msg.type!=='done'||scope.saving)return;
    if(typeof msg.b64!=='string'||!msg.b64.length||msg.b64.length>40000000||!/^[A-Za-z0-9+/]+=*$/.test(msg.b64)||!/^video\/(mp4|webm)(;|$)/.test(String(msg.mime))||!Number.isFinite(msg.seconds)||msg.seconds<=0||msg.seconds>20){fail('The encoder returned an invalid clip. Please retry.');return;}
    scope.saving=true;let dest='';
    try{if(!FileSystem.cacheDirectory)throw new Error('Temporary storage is unavailable.');dest=FileSystem.cacheDirectory+'boom-'+Date.now()+'-'+Math.random().toString(36).slice(2)+(/webm/.test(msg.mime)?'.webm':'.mp4');await FileSystem.writeAsStringAsync(dest,msg.b64,{encoding:FileSystem.EncodingType.Base64});if(!isCurrent()){void FileSystem.deleteAsync(dest,{idempotent:true}).catch(()=>{});return;}scope.finished=true;if(scope.timer)clearTimeout(scope.timer);callbacks.current.onDone(dest,msg.seconds);}catch(e:any){fail(e?.message||'Could not save the Boomerang.');}
  };
  if(!WebViewComp)return null;
  return <View style={{position:'absolute',left:0,top:0,width:240,height:240,opacity:.01}} pointerEvents="none"><WebViewComp key={inputUri+':'+effect} ref={ref} source={{html:ENGINE}} onMessage={message} onError={()=>fail('The local video encoder could not open.')} onContentProcessDidTerminate={()=>fail('The local video encoder stopped. Please retry.')} originWhitelist={['*']} onShouldStartLoadWithRequest={(request:any)=>request.url==='about:blank'||String(request.url).startsWith('data:text/html')} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} javaScriptEnabled style={{width:240,height:240,backgroundColor:'transparent'}}/></View>;
}
