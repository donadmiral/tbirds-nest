'use server';
import { revalidatePath } from 'next/cache';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
export async function reviewCreator(_state:{error:string}|null,form:FormData):Promise<{error:string}> {
  const admin=await requireDesk('/payments');
  if(!['super_admin','platform_admin','finance_admin'].includes(admin.role)) throw new Error('Finance permission is required.');
  const key=String(form.get('command_key')||'');
  const {data,error}=await serviceClient().rpc('creator_finance_review',{
    p_actor:admin.id,p_session:admin.sessionId,p_key:key,p_user:String(form.get('user_id')||''),
    p_expected_updated_at:String(form.get('updated_at')||''),p_status:String(form.get('status')||''),p_reason:String(form.get('reason')||'').trim(),
  });
  if(error || data?.success!==true || data.command_key!==key) return {error:error?.message==='CREATOR_REVIEW_CHANGED'?'This creator was changed by another reviewer. Refresh before reviewing.':'The review was not confirmed. Keep the same details and retry.'};
  revalidatePath('/payments/creators');return {error:''};
}
