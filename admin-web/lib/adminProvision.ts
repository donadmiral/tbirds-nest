import 'server-only';
import {createHmac,randomUUID} from 'node:crypto';
import {requirePermission} from './adminAuth';
import {serviceClient} from './supabaseAdmin';
export async function provisionAccount(kind:'staff'|'business',form:FormData){
 const admin=await requirePermission(kind==='staff'?'staff_manage':'business_manage');
 const key=String(form.get('command_key')||'');
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key))throw new Error('Reload the form before submitting.');
 const password=String(form.get('password')||'');
 if(kind==='staff'&&password.length<12)throw new Error('Use a password with at least 12 characters.');
 const payload=kind==='staff'?{email:String(form.get('email')||'').trim().toLowerCase(),role:String(form.get('role')||''),password_digest:createHmac('sha256',process.env.SUPABASE_SERVICE_ROLE_KEY || '').update(password).digest('hex')}:{id:String(form.get('id')||'')};
 const svc=serviceClient();
 const args={p_actor_id:admin.id,p_session_id:admin.sessionId,p_key:key,p_kind:kind,p_payload:payload};
 const reserved=await svc.rpc('triniti_admin_provision',{...args,p_phase:'reserve'});
 if(reserved.error||reserved.data?.success!==true)throw new Error('Provisioning could not be reserved. Retry the original form details.');
 const job=reserved.data;
 if(job.complete===true)return;
 const existing=await svc.auth.admin.getUserById(job.auth_user_id);
 if(existing.data.user){
  if(existing.data.user.app_metadata.triniti_provision_id!==job.provision_id||existing.data.user.email?.toLowerCase()!==job.email)throw new Error('The reserved identity requires review.');
 }else{
  if(existing.error&&existing.error.status!==404)throw new Error('The reserved identity could not be checked. Retry.');
  const created=await svc.auth.admin.createUser({id:job.auth_user_id,email:job.email,password:kind==='staff'?password:randomUUID()+randomUUID(),email_confirm:true,app_metadata:{triniti_provision_id:job.provision_id}});
  if(created.error||created.data.user?.id!==job.auth_user_id)throw new Error('Account creation was not confirmed. Retry the same details.');
 }
 const finished=await svc.rpc('triniti_admin_provision',{...args,p_phase:'finish'});
 if(finished.error||finished.data?.complete!==true)throw new Error('Account setup is pending. Retry the same details to finish it.');
}
