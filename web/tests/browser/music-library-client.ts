/** Synthetic transport adapter for the browser acceptance harness only. */
export const fixtureOwner='10000000-0000-4000-8000-000000000001';
const session={user:{id:fixtureOwner},access_token:'synthetic-owner'};
const request=async(path:string,body:unknown)=>{
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return response.json();
};
export function createClient(){return {
 auth:{getSession:async()=>({data:{session},error:null}),getUser:async()=>({data:{user:session.user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 rpc:(name:string,args:unknown)=>request('/fixture-rpc',{name,args}),
 functions:{invoke:(name:string,options:unknown)=>request('/fixture-function',{name,options})},
};}
