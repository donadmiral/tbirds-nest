const state=()=> (window as any).__liveStart;
export default {createCallObject(){
 state().dailyCreated=(state().dailyCreated||0)+1;
 const handlers=new Map<string,Function[]>();let stream:MediaStream|null=null,draw:number|undefined;
 const participant:any={local:true,user_id:'11111111-1111-4111-8111-111111111111',session_id:'local',user_name:'Synthetic host',tracks:{audio:{state:'off'},video:{state:'off'},screenAudio:{state:'off'},screenVideo:{state:'off'}}};
 const fire=(name:string)=>handlers.get(name)?.forEach(fn=>fn());
 const call:any={on(name:string,fn:Function){handlers.set(name,[...(handlers.get(name)||[]),fn]);return call;},participants(){return {local:participant};},async join(){fire('participant-joined');},async setLocalVideo(enabled:boolean){
  if(enabled&&!stream){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const paint=()=>{const ctx=canvas.getContext('2d')!;ctx.fillStyle='#223344';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='30px sans-serif';ctx.fillText('Synthetic camera preview',50,180);};paint();draw=window.setInterval(paint,80);stream=canvas.captureStream(12);}
  participant.tracks.video=enabled?{state:'playable',persistentTrack:stream!.getVideoTracks()[0]}:{state:'off'};fire('participant-updated');
 },async setLocalAudio(enabled:boolean){state().microphoneEnabled=enabled;participant.tracks.audio={state:enabled?'playable':'off'};fire('participant-updated');},async enumerateDevices(){return {devices:[]};},async setInputDevicesAsync(){},async leave(){fire('left-meeting');},async destroy(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}clearInterval(draw);state().destroyed++;},startScreenShare(){},stopScreenShare(){}};
 return call;
}};
