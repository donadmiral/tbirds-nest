import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {serviceConfig} from './config.mjs';
import {backend} from './backend.mjs';
import {createWorker} from './worker.mjs';
const config=serviceConfig(),api=backend(config),worker=createWorker(api,config);
const stopping=new AbortController();
const authorized=value=>{const expected=`Bearer ${config.cronSecret}`;return typeof value==='string'&&Buffer.byteLength(value)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(value),Buffer.from(expected));};
const server=http.createServer(async(req,res)=>{
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 try{
  const path=new URL(req.url||'/','http://worker.internal').pathname;
  if(path==='/health'){json(200,{ok:!stopping.signal.aborted,profile:'hls-v2',busy:worker.active});return;}
  if(path==='/drain'&&['GET','POST'].includes(req.method)){
   if(!authorized(req.headers.authorization)){json(401,{error:'unauthorized'});return;}
   if(stopping.signal.aborted){json(503,{state:'stopping'});return;}
   // Work stays inside the request; no fire-and-forget job can be frozen at response.
   const result=await worker.drain(stopping.signal);json(result.state==='unavailable'||result.state==='retry'?503:200,result);return;
  }
  if(path==='/metrics'&&req.method==='GET'){if(!authorized(req.headers.authorization)){json(401,{error:'unauthorized'});return;}json(200,await api.rpc('media_rendition_health_v2',{},AbortSignal.timeout(5000)));return;}
  json(404,{error:'not_found'});
 }catch{if(!res.headersSent)json(503,{error:'temporarily_unavailable'});else res.destroy();}
});
server.requestTimeout=0;server.headersTimeout=10000;server.maxHeadersCount=50;
server.listen(Number(process.env.PORT)||8080,'0.0.0.0');
const stop=()=>{stopping.abort();server.close();setTimeout(()=>process.exit(0),25000).unref();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
