'use server';
import {adminSessionClient,saveAdminSession} from '@/lib/adminSession';
export async function enrollAuthenticator() {
  try {
    const client=await adminSessionClient();
    const factors=await client.auth.mfa.listFactors();
    if(factors.error)throw factors.error;
    if(factors.data.totp.some(f=>f.status==='verified'))throw new Error('Use your existing authenticator.');
    for(const f of factors.data.all.filter(f=>f.status==='unverified'&&f.friendly_name==='TRINITI admin')){
      const removed=await client.auth.mfa.unenroll({factorId:f.id});if(removed.error)throw removed.error;
    }
    const {data,error}=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'TRINITI admin'});
    if(error||!data)throw new Error('Authenticator setup could not start.');
    return {success:true as const,factorId:data.id,qr:data.totp.qr_code,secret:data.totp.secret};
  }catch(e){return {success:false as const,error:e instanceof Error?e.message:'Authenticator setup failed.'};}
}
export async function verifyAuthenticator(factorId:string,code:string){
  try{
    if(!/^[0-9]{6}$/.test(code))throw new Error('Enter the six-digit authenticator code.');
    const client=await adminSessionClient();
    const {error}=await client.auth.mfa.challengeAndVerify({factorId,code});
    if(error)throw new Error('The code was not accepted. Try a new code.');
    const {data}=await client.auth.getSession();
    if(!data.session)throw new Error('Your session could not be confirmed.');
    await saveAdminSession(data.session);
    return {success:true as const};
  }catch(e){return {success:false as const,error:e instanceof Error?e.message:'Verification failed.'};}
}
