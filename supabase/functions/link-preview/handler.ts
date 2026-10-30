import { plainHostname, previewUrl } from './networkPolicy.ts';
import { rasterMime, type FetchKind, type SafeResult } from './transport.ts';

export type PreviewRow = {
  url: string; title: string | null; description: string | null;
  image_url: string | null; domain: string | null; fetched_at: string;
  verified_at: string | null; image_origin_url: string | null; image_token: string;
};
type Dependencies = {
  base: string;
  authenticate: (authorization: string) => Promise<{id:string;anonymous?:boolean} | null>;
  read: (url: string) => Promise<PreviewRow | null>;
  save: (row: PreviewRow) => Promise<PreviewRow>;
  claim: (actor: string) => Promise<boolean>;
  image: (token: string) => Promise<string | null>;
  claimImage: (token: string) => Promise<boolean>;
  fetch: (url: string,kind: FetchKind,signal?: AbortSignal) => Promise<SafeResult>;
  now?: () => number;
  randomId?: () => string;
};
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
const PRIVATE = { ...CORS, 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (value: unknown,status = 200) => new Response(JSON.stringify(value),{status,headers:{...PRIVATE,'Content-Type':'application/json'}});
const error = (status: number) => json({error: status === 401 ? 'Sign in to load a link preview.' : status === 429 ? 'Please wait a moment before loading another preview.' : 'This link preview is unavailable.'},status);
class PreviewHttpError extends Error {constructor(readonly status: number){super('preview unavailable');}}

function decode(value: string | null,limit: number): string | null {
  if (!value) return null;
  const entities: Record<string,string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  const result = value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(whole,name: string) => {
    if (name[0] !== '#') return entities[name.toLowerCase()] || whole;
    const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2),16) : parseInt(name.slice(1),10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  }).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
  return result || null;
}

