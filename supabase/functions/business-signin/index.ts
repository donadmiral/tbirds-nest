import { createClient } from 'jsr:@supabase/supabase-js@2.111.0';
const svc=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type,apikey,x-client-info'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='POST')return json({error:'POST required'},405);
 try{
  const {handle,code,device_id,device_label}=await req.json();
  if(typeof handle!=='string'||typeof code!=='string'||typeof device_id!=='string'||code.length>200||device_id.length>200)return json({error:'Business handle, code and device are required.'},400);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code.trim().toUpperCase()));
  const codeHash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const checked=await svc.rpc('triniti_business_signin_check',{p_handle:handle.trim().toLowerCase().replace(/^@/,''),p_code_hash:codeHash,p_device:device_id,p_label:typeof device_label==='string'?device_label:'Company device'});
  if(checked.error)return json({error:'Business sign-in is unavailable.'},503);
  const access=checked.data;
  if(access?.allowed!==true)return json({error:access?.error==='DEVICE_APPROVAL_REQUIRED'?'Ask a business administrator to approve this device.':access?.error==='TRY_LATER'?'Too many sign-in attempts. Try again later.':'Business access was not accepted.'},access?.error==='TRY_LATER'?429:403);
  const identity=await svc.auth.admin.getUserById(access.business_id);const email=identity.data.user?.email;
  if(identity.error||!email)return json({error:'Business identity is unavailable.'},503);
  const link=await svc.auth.admin.generateLink({type:'magiclink',email});
  if(link.error||!link.data.properties?.hashed_token)return json({error:'Business sign-in could not start.'},503);
  return json({token_hash:link.data.properties.hashed_token,email,business_name:access.business_name,member_name:access.member_name});
 }catch{return json({error:'Business sign-in is unavailable.'},503);}
});
