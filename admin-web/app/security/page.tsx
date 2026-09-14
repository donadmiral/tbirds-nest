import {redirect} from 'next/navigation';
import {cookies} from 'next/headers';
import {getAdmin} from '@/lib/adminAuth';
import {serviceClient} from '@/lib/supabaseAdmin';
import {signOut} from '@/lib/actions';
import SecurityForm from './SecurityForm';
export default async function SecurityPage(){
 const admin=await getAdmin();if(!admin)redirect('/');
 if(admin.aal==='aal2')redirect('/dashboard');
 const token=(await cookies()).get('pc_admin_token')!.value;
 const result=await serviceClient().auth.getUser(token);
 if(result.error||!result.data.user)redirect('/');
 const factors=(result.data.user.factors||[]).filter(f=>f.factor_type==='totp'&&f.status==='verified').map(f=>({id:f.id,name:f.friendly_name||'Authenticator'}));
 return <main style={{maxWidth:480,margin:'60px auto',padding:24}}><h1>Secure your staff account</h1><p>Use an authenticator to access the operations desks.</p><SecurityForm factors={factors}/><form action={signOut}><button>Sign out</button></form></main>;
}
