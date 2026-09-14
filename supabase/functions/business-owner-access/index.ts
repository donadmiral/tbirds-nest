import { createClient } from 'jsr:@supabase/supabase-js@2.111.0';
const svc=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type,apikey,x-client-info'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return json({error:'POST required'},405);
 try{
  const token=/^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization')||'')?.[1];if(!token)return json({error:'Sign in first.'},401);
  const user=await svc.auth.getUser(token);if(user.error||!user.data.user)return json({error:'Sign in again.'},401);
  const verified=await svc.auth.getClaims(token);const claims=verified.data?.claims;
  if(verified.error||claims?.sub!==user.data.user.id||typeof claims.session_id!=='string')return json({error:'Sign in again.'},401);
  const body=await req.json();if(typeof body.application_id!=='string'||! /^[0-9a-f-]{36}$/i.test(body.application_id))return json({error:'Application required.'},400);
  const access=await svc.rpc('triniti_business_owner_access',{p_user_id:user.data.user.id,p_session_id:claims.session_id,p_application_id:body.application_id});
  if(access.error||!access.data?.business_id)return json({error:'Business owner access is unavailable.'},403);
  const identity=await svc.auth.admin.getUserById(access.data.business_id);const email=identity.data.user?.email;
  if(identity.error||!email)return json({error:'Business identity is unavailable.'},503);
  const link=await svc.auth.admin.generateLink({type:'magiclink',email});
  if(link.error||!link.data.properties?.hashed_token)return json({error:'Business sign-in could not start.'},503);
  return json({token_hash:link.data.properties.hashed_token});
 }catch{return json({error:'Business access is unavailable.'},503);}
});
