"use client";

/** Capture real, decoded frames; never invent a thumbnail or silently publish a blank cover. */
export function capturePostCover(url:string,at:number,maxWidth=1200):Promise<Blob> {
  return new Promise((resolve,reject)=>{
    const video=document.createElement('video'); let done=false;
    const finish=(blob?:Blob|null)=>{if(done)return;done=true;clearTimeout(timer);video.onloadeddata=null;video.onseeked=null;video.onerror=null;video.pause();video.removeAttribute('src');video.load();if(blob)resolve(blob);else reject(new Error('The selected video frame could not be prepared. Choose another frame or upload a cover.'));};
    const timer=setTimeout(()=>finish(),15000);
    video.muted=true;video.preload='auto';video.playsInline=true;video.onerror=()=>finish();
    const draw=()=>{if(done)return;try{if(!video.videoWidth||!video.videoHeight)throw new Error('Video dimensions unavailable');const canvas=document.createElement('canvas');const scale=Math.min(1,maxWidth/video.videoWidth);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable');context.drawImage(video,0,0,canvas.width,canvas.height);canvas.toBlob(finish,'image/jpeg',.88);}catch{finish();}};
    video.onloadeddata=()=>{const next=Math.min(Math.max(0,at),Math.max(0,video.duration-.05));if(next>.02){video.onseeked=draw;video.currentTime=next;}else draw();};video.src=url;
  });
}
