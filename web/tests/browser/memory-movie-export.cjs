/** Actual React artwork + Chromium encoders + decoded media, using generated fixtures only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {compile}=require('./ui-compile.cjs');
const selected=process.env.MEMORY_QA_CASES?.split(','),runs=mode=>!selected||selected.includes(mode);
const root=path.resolve(__dirname,'../../..'),output=process.env.MEMORY_QA_OUTPUT||'/tmp/platinum-memory-movie-qa';fs.mkdirSync(output,{recursive:true});
const fixture=path.join(output,'fixture'),source=path.join(output,'source.mp4'),song=path.join(output,'voiceover.wav');
const imageFixtures=path.join(__dirname,'../fixtures/export-images');
const imageAssets=new Map([
 ['/animated-photo.jpg',{file:path.join(imageFixtures,'animated.png'),type:'image/png'}],
 ['/animated-sticker.png',{file:path.join(imageFixtures,'animated.webp'),type:'image/webp'}],
 ['/animated-background.jpg',{file:path.join(imageFixtures,'animated.gif'),type:'image/gif'}],
 ['/static-photo.jpg',{file:path.join(imageFixtures,'static.png'),type:'image/png'}],
 ['/static-sticker.png',{file:path.join(imageFixtures,'static.webp'),type:'image/webp'}],
 ['/slow-photo.png',{file:path.join(imageFixtures,'static.png'),type:'image/png',slow:true}],
]);
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=red:s=320x180:r=30:d=3','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=3','-vf',"drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill,drawbox=x=0:y=0:w=320:h=180:color=white:t=fill:enable='lt(t,0.4)'",'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1.4','-af',"volume=0:enable='lt(t,0.4)'",song]);
const mime=file=>file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.mp4')?'video/mp4':file.endsWith('.m4a')?'audio/mp4':file.endsWith('.wav')?'audio/wav':'text/html';
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://local').pathname;
 const asset=imageAssets.get(pathname),file=asset?.file||(pathname==='/source.mp4'?source:pathname==='/voiceover.wav'?song:pathname==='/audio/platinum-memory-score.m4a'?path.join(root,'web/public/audio/platinum-memory-score.m4a'):pathname==='/'?path.join(fixture,'index.html'):path.join(fixture,pathname.slice(1)));
 if(!asset&&!file.startsWith(fixture)&&![source,song,path.join(root,'web/public/audio/platinum-memory-score.m4a')].includes(file)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 const body=fs.readFileSync(file),headers={'Content-Type':asset?.type||mime(file),'Accept-Ranges':'bytes'},range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
 if(asset?.slow){res.writeHead(200,{...headers,'Content-Length':body.length});res.write(body.subarray(0,8));const timer=setTimeout(()=>res.end(body.subarray(8)),30000);res.on('close',()=>clearTimeout(timer));return;}
 if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):body.length-1,body.length-1);if(start>end||start>=body.length){res.writeHead(416,{...headers,'Content-Range':`bytes */${body.length}`});res.end();return;}res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${body.length}`});res.end(body.subarray(start,end+1));return;}
 res.writeHead(200,{...headers,'Content-Length':body.length});res.end(body);
});
const probe=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,codec_type,width,height,duration','-of','json',file],{encoding:'utf8'}));
const samples=(file,start,duration=.4)=>execFileSync('ffmpeg',['-v','error','-ss',String(start),'-i',file,'-t',String(duration),'-vn','-af','pan=mono|c0=c0','-f','f32le','-ac','1','-ar','48000','-'],{maxBuffer:5e6});
function rms(data){if(!data.length)return 0;let sum=0;for(let i=0;i+4<=data.length;i+=4)sum+=data.readFloatLE(i)**2;return Math.sqrt(sum/(data.length/4));}
function frequency(data,hz){if(!data.length)return 0;let a=0,b=0,n=data.length/4;for(let i=0;i<n;i++){const x=data.readFloatLE(i*4),angle=2*Math.PI*hz*i/48000;a+=x*Math.sin(angle);b+=x*Math.cos(angle);}return 2*Math.sqrt(a*a+b*b)/n;}
const frame=(file,time)=>execFileSync('ffmpeg',['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:5e6});
const pixel=(data,x,y)=>[...data.subarray((Math.floor(y*1280)*720+Math.floor(x*720))*3,(Math.floor(y*1280)*720+Math.floor(x*720))*3+3)];
(async()=>{
 await compile({entry:path.join(__dirname,'memory-movie-fixture.tsx'),output:fixture,aliases:{[path.join(root,'web/lib/supabase/client.ts')]:path.join(__dirname,'memory-movie-auth-adapter.ts'),'@/lib/supabase/client':path.join(__dirname,'memory-movie-auth-adapter.ts')},title:'Synthetic memory movie verification'});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({executablePath:process.env.STORY_QA_CHROME,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:960}}),errors=[],receipt={browser:await browser.version(),cases:[]};page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.qaAudio=[];window.qaTracks=[];window.qaImageInspectionStarted=false;window.qaImageInspectionAborted=false;const Audio=window.AudioContext,Recorder=window.MediaRecorder,nativeFetch=window.fetch;window.AudioContext=class extends Audio{constructor(...args){super(...args);window.qaAudio.push(this);}};window.MediaRecorder=class extends Recorder{constructor(stream,...args){super(stream,...args);window.qaTracks.push(...stream.getTracks());}};window.fetch=(url,options)=>{if(String(url).includes('/slow-photo.png')){window.qaImageInspectionStarted=true;options?.signal?.addEventListener('abort',()=>{window.qaImageInspectionAborted=true;});}return nativeFetch(url,options);};});
  for(const mode of ['original','silent','score','local_once','local_loop','static_images'].filter(runs)){
   await page.goto(base+'/?mode='+mode);await page.getByRole('button',{name:'Create movie',exact:true}).waitFor();
   if(mode.startsWith('local')){await page.locator('input[type=file]').setInputFiles(song);await page.getByText('voiceover.wav',{exact:true}).waitFor();await page.getByRole('spinbutton',{name:'Start at (seconds)'}).fill('.4');if(mode==='local_loop')await page.getByLabel('Loop the selected excerpt until the movie ends').check();}
   if(mode==='local_loop')await page.screenshot({path:path.join(output,'download-options.png')});
   await page.getByRole('button',{name:'Create movie',exact:true}).click();
   await page.getByRole('button',{name:'Download movie',exact:true}).waitFor({timeout:60000});
   const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download movie',exact:true}).click()]);const result={name:download.suggestedFilename()};
   const file=path.join(output,mode+path.extname(result.name));await download.saveAs(file);result.bytes=fs.readFileSync(file);const meta=probe(file),video=meta.streams.find(v=>v.codec_type==='video'),audio=meta.streams.find(v=>v.codec_type==='audio');
   assert.equal(video.width,720);assert.equal(video.height,1280);assert.equal(!!audio,mode!=='silent');const duration=Number(meta.format.duration);assert.ok(duration>=6.9&&duration<7.45,'all three memories and trimmed speed have correct duration '+duration);
   const trimmed=pixel(frame(file,3.08),.25,.5);assert.ok(trimmed[0]>100&&trimmed[0]<155&&trimmed[1]<12&&trimmed[2]<12,'trimmed white introduction is absent '+trimmed);const first=pixel(frame(file,.5),.5,.2),timed=pixel(frame(file,1.5),.15,.8),untimed=pixel(frame(file,2.5),.15,.8),red=pixel(frame(file,3.3),.25,.5),blue=pixel(frame(file,3.3),.75,.5),last=pixel(frame(file,5.2),.15,.15);
   assert.ok(first[0]>220&&first[1]>160&&first[2]<90,'first photograph '+first);if(mode==='static_images')assert.ok(timed[0]<40&&timed[1]>65&&timed[1]<100&&timed[2]>150&&timed[2]<180,'static WebP layer survives inspection '+timed);else assert.ok(timed[1]>220&&timed[0]<20,'timed layer '+timed);assert.ok(untimed[0]>210&&untimed[1]<210,'timed layer ends '+untimed);
   assert.ok(red[0]>100&&red[0]<155&&red[1]<12&&red[2]<12,'video trim and grade '+red);assert.ok(blue[2]>100&&blue[2]<155&&blue[0]<12&&blue[1]<12,'video blue grade '+blue);assert.ok(last[2]>75&&last[2]<110&&last[0]<40&&last[1]>50&&last[1]<85,'last text memory '+last);
   let sound=null;
   if(audio){const before=samples(file,.15),during=samples(file,3.25),after=samples(file,5.2);sound={before:rms(before),during:rms(during),after:rms(after),voiceBefore:frequency(before,440),voiceAfter:frequency(after,440),originalDuring:frequency(during,880)};
    if(mode==='original'){assert.ok(sound.before<.001&&sound.after<.001,'no original audio leaks outside source page');assert.ok(sound.during>.02&&sound.during<.055,'original level preserved '+sound.during);}
    if(mode==='score')assert.ok(sound.before>.003&&sound.after>.003,'original score runs continuously');
    if(mode.startsWith('local')){assert.ok(sound.voiceBefore>.06,'local recording starts from selected offset '+sound.voiceBefore);assert.ok(sound.originalDuring>.03,'source audio is mixed '+sound.originalDuring);if(mode==='local_once')assert.ok(sound.voiceAfter<.003,'voiceover stops instead of looping');else assert.ok(sound.voiceAfter>.06,'selected local excerpt loops');}
   }
   const cleanup=await page.evaluate(()=>({audioClosed:window.qaAudio.every(context=>context.state==='closed'),tracksEnded:window.qaTracks.every(track=>track.readyState==='ended')}));assert.equal(cleanup.audioClosed,true);assert.equal(cleanup.tracksEnded,true);
   receipt.cases.push({mode,bytes:result.bytes.length,codec:video.codec_name,duration,dimensions:[video.width,video.height],trimmed,first,timed,untimed,red,blue,last,sound,...cleanup});
   if(mode==='local_loop'){await page.screenshot({path:path.join(output,'download-ready.png')});execFileSync('ffmpeg',['-v','error','-y','-ss','1.5','-i',file,'-frames:v','1',path.join(output,'decoded-photo-artwork.png')]);execFileSync('ffmpeg',['-v','error','-y','-ss','3.3','-i',file,'-frames:v','1',path.join(output,'decoded-video-grade.png')]);}
  }
  if(runs('automatic')){
   await page.goto(base+'/?mode=automatic');await page.getByRole('button',{name:'Create movie',exact:true}).click();
   await page.getByRole('button',{name:'Download movie',exact:true}).waitFor({timeout:60000});
   const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download movie',exact:true}).click()]);
   const file=path.join(output,'automatic'+path.extname(download.suggestedFilename()));await download.saveAs(file);const meta=probe(file),duration=Number(meta.format.duration),video=meta.streams.find(stream=>stream.codec_type==='video');
   assert.equal(video.width,720);assert.equal(video.height,1280);assert.ok(duration>=12.0&&duration<12.55,'opening/closing titles and automatic pacing are encoded '+duration);
   const title=frame(file,1.2),closing=frame(file,11.3),start=pixel(frame(file,.02),.1,.1),photo=pixel(frame(file,3.2),.5,.2),timed=pixel(frame(file,4.0),.15,.8),clip=pixel(frame(file,6.95),.25,.5),text=pixel(frame(file,8.5),.15,.15);
   const writing=data=>{let count=0;for(let i=0;i<data.length;i+=3)if(data[i]>180&&data[i+1]>180&&data[i+2]>180)count++;return count;};
   assert.ok(writing(title)>500&&writing(closing)>500,'both title cards contain actual writing');assert.ok(Math.max(...start)<50,'opening title fades from black '+start);
   assert.ok(photo[0]>210&&photo[1]>150&&photo[2]<100,'automatic photo remains present '+photo);assert.ok(timed[1]>200&&timed[0]<40,'photo timed layer uses planned scene time '+timed);
   assert.ok(clip[0]>100&&clip[0]<160&&clip[1]<15,'automatic video retains trim/speed/grade '+clip);assert.ok(text[2]>75&&text[2]<110,'text scene stays ordered '+text);
   const sound={before:rms(samples(file,1.0)),original:frequency(samples(file,6.9),880),after:rms(samples(file,8.4))};assert.ok(sound.before<.001&&sound.after<.001&&sound.original>.03,'original audio stays in its automatic scene '+JSON.stringify(sound));
   assert.equal(await page.evaluate(()=>window.qaAudio.every(context=>context.state==='closed')&&window.qaTracks.every(track=>track.readyState==='ended')),true);
   await page.screenshot({path:path.join(output,'automatic-ready.png')});receipt.cases.push({mode:'automatic',duration,dimensions:[video.width,video.height],titlePixels:writing(title),closingPixels:writing(closing),start,photo,timed,clip,text,sound});
  }
  for(const mode of ['revoked','changed','account_roundtrip'].filter(runs)){
   await page.goto(base+'/?mode='+mode);await page.getByRole('button',{name:'Create movie',exact:true}).click();
   if(mode==='account_roundtrip'){
    await page.getByRole('progressbar',{name:'Rendering movie',exact:true}).waitFor({timeout:45000});
    await page.evaluate(()=>{window.movieAuth('cccccccc-cccc-4ccc-8ccc-cccccccccccc');window.movieAuth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');});
    await page.getByText(/Your account changed/).waitFor();
   }else{
    await page.getByRole('button',{name:'Download movie',exact:true}).waitFor({timeout:60000});
    await page.evaluate(mode=>{if(mode==='revoked')window.movieBook.can_view=false;else window.movieBook.presentation_revision++;},mode);
    let downloaded=false;const listener=()=>{downloaded=true;};page.on('download',listener);
    await page.getByRole('button',{name:'Download movie',exact:true}).click();await page.getByText(mode==='revoked'?/no longer available/:/changed during export/).waitFor();page.off('download',listener);assert.equal(downloaded,false);
   }
   assert.equal(await page.getByRole('button',{name:'Download movie',exact:true}).count(),0);await page.waitForFunction(()=>window.qaAudio.every(context=>context.state==='closed')&&window.qaTracks.every(track=>track.readyState==='ended'));
   receipt.cases.push({mode,noDownloadAfterInvalidation:true,resourcesClosed:true});
  }
  for(const mode of ['cancel','call','hidden','unmount','missing','overflow','animated_primary','animated_sticker','animated_background','animated_data','image_inspection_cancel'].filter(runs)){
   const animated=mode.startsWith('animated_'),imageCancel=mode==='image_inspection_cancel';
   const extra=mode==='animated_data'?'&asset='+encodeURIComponent('data:image/png;base64,'+fs.readFileSync(path.join(imageFixtures,'animated.png')).toString('base64')):'';
   await page.goto(base+'/?mode='+mode+extra);await page.getByRole('button',{name:'Create movie',exact:true}).click();
   if(!animated&&!imageCancel&&mode!=='missing'&&mode!=='overflow')await page.getByRole('progressbar',{name:'Rendering movie',exact:true}).waitFor({timeout:45000});
   if(imageCancel){await page.waitForFunction(()=>window.qaImageInspectionStarted);await page.getByRole('button',{name:'Cancel export',exact:true}).click();}
   if(mode==='cancel')await page.getByRole('button',{name:'Cancel export',exact:true}).click();
   if(mode==='call')await page.evaluate(()=>{document.documentElement.dataset.platinumCallActive='true';});
   if(mode==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
   if(mode==='unmount')await page.evaluate(()=>window.movieQA.close());
   if(mode==='unmount')await page.getByRole('dialog',{name:'Download memory movie',exact:true}).waitFor({state:'detached'});else await page.getByText(mode==='cancel'||imageCancel?/Export cancelled\./:animated?/Animated image files and GIFs cannot be exported/:mode==='call'?/stopped for a call/:mode==='hidden'?/tab was hidden/:mode==='overflow'?/text that is too long/:/image could not be downloaded/).waitFor({timeout:30000});
   assert.equal(await page.getByRole('button',{name:'Download movie',exact:true}).count(),0);await page.waitForFunction(()=>window.qaAudio.every(context=>context.state==='closed')&&window.qaTracks.every(track=>track.readyState==='ended'),{},{timeout:5000});
   const imageProof=animated?{rejectedBeforeRecording:await page.evaluate(()=>window.qaTracks.length===0)}:imageCancel?{imageReadAborted:await page.evaluate(()=>window.qaImageInspectionAborted)}:{};for(const value of Object.values(imageProof))assert.equal(value,true);
   receipt.cases.push({mode,noPartialDownload:true,resourcesClosed:true,...imageProof});
   if(mode==='animated_primary')await page.screenshot({path:path.join(output,'animated-image-refused.png')});
  }
  await page.goto(base);const limits=await page.evaluate(()=>{const api=window.movieQA,p=api.pages[0];return{gif:api.memoryMovieLimit([{...p,stickers:[{kind:'gif'}]}]),animated:api.memoryMovieLimit([{...p,stickers:[{kind:'text',anim:'bounce'}]}]),nested:api.memoryMovieLimit([{...p,stickers:[{kind:'post',postMediaType:'video'}]}]),dual:api.memoryMovieLimit([{...p,dual_front_url:'second.mp4'}]),savedAudio:api.memoryMovieLimit([{...p,audio_url:'saved.m4a'}]),soundtrack:api.memoryMovieLimit([p],{soundId:'catalogue'}),missing:api.memoryMovieLimit([{...p,media_url:null}]),tooMany:api.memoryMovieLimit(Array(81).fill(p))};});for(const [key,value]of Object.entries(limits))assert.ok(value,key+' must refuse');receipt.cases.push({mode:'unsupported_composition',limits});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'download-mobile.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
  await page.getByRole('button',{name:'Close movie download',exact:true}).click();await page.getByRole('button',{name:'Open memory film',exact:true}).click();await page.getByRole('button',{name:'Download memory movie',exact:true}).click();await page.getByRole('dialog',{name:'Download memory movie',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Download memory movie',exact:true}).waitFor({state:'detached'});assert.equal(await page.getByRole('button',{name:'Play memory film',exact:true}).count(),1,'film stays paused after export exit');receipt.cases.push({mode:'film_entry_exit',keepsPaused:true,mobileNoOverflow:true});
  assert.deepEqual(errors,[]);receipt.consoleErrors=errors;fs.writeFileSync(path.join(output,'browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
