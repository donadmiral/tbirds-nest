import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {clipBackend} from './backend.mjs';
import {createClipWorker} from './worker.mjs';
export function workerHandler({worker,api,secret,stopping=new AbortController()}){
 if(typeof secret!=='string'||secret.length<32)throw Error('clip_cron_secret_required');
 const expected=Buffer.from('Bearer '+secret);let maintaining=false;
 return async(req,res)=>{
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  let url;try{url=new URL(req.url||'/','http://worker.internal');}catch{json(400,{error:'invalid_request'});return;}
  if(req.method==='GET'&&url.pathname==='/health'){json(200,{ok:!stopping.signal.aborted,busy:worker.active||maintaining,profile:'live-clips-v1'});return;}
  if(req.method!=='POST'||url.pathname!=='/drain'){json(404,{error:'not_found'});return;}
  const supplied=Buffer.from(req.headers.authorization||'');if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){json(401,{error:'unauthorized'});return;}
  if(stopping.signal.aborted){json(503,{state:'stopping'});return;}
  if(worker.active||maintaining){json(200,{state:'busy'});return;}
  try{
   maintaining=true;await api.maintain(AbortSignal.any([stopping.signal,AbortSignal.timeout(20000)]));maintaining=false;
   const result=await worker.drain(stopping.signal);json(['unavailable','retry'].includes(result.state)?503:200,result);
  }catch{json(503,{state:'unavailable'});}finally{maintaining=false;}
 };
}
export function startWorker(env=process.env){
 const port=env.PORT===undefined||env.PORT===''?8080:Number(env.PORT);
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('clip_worker_port_invalid');
 const api=clipBackend({base:env.SUPABASE_URL,secret:env.LIVE_CLIP_WORKER_SECRET,cdnOrigin:env.LIVE_HLS_CDN_ORIGIN});
 const worker=createClipWorker(api),stopping=new AbortController(),server=http.createServer(workerHandler({api,worker,secret:env.LIVE_CLIP_CRON_SECRET,stopping}));
 server.requestTimeout=270000;server.headersTimeout=10000;server.maxHeadersCount=30;server.listen(port,'0.0.0.0');
 const stop=()=>{stopping.abort();server.close();setTimeout(()=>process.exit(0),15000).unref();};process.once('SIGTERM',stop);process.once('SIGINT',stop);return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startWorker();
