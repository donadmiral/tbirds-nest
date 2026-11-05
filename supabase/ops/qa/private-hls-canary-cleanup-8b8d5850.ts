// Expiring exact-source cleanup for one controlled QA fixture only.
const base = "https://uaulhuelcfkjwojtymmw.supabase.co";
const owner = "aca11d41-fc99-457a-8152-c4dfc9fcc9ed";
const marker = "8b8d5850-2b76-4e96-9d41-2e77bc74edce";
const paths = ["aca11d41-fc99-457a-8152-c4dfc9fcc9ed/8b8d5850-2b76-4e96-9d41-2e77bc74edce/ordinary.mp4", "aca11d41-fc99-457a-8152-c4dfc9fcc9ed/8b8d5850-2b76-4e96-9d41-2e77bc74edce/limited.mp4"];
const reply = (status, value) => new Response(JSON.stringify(value), {status, headers: {'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async request => {
 if (Date.now() >= Date.parse("2026-11-05T18:19:24.778052+00:00")) return reply(410,{error:'RETIRED'});
 if (request.method !== 'POST') return reply(405,{error:'METHOD'});
 if (Deno.env.get('SUPABASE_URL') !== base) return reply(503,{error:'QA_ONLY'});
 const authorization=request.headers.get('Authorization')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),anon=Deno.env.get('SUPABASE_ANON_KEY');
 if (!service||!anon||!authorization.startsWith('Bearer ')||authorization===`Bearer ${service}`) return reply(401,{error:'AUTH'});
 try {
  const auth=await fetch(base+'/auth/v1/user',{headers:{Authorization:authorization,apikey:anon},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!auth.ok)return reply(401,{error:'AUTH'});
  const user=await auth.json();
  if(user.id!==owner||user.user_metadata?.qa_private_hls_canary!==marker)return reply(403,{error:'FIXTURE_ONLY'});
  const response=await fetch(base+'/storage/v1/object/chat-media',{method:'DELETE',headers:{Authorization:`Bearer ${service}`,apikey:service,'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return reply(503,{error:'STORAGE'});
  const removed=await response.json();
  if(!Array.isArray(removed)||removed.some(x=>!paths.includes(x.name)))return reply(503,{error:'RESPONSE'});
  return reply(200,{removed:removed.length,expected:paths.length,independentAbsenceReadbackRequired:true});
 }catch{return reply(503,{error:'CLEANUP_UNAVAILABLE'});}
});