export function metadata(html: string,base: string) {
  const tags = new Map<string,string>();
  // Bounded input and bounded individual tags prevent pathological regex work.
  for(const match of html.matchAll(/<meta\s[^>]{0,8192}>/gi)) {
    const attributes: Record<string,string> = {};
    for(const attr of match[0].matchAll(/([a-z_:][-a-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))
      attributes[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4];
    const name = (attributes.property || attributes.name || '').toLowerCase();
    if (attributes.content && !tags.has(name)) tags.set(name,attributes.content);
  }
  const pick = (...keys: string[]) => keys.map(key=>tags.get(key)).find(Boolean) || null;
  const title = decode(pick('og:title','twitter:title') || html.match(/<title\b[^>]{0,1024}>([^<]{0,4096})<\/title>/i)?.[1] || null,200);
  const description = decode(pick('og:description','twitter:description','description'),300);
  let image: string | null = null;
  const raw = decode(pick('og:image:secure_url','og:image','twitter:image','twitter:image:src'),4096);
  if (raw) try { image = previewUrl(new URL(raw,base).href).href; } catch { /* text-only preview */ }
  return {title,description,image};
}

async function bodyUrl(req: Request): Promise<string> {
  const length = req.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length)>8192)) throw new Error('body');
  if (!req.body) throw new Error('body');
  const reader = req.body.getReader();const chunks: Uint8Array[] = [];let size=0;
  let timer: ReturnType<typeof setTimeout>;
  try {
    const read = async () => {
      for (;;) {
        const part=await reader.read();if(part.done)break;
        size+=part.value.byteLength;if(size>8192)throw new Error('body');chunks.push(part.value);
      }
      const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
      const data=JSON.parse(new TextDecoder().decode(bytes));
      if(typeof data?.url!=='string')throw new Error('body');
      return data.url.trim();
    };
    return await Promise.race([read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('body')),2000);})]);
  } finally {clearTimeout(timer!);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export function createLinkPreviewHandler(deps: Dependencies) {
  const now=deps.now || Date.now;
  const base=new URL(deps.base).origin;
  if(!base.startsWith('https://'))throw new Error('HTTPS backend required');
  const pending=new Map<string,Promise<PreviewRow>>();let imageRequests=0;
  type Raster={bytes:Uint8Array;mime:string;expires:number};
  const rasters=new Map<string,Raster>(),imagePending=new Map<string,Promise<Raster>>();let rasterBytes=0;
  const forgetRaster=(token:string)=>{const old=rasters.get(token);if(old)rasterBytes-=old.bytes.byteLength;rasters.delete(token);};
  const rememberRaster=(token:string,raster:Raster)=>{
    forgetRaster(token);
    while(rasters.size && (rasters.size>=24 || rasterBytes+raster.bytes.byteLength>12_000_000))forgetRaster(rasters.keys().next().value!);
    rasters.set(token,raster);rasterBytes+=raster.bytes.byteLength;
  };
  const imageUrl=(token: string)=>`${base}/functions/v1/link-preview?image=${token}`;
  const publicRow=(row: PreviewRow)=>({url:row.url,title:row.title,description:row.description,
    image_url:row.image_origin_url && ID.test(row.image_token) ? imageUrl(row.image_token) : null,
    domain:row.domain,fetched_at:row.fetched_at});
  return async (req: Request): Promise<Response> => {
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:PRIVATE});
    if(req.method==='GET') {
      const params=new URL(req.url).searchParams,token=(params.get('image') || '').toLowerCase();
      if(!ID.test(token)||params.getAll('image').length!==1||Array.from(params.keys()).some(key=>key!=='image'))return error(400);
      if(imageRequests>=12)return error(503);
      imageRequests++;
      try {
        let raster=rasters.get(token);
        if(raster && raster.expires<=now()){forgetRaster(token);raster=undefined;}
        if(!raster) {
          let work=imagePending.get(token);
          if(!work){
            work=(async()=>{
              const origin=await deps.image(token);if(!origin)throw new PreviewHttpError(404);
              if(!await deps.claimImage(token))throw new PreviewHttpError(429);
              const result=await deps.fetch(origin,'image',req.signal);
              const mime=rasterMime(result.bytes);if(!mime)throw new PreviewHttpError(422);
              const fresh={bytes:result.bytes,mime,expires:now()+300_000};rememberRaster(token,fresh);return fresh;
            })();
            imagePending.set(token,work);
            const current=work;void work.finally(()=>{if(imagePending.get(token)===current)imagePending.delete(token);}).catch(()=>{});
          }
          raster=await work;
        }else{rasters.delete(token);rasters.set(token,raster);}
        return new Response(new Uint8Array(raster.bytes),{headers:{...CORS,'Content-Type':raster.mime,'Content-Length':String(raster.bytes.byteLength),
          'Cache-Control':'public, max-age=3600','CDN-Cache-Control':'public, max-age=86400',
          'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cross-Origin-Resource-Policy':'cross-origin'}});
      } catch(failure) {return error(failure instanceof PreviewHttpError?failure.status:502);} finally {imageRequests--;}
    }
    if(req.method!=='POST')return error(405);
    const authorization=req.headers.get('Authorization') || '';
    if(!/^Bearer \S+$/i.test(authorization) || authorization.length>8192)return error(401);
    let user: Awaited<ReturnType<Dependencies['authenticate']>>;
    try {user=await deps.authenticate(authorization);} catch {return error(503);}
    if(!user || user.anonymous)return error(401);
    let raw: string,parsed: URL;
    try {raw=await bodyUrl(req);parsed=previewUrl(raw);} catch {return error(400);}
    let cached: PreviewRow | null=null;
    try {cached=await deps.read(raw);} catch { /* safe fetch can still provide a transient text preview */ }
    const verified=cached?.verified_at ? Date.parse(cached.verified_at) : NaN;
    if(cached?.url===raw && Number.isFinite(verified) && verified<=now()+60_000 && verified>now()-7*86400_000)
      return json(publicRow(cached));
    let work=pending.get(raw);
    if(!work) {
      if(pending.size>=12)return error(503);
      work=(async()=>{
        let allowed: boolean;
        try {allowed=await deps.claim(user.id);} catch {throw new PreviewHttpError(503);}
        if(!allowed)throw new PreviewHttpError(429);
        const result=await deps.fetch(parsed.href,'html',req.signal);
        const data=metadata(new TextDecoder().decode(result.bytes),result.url);
        const token=cached?.image_token && ID.test(cached.image_token)?cached.image_token:(deps.randomId || (()=>crypto.randomUUID()))();
        const row: PreviewRow={url:raw,title:data.title,description:data.description,
          image_url:data.image?imageUrl(token):null,image_origin_url:data.image,image_token:token,
          domain:plainHostname(parsed).replace(/^www\./,''),fetched_at:new Date(now()).toISOString(),verified_at:new Date(now()).toISOString()};
        try {return await deps.save(row);} catch {
          // A missing/unavailable cache never blocks publishing, and never
          // returns a thumbnail token which was not actually persisted.
          row.image_origin_url=null;row.image_url=null;
        }
        return row;
      })();
      pending.set(raw,work);
      const current=work;void work.finally(()=>{if(pending.get(raw)===current)pending.delete(raw);}).catch(()=>{});
    }
    try {return json(publicRow(await work));} catch(failure) {return error(failure instanceof PreviewHttpError?failure.status:502);}
  };
}
