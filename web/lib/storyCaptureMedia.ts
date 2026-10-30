import { BOOMERANG_ENGINE } from '../../shared/boomerangEngine';
export type BoomerangEffect='classic'|'slomo'|'echo'|'duo';
export type StoryLayout='2v'|'2h'|'3h'|'4';
export const STORY_LAYOUTS:{id:StoryLayout;label:string;count:number}[]=[{id:'2v',label:'Side by side',count:2},{id:'2h',label:'Stacked',count:2},{id:'3h',label:'Three rows',count:3},{id:'4',label:'Grid',count:4}];
const abortError=()=>new DOMException('Capture cancelled','AbortError');
function check(signal?:AbortSignal){if(signal?.aborted)throw abortError();}
async function bounded<T>(work:Promise<T>,signal?:AbortSignal,ms=10000):Promise<T>{
 check(signal);let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('This capture took too long to prepare. Please retry.')),ms);abort=()=>reject(abortError());signal?.addEventListener('abort',abort,{once:true});})]);}
 finally{if(timer)clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);}
}
function canvasBlob(canvas:HTMLCanvasElement,signal?:AbortSignal){return bounded(new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('The image could not be created.')),'image/jpeg',1)),signal);}
export async function captureStoryPhoto(video:HTMLVideoElement,signal?:AbortSignal):Promise<Blob>{
 check(signal);if(!video.videoWidth||!video.videoHeight)throw new Error('The camera is still preparing. Try again.');
 const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const context=canvas.getContext('2d');if(!context)throw new Error('Photo capture is unavailable in this browser.');context.drawImage(video,0,0);return canvasBlob(canvas,signal);
}
async function photo(blob:Blob,signal?:AbortSignal):Promise<{source:CanvasImageSource;width:number;height:number;close:()=>void}>{
 check(signal);
 if(typeof createImageBitmap==='function'){
  let cancelled=false;
  const pending=createImageBitmap(blob).then(image=>{if(cancelled||signal?.aborted){image.close();throw abortError();}return image;});
  try{const image=await bounded(pending,signal);return{source:image,width:image.width,height:image.height,close:()=>image.close()};}catch(error){cancelled=true;throw error;}
 }
 const url=URL.createObjectURL(blob),image=new Image();
 try{await bounded(new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('A selected photo could not load. Choose another image.'));image.src=url;}),signal);return{source:image,width:image.naturalWidth,height:image.naturalHeight,close:()=>{image.src='';URL.revokeObjectURL(url);}};}
 catch(error){image.src='';URL.revokeObjectURL(url);throw error;}
}
function cover(context:CanvasRenderingContext2D,image:{source:CanvasImageSource;width:number;height:number},x:number,y:number,width:number,height:number){
 if(!image.width||!image.height)throw new Error('A photo has no readable dimensions.');const scale=Math.max(width/image.width,height/image.height),sourceW=width/scale,sourceH=height/scale;context.drawImage(image.source,(image.width-sourceW)/2,(image.height-sourceH)/2,sourceW,sourceH,x,y,width,height);
}
export async function composeStoryPhotos(files:Blob[],layout:StoryLayout|'dual',signal?:AbortSignal):Promise<File>{
 const needed=layout==='dual'?2:STORY_LAYOUTS.find(item=>item.id===layout)?.count;if(!needed||files.length!==needed)throw new Error('Fill every photo slot before continuing.');check(signal);
 const images:Awaited<ReturnType<typeof photo>>[]=[];
 try{for(const file of files){if(!file.type.startsWith('image/'))throw new Error('Choose photos for this layout.');images.push(await photo(file,signal));}check(signal);
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Photo layouts are unavailable in this browser.');ctx.fillStyle='#FFF';ctx.fillRect(0,0,1080,1920);
  if(layout==='dual'){cover(ctx,images[0],0,0,1080,1920);const x=60,y=124,w=280,h=380,r=34;ctx.save();ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();ctx.clip();cover(ctx,images[1],x,y,w,h);ctx.restore();ctx.lineWidth=4;ctx.strokeStyle='rgba(255,255,255,.9)';ctx.stroke();}
  else{const cells=layout==='2v'?[[0,0,.5,1],[.5,0,.5,1]]:layout==='2h'?[[0,0,1,.5],[0,.5,1,.5]]:layout==='3h'?[[0,0,1,1/3],[0,1/3,1,1/3],[0,2/3,1,1/3]]:[[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]];cells.forEach(([x,y,w,h],index)=>{const left=x*1080+(x?3:0),top=y*1920+(y?3:0),width=w*1080-(x?3:0)-(x+w<.999?3:0),height=h*1920-(y?3:0)-(y+h<.999?3:0);cover(ctx,images[index],left,top,width,height);});}
  const blob=await canvasBlob(canvas,signal);check(signal);return new File([blob],'story-'+layout+'-'+Date.now()+'.jpg',{type:'image/jpeg'});
 }finally{images.forEach(image=>image.close());}
}
export function encodeStoryBoomerang(blob:Blob,effect:BoomerangEffect,signal?:AbortSignal):Promise<File>{
 check(signal);if(typeof MediaRecorder==='undefined')return Promise.reject(new Error('This browser cannot encode a Boomerang. Choose another capture mode.'));
 return new Promise((resolve,reject)=>{
  const frame=document.createElement('iframe');frame.title='Local Boomerang encoder';frame.tabIndex=-1;frame.setAttribute('aria-hidden','true');frame.setAttribute('sandbox','allow-scripts');frame.style.cssText='position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none;border:0';let finished=false,started=false;
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',message);signal?.removeEventListener('abort',abort);frame.remove();};
  const finish=(error?:Error,file?:File)=>{if(finished)return;finished=true;cleanup();if(error)reject(error);else resolve(file!);};
  const abort=()=>{frame.contentWindow?.postMessage({source:'platinum-boomerang-host',type:'cancel'},'*');finish(abortError());};
  const message=(event:MessageEvent)=>{if(event.source!==frame.contentWindow||event.data?.source!=='platinum-boomerang')return;const data=event.data.payload;if(data?.type==='ready'&&!started){started=true;frame.contentWindow?.postMessage({source:'platinum-boomerang-host',type:'encode',blob,effect},'*');return;}if(data?.type==='error'){finish(new Error(String(data.message||'The Boomerang could not be created.')));return;}if(data?.type!=='done'||finished)return;
   if(typeof data.b64!=='string'||!data.b64.length||data.b64.length>40000000||!/^[A-Za-z0-9+/]+=*$/.test(data.b64)||!/^video\/(mp4|webm)(;|$)/.test(String(data.mime))||!Number.isFinite(data.seconds)||data.seconds<=0||data.seconds>20){finish(new Error('The encoder returned an invalid Boomerang. Please retry.'));return;}
   try{const bytes=Uint8Array.from(atob(data.b64),c=>c.charCodeAt(0)),mime=data.mime.split(';')[0];finish(undefined,new File([bytes],'story-boomerang-'+Date.now()+(mime==='video/webm'?'.webm':'.mp4'),{type:mime}));}catch{finish(new Error('The Boomerang could not be saved. Please retry.'));}
  };
  const timer=setTimeout(()=>finish(new Error('The Boomerang took too long to create. Please retry.')),60000);window.addEventListener('message',message);signal?.addEventListener('abort',abort,{once:true});frame.onerror=()=>finish(new Error('The local Boomerang encoder could not open.'));frame.srcdoc=BOOMERANG_ENGINE;document.body.appendChild(frame);
 });
}
