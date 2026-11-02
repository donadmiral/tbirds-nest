import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {getCache} from '@vercel/functions';
import {backend} from '../../media-renditions/backend.mjs';
import {encryptedCache} from '../../media-renditions/cache.mjs';
import {createGateway} from '../../media-renditions/gateway.mjs';
let gateway;
export default async function playback(req,res){
 const controller=new AbortController(),closed=()=>{if(!res.writableFinished)controller.abort();};res.on('close',closed);
 try{
  // Use a native Vercel Function so Runtime Cache has a supported request
  // context. The FFmpeg container handles compute only, not cache authority.
  if(!gateway){const base=new URL(process.env.SUPABASE_URL).origin,secret=process.env.MEDIA_CAPABILITY_SECRET;
   if(!process.env.SUPABASE_SERVICE_ROLE_KEY&&(!process.env.MEDIA_BROKER_URL||!process.env.MEDIA_BROKER_KEY))throw new Error('missing_server_credentials');
   gateway=createGateway(backend({base,key:process.env.SUPABASE_SERVICE_ROLE_KEY,brokerUrl:process.env.MEDIA_BROKER_URL,brokerKey:process.env.MEDIA_BROKER_KEY}),{
    cache:encryptedCache(getCache(),secret,base),secret,publicOrigin:process.env.MEDIA_PUBLIC_ORIGIN});
  }
  const url=new URL(req.url,process.env.MEDIA_PUBLIC_ORIGIN);
  if(url.pathname==='/api/playback'){const path=url.searchParams.get('path');if(!path)throw new Error('missing_path');url.pathname='/playback/'+path;url.searchParams.delete('path');}
  const request=new Request(url,{method:req.method,headers:req.headers,signal:controller.signal});
  const response=await gateway(request);res.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body)await pipeline(Readable.fromWeb(response.body),res);else res.end();
 }catch{if(!res.headersSent){res.writeHead(503,{'Cache-Control':'private, no-store'});res.end();}else res.destroy();}
 finally{res.off('close',closed);}
}
