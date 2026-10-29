// One local forward/reverse frame encoder shared by the native WebView and browser.
export const BOOMERANG_ENGINE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>html,body{margin:0;background:#000}video,canvas{position:absolute;left:0;top:0}</style></head><body><video id="v" playsinline muted preload="auto"></video><canvas id="c"></canvas><script>
var post=function(o){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(o));else if(window.parent!==window)window.parent.postMessage({source:'platinum-boomerang',payload:o},'*');};
window.__cancel=false;
function check(){if(window.__cancel)throw new Error('Cancelled');}
function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
function bounded(work,ms,message){var timer;return Promise.race([work,new Promise(function(_,reject){timer=setTimeout(function(){reject(new Error(message));},ms);})]).finally(function(){clearTimeout(timer);});}
function b64ToBlob(b64,type){var bin=atob(b64),bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new Blob([bytes],{type:type});}
function seekTo(v,time){
 if(Math.abs(v.currentTime-time)<0.001&&v.readyState>=2)return Promise.resolve();
 return new Promise(function(resolve,reject){var timer;function clear(){clearTimeout(timer);v.removeEventListener('seeked',done);v.removeEventListener('error',fail);}function done(){clear();resolve();}function fail(){clear();reject(new Error('A frame could not be decoded.'));}v.addEventListener('seeked',done);v.addEventListener('error',fail);timer=setTimeout(fail,3000);try{v.currentTime=time;}catch(e){clear();reject(e);}});
}
window.__bounceBlob=async function(input,effect){
 var video=document.getElementById('v'),canvas=document.getElementById('c'),ctx=canvas.getContext('2d'),url,stream,rec,frames=[],cache=new Map();
 try{
  check();if(!ctx||!canvas.captureStream||!window.MediaRecorder)throw new Error('This device has no local video encoder.');
  url=URL.createObjectURL(input);video.src=url;
  await bounded(new Promise(function(resolve,reject){video.onloadeddata=resolve;video.onerror=function(){reject(new Error('The clip could not be decoded.'));};video.load();}),8000,'The clip took too long to open.');check();
  var duration=video.duration;if(!isFinite(duration)||duration<0.2||duration>3)throw new Error('This clip cannot be used for a short Boomerang.');
  var scale=Math.min(1,1920/Math.max(video.videoWidth,video.videoHeight));
  canvas.width=Math.max(2,Math.round(video.videoWidth*scale/2)*2);canvas.height=Math.max(2,Math.round(video.videoHeight*scale/2)*2);
  var fps=30,count=Math.max(6,Math.min(60,Math.floor(duration*fps)));
  // Store compressed real frames, retaining only five decoded images. A full
  // array of 1080p ImageBitmaps can exhaust an iPhone WebView's memory.
  for(var i=0;i<count;i++){check();await seekTo(video,Math.min(duration-0.03,i*duration/count));check();ctx.drawImage(video,0,0,canvas.width,canvas.height);frames.push(await bounded(new Promise(function(resolve,reject){canvas.toBlob(function(blob){blob?resolve(blob):reject(new Error('Could not capture a frame.'));},'image/jpeg',0.97);}),3000,'A frame took too long to prepare.'));}
  async function frame(index){if(cache.has(index))return cache.get(index);var image;if(typeof createImageBitmap==='function')image=await createImageBitmap(frames[index]);else image=await new Promise(function(resolve,reject){var img=new Image(),src=URL.createObjectURL(frames[index]);img.onload=function(){URL.revokeObjectURL(src);resolve(img);};img.onerror=function(){URL.revokeObjectURL(src);reject(new Error('Could not open a frame.'));};img.src=src;});cache.set(index,image);if(cache.size>5){var oldest=cache.keys().next().value,old=cache.get(oldest);if(old&&old.close)old.close();cache.delete(oldest);}return image;}
  var indices=Array.from({length:count},function(_,j){return j;}),seq=indices.concat(indices.slice().reverse()),fx=effect||'classic';
  var frameMs=fx==='slomo'?2000/fps:fx==='duo'?1000/(fps*1.3):1000/fps;
  async function draw(k){var current=await frame(seq[k]);check();ctx.globalAlpha=1;ctx.drawImage(current,0,0);if(fx==='echo'){var previous=await frame(seq[(k+seq.length-2)%seq.length]),earlier=await frame(seq[(k+seq.length-4)%seq.length]);ctx.globalAlpha=.35;ctx.drawImage(previous,0,0);ctx.globalAlpha=.18;ctx.drawImage(earlier,0,0);ctx.globalAlpha=1;}else if(fx==='duo'){var bandHeight=Math.ceil(canvas.height/14);for(var b=0;b<14;b++){var y=b*bandHeight,h=Math.min(bandHeight,canvas.height-y);if(h>0)ctx.drawImage(current,0,y,canvas.width,h,(b%2?1:-1)*(6+(k+b)%5*3),y,canvas.width,h);}}}
  var mimeOut=['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp8','video/webm'].find(function(type){return MediaRecorder.isTypeSupported(type);});if(!mimeOut)throw new Error('This device has no supported video encoder.');
  stream=canvas.captureStream(fps);rec=new MediaRecorder(stream,{mimeType:mimeOut,videoBitsPerSecond:8000000});var chunks=[];
  rec.ondataavailable=function(event){if(event.data&&event.data.size)chunks.push(event.data);};
  var stopped=new Promise(function(resolve,reject){rec.onstop=resolve;rec.onerror=function(){reject(new Error('The video encoder could not finish.'));};});
  await draw(0);rec.start(200);var started=performance.now();
  for(var k=0;k<seq.length;k++){check();await draw(k);var target=started+(k+1)*frameMs;await wait(Math.max(0,target-performance.now()));}
  rec.stop();await bounded(stopped,5000,'The video encoder did not finish.');check();
  var seconds=(performance.now()-started)/1000,blob=new Blob(chunks,{type:mimeOut});if(!blob.size)throw new Error('The encoder returned an empty clip.');
  var data=await bounded(new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=function(){reject(new Error('Could not save the result.'));};reader.readAsDataURL(blob);}),5000,'The encoded clip could not be read.');check();
  post({type:'done',b64:String(data).split(',')[1],mime:mimeOut,seconds:seconds});
 }catch(error){if(!window.__cancel)post({type:'error',message:error&&error.message||String(error)});}
 finally{video.pause();video.removeAttribute('src');video.load();if(rec&&rec.state!=='inactive')try{rec.stop();}catch(_){}if(stream)stream.getTracks().forEach(function(track){track.stop();});if(url)URL.revokeObjectURL(url);cache.forEach(function(image){if(image.close)image.close();});cache.clear();frames=[];}
};
window.__bounce=function(b64,mime,effect){return window.__bounceBlob(b64ToBlob(b64,mime||'video/mp4'),effect);};
window.addEventListener('message',function(event){if(event.source!==window.parent||!event.data||event.data.source!=='platinum-boomerang-host')return;if(event.data.type==='cancel'){window.__cancel=true;return;}if(event.data.type==='encode'&&event.data.blob instanceof Blob&&!window.__started){window.__started=true;window.__bounceBlob(event.data.blob,event.data.effect);}});
post({type:'ready'});
</script></body></html>`;
