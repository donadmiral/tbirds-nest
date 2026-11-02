import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {statfs} from 'node:fs/promises';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {serviceConfig} from './config.mjs';
import {backend} from './backend.mjs';
import {createWorker} from './worker.mjs';
export function createWorkerHandler({config,api,worker,env=process.env,stopping=new AbortController(),
 dispatcherFactory=async()=>(await import('./sandbox-dispatcher.mjs')).configuredSandboxDispatcher(env),
 controllerMetrics=async()=>{const disk=await statfs(os.tmpdir());return{scratch_available_bytes:Number(disk.bavail)*Number(disk.bsize),process_rss_bytes:process.memoryUsage().rss};},
}){
let dispatcherPromise;
const sandboxMode=env.MEDIA_WORKER_RUNTIME==='sandbox';
const authorized=value=>{const expected=`Bearer ${config.cronSecret}`;return typeof value==='string'&&Buffer.byteLength(value)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(value),Buffer.from(expected));};
return async(req,res)=>{
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 try{
  const path=new URL(req.url||'/','http://worker.internal').pathname;
  if(path==='/health'){json(200,{ok:!stopping.signal.aborted,profile:'hls-v2',runtime:sandboxMode?'sandbox':'local',...(!sandboxMode?{busy:worker.active}:{})});return;}
  if(path==='/drain'&&['GET','POST'].includes(req.method)){
   if(!authorized(req.headers.authorization)){json(401,{error:'unauthorized'});return;}
   if(stopping.signal.aborted){json(503,{state:'stopping'});return;}
   if(sandboxMode){
    // The platform supplies a short-lived request OIDC token. Keep it scoped
    // to this invocation and fixed project; never copy it into the worker VM.
    const token=req.headers['x-vercel-oidc-token'];
    if(typeof token!=='string'){json(503,{state:'oidc_unavailable'});return;}
    const dispatcher=await(dispatcherPromise??=dispatcherFactory());
    const result=await dispatcher.tick(token);json(result.state==='launched'?202:200,result);return;
   }
   // Work stays inside the request; no fire-and-forget job can be frozen at response.
   const result=await worker.drain(stopping.signal);json(result.state==='unavailable'||result.state==='retry'?503:200,result);return;
  }
  if(path==='/metrics'&&req.method==='GET'){
   if(!authorized(req.headers.authorization)){json(401,{error:'unauthorized'});return;}
   const [host,status]=await Promise.all([controllerMetrics(),api.rpc('media_rendition_health_v2',{},AbortSignal.timeout(5000))]);
   if(sandboxMode){
    const dispatcher=await(dispatcherPromise??=dispatcherFactory());
    json(200,{...status,runtime:'sandbox',sandbox:await dispatcher.status(),
     controller:{role:'dispatcher',...host},
     worker_limits:{max_input_bytes:536870912,scratch_budget_bytes:2147483648,deadline_ms:720000,encoder_threads:2},
     encoder_measurements:null});return;
   }
   json(200,{...status,runtime:'local',host:{...host,scratch_budget_bytes:config.diskBudgetBytes,max_input_bytes:config.maxInputBytes,deadline_ms:config.deadlineMs,encoder_threads:config.threads}});return;
  }
  json(404,{error:'not_found'});
 }catch{if(!res.headersSent)json(503,{error:'temporarily_unavailable'});else res.destroy();}
};
}
function startServer(){
const config=serviceConfig(),api=backend(config),worker=createWorker(api,config),stopping=new AbortController();
const server=http.createServer(createWorkerHandler({config,api,worker,stopping}));
server.requestTimeout=0;server.headersTimeout=10000;server.maxHeadersCount=50;
server.listen(Number(process.env.PORT)||8080,'0.0.0.0');
const stop=()=>{stopping.abort();server.close();setTimeout(()=>process.exit(0),25000).unref();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startServer();
