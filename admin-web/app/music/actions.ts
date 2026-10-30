'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
async function command(action:string,payload:Record<string,unknown>) {
 const admin=await requirePermission('post_moderate');
 const {error}=await serviceClient().rpc('admin_music_command',{p_actor:admin.id,p_session:admin.sessionId,p_action:action,p_payload:payload});
 if(error)redirect('/music?result=failed');
 revalidatePath('/music');redirect('/music?result=saved');
}
export async function saveMusicProvider(form:FormData) {
 return command('provider.save',{id:String(form.get('id')||'').trim().toLowerCase(),name:String(form.get('name')||'').trim(),contact:String(form.get('contact')||'').trim(),notes:String(form.get('notes')||'').trim()});
}
export async function saveMusicLicenseDraft(form:FormData) {
 return command('license.draft',{providerId:String(form.get('providerId')||''),reference:String(form.get('reference')||'').trim(),licensor:String(form.get('licensor')||'').trim(),territories:String(form.get('territories')||'').split(',').map(value=>value.trim().toUpperCase()).filter(Boolean),uses:form.getAll('uses').map(String),exportAllowed:form.get('exportAllowed')==='on',startsAt:String(form.get('startsAt')||''),endsAt:String(form.get('endsAt')||''),evidence:String(form.get('evidence')||'').trim()});
}
export async function revokeMusicSound(form:FormData) {
 return command('sound.revoke',{soundId:String(form.get('soundId')||''),reason:String(form.get('reason')||'').trim()});
}
