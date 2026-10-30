/** Real codec/GPU/artwork integration check. Run with STORY_QA_CHROME pointing at Chrome for Testing. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{execFileSync}=require('node:child_process'),ts=require('typescript'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../../..'),output=process.env.STORY_QA_OUTPUT||'/tmp/platinum-video-qa';fs.mkdirSync(output,{recursive:true});
const source=path.join(output,'source.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=red:s=320x180:r=30:d=3','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=3','-vf','drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
const sources=['shared/storyFilterAppearance.ts','shared/storyColorMatrix.ts','shared/storyVideoComposition.ts','web/lib/recordedWebm.ts','web/lib/storyVideoExport.ts'];
const factories=sources.map(file=>JSON.stringify(file)+':function(module,exports,require){'+ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'}').join(',');
const bundle=`const factories={${factories}},cache={};function load(file){if(cache[file])return cache[file].exports;const module={exports:{}};cache[file]=module;factories[file](module,module.exports,name=>{const bits=(file.slice(0,file.lastIndexOf('/')+1)+name).split('/'),out=[];for(const bit of bits){if(bit==='..')out.pop();else if(bit!=='.')out.push(bit);}return load(out.join('/')+'.ts');});return module.exports;}window.videoExport=load('web/lib/storyVideoExport.ts');window.recipe=load('shared/storyVideoComposition.ts');`;
const html='<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#222;color:#fff;font:16px Arial}#art{position:relative;width:320px;height:568px;background:transparent}#tag{position:absolute;left:20px;top:470px;width:160px;height:42px;background:#00ff00;color:#000;font:22px Arial;padding:4px}button{font:20px Arial;padding:20px}</style><button id="save">Render edited video</button><div id="art"><div id="tag">PLATINUM</div><svg width="0" height="0"><defs><filter id="fixture-grade" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".5 0 0 0 0 0 .5 0 0 0 0 0 .5 0 0 0 0 0 1 0"/></filter></defs></svg><div style="position:absolute;left:220px;top:470px;width:80px;height:60px;filter:url(#fixture-grade)"><img alt="" style="width:100%;height:100%" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2260%22%3E%3Cpath fill=%22%2300ffff%22 d=%22M0 0h80v60H0z%22/%3E%3C/svg%3E"/></div></div><script>'+bundle+'</script>';
const server=http.createServer((req,res)=>{if(req.url==='/source.mp4'){const body=fs.readFileSync(source);res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':body.length});res.end(body);}else {res.writeHead(200,{'Content-Type':'text/html'});res.end(html);}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const browser=await chromium.launch({executablePath:process.env.STORY_QA_CHROME,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 try {
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${port}`);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const receipt={browser:await browser.version(),cases:[]};
  for(const mode of ['graded_audio','muted','cancelled']){
   await page.evaluate(mode=>{window.result=null;window.failure=null;document.querySelector('#save').onclick=()=>{
    const abort=new AbortController(),r=window.recipe.storyVideoRecipe({duration:3,width:320,height:568,transform:{fit:'contain',trimStart:.4,trimEnd:2.4,speed:2,mix:{orig:mode==='muted'?0:40},adjust:{bri:-100}}});
    window.videoExport.exportStoryVideo({url:'/source.mp4',recipe:r,signal:abort.signal,progress(){},capture:async()=>{
     const image=await window.videoExport.captureStoryArtwork(document.querySelector('#art'),r.width,r.height,abort.signal),background=document.createElement('canvas');window.artworkPixel=[...image.getContext('2d').getImageData(Math.floor(r.width*.1),Math.floor(r.height*.85),1,1).data];window.artworkPNG=image.toDataURL();background.width=r.width;background.height=r.height;const ctx=background.getContext('2d');ctx.fillStyle='#112233';ctx.fillRect(0,0,r.width,r.height);return{background,layers:[{image,start:0,end:.5}]};
    }}).then(async result=>{window.result={bytes:Array.from(new Uint8Array(await result.blob.arrayBuffer())),type:result.blob.type,extension:result.extension,duration:result.duration};},error=>{window.failure=error.message;});
    if(mode==='cancelled')setTimeout(()=>abort.abort(),100);
   };},mode);
   await page.click('#save');await page.waitForFunction(()=>window.result||window.failure,{},{timeout:45000});
   const result=await page.evaluate(()=>({result:window.result,failure:window.failure,artworkPixel:window.artworkPixel,artworkPNG:window.artworkPNG}));if(result.artworkPNG)fs.writeFileSync(path.join(output,'artwork.png'),Buffer.from(result.artworkPNG.split(',')[1],'base64'));console.log('artwork pixel',mode,result.artworkPixel);
   if(mode==='cancelled'){assert.match(result.failure,/cancelled/);receipt.cases.push({mode,cancelled:true});continue;}
   assert.equal(result.failure,null);assert.ok(result.result.bytes.length>1024);
   const file=path.join(output,mode+'.'+result.result.extension);fs.writeFileSync(file,Buffer.from(result.result.bytes));
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,codec_type,width,height,duration','-of','json',file],{encoding:'utf8'}));
   const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
   assert.ok(video);assert.equal(video.height,1918);assert.equal(video.width,1080);assert.equal(!!audio,mode==='graded_audio');
   const duration=Number(probe.format.duration);assert.ok(duration>.8&&duration<1.4,'trim/speed duration '+duration);
   const frame=time=>execFileSync('ffmpeg',['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:10*1024*1024});
   const before=frame(.2),after=frame(.8),pixel=(data,x,y)=>[...data.subarray((Math.floor(y*video.height)*video.width+Math.floor(x*video.width))*3,(Math.floor(y*video.height)*video.width+Math.floor(x*video.width))*3+3)];
   const swatch=pixel(before,.8,.85);assert.ok(swatch[0]<12&&swatch[1]>100&&swatch[1]<150&&swatch[2]>100&&swatch[2]<150,'embedded image and SVG pixel grade '+swatch);
   const red=pixel(before,.25,.5),blue=pixel(before,.75,.5),tagBefore=pixel(before,.1,.85),tagAfter=pixel(after,.1,.85);
   assert.ok(red[0]>100&&red[0]<155&&red[1]<12&&red[2]<12,'actual red pixel grade '+red);
   assert.ok(blue[2]>100&&blue[2]<155&&blue[0]<12&&blue[1]<12,'actual blue pixel grade '+blue);
   assert.ok(tagBefore[1]>230&&tagBefore[0]<20,'timed artwork visible '+tagBefore);
   assert.ok(tagAfter[1]<70,'timed artwork disappears '+tagAfter);
   let rms=null;if(audio){const samples=execFileSync('ffmpeg',['-v','error','-i',file,'-vn','-f','f32le','-ac','1','-'],{maxBuffer:2*1024*1024});let sum=0,n=0;for(let i=0;i+4<=samples.length;i+=4){const x=samples.readFloatLE(i);sum+=x*x;n++;}rms=Math.sqrt(sum/n);assert.ok(rms>.02&&rms<.055,'original sound at selected mix '+rms);}
   receipt.cases.push({mode,bytes:result.result.bytes.length,mime:result.result.type,codec:video.codec_name,width:video.width,height:video.height,duration,hasAudio:!!audio,audioRms:rms,red,blue,tagBefore,tagAfter,gradedImageSticker:swatch});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
