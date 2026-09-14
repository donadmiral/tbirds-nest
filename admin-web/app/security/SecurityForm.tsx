'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {enrollAuthenticator,verifyAuthenticator} from './actions';
export default function SecurityForm({factors}:{factors:{id:string;name:string}[]}){
 const router=useRouter();const [factor,setFactor]=useState(factors[0]?.id||'');const [qr,setQr]=useState('');const [secret,setSecret]=useState('');const [code,setCode]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 return <div>
  {factors.length>0?<label>Authenticator<select value={factor} onChange={e=>setFactor(e.target.value)}>{factors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>:<button disabled={busy||!!qr} onClick={async()=>{setBusy(true);setError('');try{const r=await enrollAuthenticator();if(!r.success){setError(r.error);return;}setFactor(r.factorId);setQr(r.qr);setSecret(r.secret);}finally{setBusy(false);}}}>Set up authenticator</button>}
  {qr&&<div><p>Scan this code in your authenticator app, then enter the six-digit code.</p><img src={qr} alt="Authenticator setup QR code" width={220} height={220}/><details><summary>Enter setup key manually</summary><code>{secret}</code></details></div>}
  {!!factor&&<form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const r=await verifyAuthenticator(factor,code);if(!r.success){setError(r.error);return;}setSecret('');setQr('');router.replace('/dashboard');router.refresh();}finally{setBusy(false);}}}><label>Authenticator code<input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required/></label><button disabled={busy||code.length!==6}>Verify and continue</button></form>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
