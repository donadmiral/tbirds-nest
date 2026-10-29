import {redirect} from 'next/navigation';
import {cookies} from 'next/headers';
import {getAdmin} from '@/lib/adminAuth';
import {canAccessOperations} from '@/lib/adminAssurance';
import Link from 'next/link';
import {serviceClient} from '@/lib/supabaseAdmin';
import {signOut} from '@/lib/actions';
import SecurityForm from './SecurityForm';
export default async function SecurityPage({searchParams}:{searchParams:Promise<{setup?:string}>}){
 const admin=await getAdmin();if(!admin)redirect('/');
 if(admin.aal==='aal2')redirect('/dashboard');
 const optional=await canAccessOperations(admin);
 if(optional&&(await searchParams).setup!=='1')redirect('/dashboard');
 const token=(await cookies()).get('pc_admin_token')!.value;
 const result=await serviceClient().auth.getUser(token);
 if(result.error||!result.data.user)redirect('/');
 const factors=(result.data.user.factors||[]).filter(f=>f.factor_type==='totp'&&f.status==='verified').map(f=>({id:f.id,name:f.friendly_name||'Authenticator'}));
 return <main style={{maxWidth:480,margin:'60px auto',padding:24}}><h1>Account security</h1><p>{optional?'Authenticator setup is optional. You can continue to the operations desks with your staff sign-in.':'Use an authenticator to access the operations desks.'}</p><SecurityForm factors={factors}/>{optional&&<p><Link href="/dashboard">Continue to operations</Link></p>}<form action={signOut}><button>Sign out</button></form></main>;
}
