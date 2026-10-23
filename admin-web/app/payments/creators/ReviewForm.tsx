'use client';
import { useActionState } from 'react';
import { reviewCreator } from './actions';
export default function ReviewForm({userId,updatedAt,status,commandKey}:{userId:string;updatedAt:string;status:string;commandKey:string}) {
  const [state,action,pending]=useActionState(reviewCreator,null);
  const options=status==='applied'?['approved','rejected']:status==='approved'?['suspended']:status==='suspended'?['approved']:[];
  if(!options.length)return null;
  return <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
    <input type="hidden" name="user_id" value={userId}/><input type="hidden" name="updated_at" value={updatedAt}/><input type="hidden" name="command_key" value={commandKey}/>
    <label className="text-sm">Decision<select name="status" disabled={pending} className="ml-2 min-h-11 rounded border p-2" style={{background:'var(--panel)'}}>{options.map(s=><option key={s} value={s}>{s==='approved'?'Approve':s==='rejected'?'Decline':'Pause monetization'}</option>)}</select></label>
    <label className="flex-1 text-sm">Reason shown to creator<input required name="reason" minLength={1} maxLength={2000} disabled={pending} className="block min-h-11 w-full rounded border p-2" style={{background:'var(--panel)'}}/></label>
    <button disabled={pending} className="min-h-11 rounded border px-4 disabled:opacity-50">{pending?'Saving…':'Save review'}</button>
    {state?.error&&<p role="alert" className="w-full" style={{color:'var(--bad)'}}>{state.error}</p>}
  </form>;
}
