import { serveBusinessRequest } from '../_shared/serveBusinessRequest.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createLinkPreviewHandler } from './handler.ts';
import { createSafeFetch } from './transport.ts';
import { createDenoPinnedRequest } from './denoTransport.ts';

const base=Deno.env.get('SUPABASE_URL')!;
const client=createClient(base,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
  auth:{persistSession:false,autoRefreshToken:false},
});
const fields='url,title,description,image_url,domain,fetched_at,verified_at,image_origin_url,image_token';
serveBusinessRequest(createLinkPreviewHandler({
  base,fetch:createSafeFetch({request:createDenoPinnedRequest()}),
  async authenticate(authorization) {
    const {data,error}=await client.auth.getUser(authorization.replace(/^Bearer\s+/i,''));
    return error || !data.user ? null : {id:data.user.id,anonymous:data.user.is_anonymous};
  },
  async read(url) {
    const {data,error}=await client.from('link_previews').select(fields).eq('url',url).maybeSingle();
    if(error)throw new Error('Preview cache unavailable');return data;
  },
  async save(row) {
    const {data,error}=await client.rpc('store_verified_link_preview',{
      p_url:row.url,p_title:row.title,p_description:row.description,
      p_image_origin_url:row.image_origin_url,p_domain:row.domain,p_backend_origin:new URL(base).origin,
    });
    if(error || !data)throw new Error('Preview cache unavailable');return data;
  },
  async claim(actor) {
    const {data,error}=await client.rpc('claim_link_preview_fetch',{p_actor:actor});
    if(error)throw new Error('Preview budget unavailable');return data===true;
  },
  async image(token) {
    const {data,error}=await client.from('link_previews').select('image_origin_url').eq('image_token',token).not('verified_at','is',null).maybeSingle();
    if(error)throw new Error('Preview cache unavailable');return data?.image_origin_url || null;
  },
  async claimImage(token) {
    const {data,error}=await client.rpc('claim_link_preview_image',{p_token:token});
    if(error)throw new Error('Preview budget unavailable');return data===true;
  },
}), request => request.method === 'POST');
