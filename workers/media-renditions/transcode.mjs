import {spawn} from 'node:child_process';
import {mkdir,readdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ASSET} from './config.mjs';
const fail=code=>Object.assign(new Error(code),{permanent:true});
export async function command(binary,args,{signal,cwd,maxOutput=1048576}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason||new Error('worker_deadline'));return;}
  const child=spawn(binary,args,{cwd,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,LANG:'C',HOME:cwd||'/tmp'},windowsHide:true});let output=[],size=0,ended=false,timer;
  const kill=()=>{child.kill('SIGTERM');timer=setTimeout(()=>child.kill('SIGKILL'),1000);timer.unref();};
  signal?.addEventListener('abort',kill,{once:true});
  const collect=chunk=>{size+=chunk.length;if(size>maxOutput)kill();else output.push(chunk);};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  const finish=(error)=>{if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',kill);if(error)reject(error);else resolve(Buffer.concat(output).toString('utf8'));};
  child.on('error',()=>finish(new Error('encoder_unavailable')));
  child.on('close',code=>finish(signal?.aborted?new Error('worker_deadline'):size>maxOutput?fail('encoder_output_budget'):code!==0?fail('decode_failed'):null));
 });
}
export async function probe(file,options={}) {
 const raw=await command(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-protocol_whitelist','file','-show_entries','format=duration,format_name:stream=codec_type,codec_name,width,height,r_frame_rate,sample_aspect_ratio,color_transfer:stream_side_data=rotation','-of','json',file],options);
 let p;try{p=JSON.parse(raw);}catch{throw fail('invalid_probe');}
 const video=p.streams?.find(s=>s.codec_type==='video');let width=Number(video?.width),height=Number(video?.height),duration=Number(p.format?.duration);
 const sar=(video?.sample_aspect_ratio||'1:1').split(':').map(Number);
 if(sar[0]>0&&sar[1]>0){const ratio=sar[0]/sar[1];if(ratio<.25||ratio>4)throw fail('sample_aspect_budget');width=Math.round(width*ratio);}
 const rotation=Number(video?.side_data_list?.find(s=>s.rotation!==undefined)?.rotation||0);
 if(Math.abs(rotation)%180===90)[width,height]=[height,width];
 const rate=(video?.r_frame_rate||'30/1').split('/').map(Number);const fps=rate[0]/(rate[1]||1);
 if(!video || !Number.isFinite(duration) || duration<0.05 || width<2 || height<2 || width>8192 || height>8192 || width*height>33554432 || !Number.isFinite(fps) || fps<1 || fps>120)throw fail('input_media_budget');
 if(!/^(mov,mp4|matroska|webm|mpegts|avi|ogg)/.test(p.format?.format_name||''))throw fail('unsupported_container');
 return {width,height,duration,fps:Math.min(60,fps),audio:!!p.streams.find(s=>s.codec_type==='audio'),hdr:['smpte2084','arib-std-b67'].includes(video.color_transfer)};
}
export function ladder(media){
 const max=Math.max(media.width,media.height),edges=[480,720,1280,1920].filter(e=>e<max);edges.push(Math.min(max,1920));
 return [...new Set(edges)].slice(0,4).map((edge,index)=>{const ratio=edge/max,width=Math.max(2,Math.floor(media.width*ratio/2)*2),height=Math.max(2,Math.floor(media.height*ratio/2)*2);
  const bitrate=Math.round(Math.max(350000,Math.min(8000000,width*height*2.4*Math.max(1,media.fps/30))));return{index,width,height,bitrate};});
}
export async function listAssets(directory,maxBytes){
 const files=[];let total=0;
 async function walk(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+entry.name,file=path.join(dir,entry.name);if(entry.isDirectory()){if(!/^r[0-3]$/.test(name))throw fail('unexpected_output');await walk(file,name+'/');continue;}
   if(!entry.isFile()||!ASSET.test(name)||files.length>=2048)throw fail('unexpected_output');const info=await stat(file);total+=info.size;
   if(info.size<1||info.size>536870912||total>maxBytes||(name.endsWith('.ts')&&info.size>8388608))throw fail('output_budget');
   const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
   const mime=name.endsWith('.m3u8')?'application/vnd.apple.mpegurl':name.endsWith('.ts')?'video/mp2t':'video/mp4';
   const item={name,bytes:info.size,sha256:hash.digest('hex'),mime};if(mime==='application/vnd.apple.mpegurl'){if(info.size>65536)throw fail('playlist_budget');item.playlist=await readFile(file,'utf8');validatePlaylist(item.playlist,name);}
   files.push(item);
  }}await walk(directory);return files.sort((a,b)=>a.name.localeCompare(b.name));
}
export function validatePlaylist(text,name){
 if(!text.startsWith('#EXTM3U\n')||text.length>65536||/[\u0000\r]/.test(text)||/#EXT-X-(KEY|MAP|SESSION-KEY|MEDIA|I-FRAME-STREAM-INF):/.test(text))throw fail('invalid_playlist');
 let refs=0;for(const line of text.split('\n')){if(!line)continue;if(line.startsWith('#')){if(!/^#(?:EXTM3U$|EXT-X-(?:VERSION:\d+|INDEPENDENT-SEGMENTS|STREAM-INF:BANDWIDTH=\d+,RESOLUTION=\d+x\d+,FRAME-RATE=[0-9.]+|TARGETDURATION:\d+|MEDIA-SEQUENCE:\d+|PLAYLIST-TYPE:VOD|ENDLIST)$|EXTINF:[0-9.]+,$)/.test(line))throw fail('unexpected_playlist_tag');continue;}const resolved=name==='master.m3u8'?line:`${name.split('/')[0]}/${line}`;if(!ASSET.test(resolved)||(!resolved.endsWith('.ts')&&!resolved.endsWith('/index.m3u8')))throw fail('invalid_playlist_uri');refs++;}
 if(!refs || (name!=='master.m3u8'&&!text.includes('#EXT-X-ENDLIST')))throw fail('incomplete_playlist');
}
export async function transcode(input,output,job,{signal,threads=2}={}){
 const media=await probe(input,{signal});if(media.duration>job.duration_max_seconds)throw fail('duration_budget');
 await mkdir(output,{recursive:true});const variants=ladder(media);let watchdogBusy=false,watchdogError;
 const budget=new AbortController();const abort=()=>budget.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const watchdog=setInterval(async()=>{if(watchdogBusy)return;watchdogBusy=true;try{let bytes=0;const count=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())await count(f);else bytes+=(await stat(f)).size;}};await count(output);if(bytes>job.output_max_bytes){watchdogError=fail('output_budget');budget.abort();}}catch{}finally{watchdogBusy=false;}},1000);
 try{
  for(const v of variants){const dir=path.join(output,`r${v.index}`);await mkdir(dir);
   const args=['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file','-threads',String(threads),'-i',input,'-map','0:v:0'];
   if(media.audio)args.push('-map','0:a:0');
   const toneMap=media.hdr?'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,':'';
   args.push('-sn','-dn','-map_metadata','-1','-vf',toneMap+`scale=${v.width}:${v.height}:flags=lanczos,setsar=1`,'-r',String(media.fps),'-c:v','libx264','-preset','veryfast','-crf','21','-profile:v','high','-pix_fmt','yuv420p','-maxrate',String(v.bitrate),'-bufsize',String(v.bitrate*2),'-threads',String(threads),'-force_key_frames','expr:gte(t,n_forced*4)','-sc_threshold','0');
   if(media.audio)args.push('-c:a','aac','-b:a','160k','-ar','48000','-ac','2');
   args.push('-max_muxing_queue_size','1024','-f','hls','-hls_time','4','-hls_list_size','0','-hls_playlist_type','vod','-hls_segment_type','mpegts','-hls_flags','independent_segments+temp_file','-hls_segment_filename',path.join(dir,'seg%05d.ts'),path.join(dir,'index.m3u8'));
   await command(process.env.FFMPEG_PATH||'ffmpeg',args,{signal:budget.signal});
  }
  const last=variants.at(-1);
  const encoded=await listAssets(output,job.output_max_bytes),existingBytes=encoded.reduce((n,a)=>n+a.bytes,0),lastBytes=encoded.filter(a=>a.name.startsWith(`r${last.index}/`)).reduce((n,a)=>n+a.bytes,0);
  // Faststart makes a temporary same-size copy. Reserve that peak before a
  // rapid remux can outrun the periodic output watchdog.
  if(existingBytes+lastBytes*2+1048576>job.output_max_bytes)throw fail('output_budget');
  await command(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,crypto','-i',path.join(output,`r${last.index}/index.m3u8`),'-map','0:v:0',...(media.audio?['-map','0:a:0']:[]),'-c','copy','-movflags','+faststart',path.join(output,'fallback.mp4')],{signal:budget.signal});
  let master='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n';
  for(const v of variants)master+=`#EXT-X-STREAM-INF:BANDWIDTH=${Math.ceil((v.bitrate+(media.audio?160000:0))*1.12)},RESOLUTION=${v.width}x${v.height},FRAME-RATE=${media.fps.toFixed(3)}\nr${v.index}/index.m3u8\n`;
  await writeFile(path.join(output,'master.m3u8'),master,{mode:0o600});
  const verified=await probe(path.join(output,'fallback.mp4'),{signal:budget.signal});
  if(verified.width!==last.width||verified.height!==last.height||Math.abs(verified.duration-media.duration)>Math.max(.25,2/media.fps))throw fail('output_validation');
  return {assets:await listAssets(output,job.output_max_bytes),media:{width:last.width,height:last.height,duration:verified.duration}};
 }catch(error){throw watchdogError||error;}finally{clearInterval(watchdog);signal?.removeEventListener('abort',abort);}
}
