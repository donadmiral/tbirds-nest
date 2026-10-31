/** Synthetic transport adapter for the browser acceptance harness only. */
export const fixtureOwner='10000000-0000-4000-8000-000000000001';
export const fixtureBookId='b0000000-0000-4000-8000-000000000001';
let fixtureBook:unknown=null;
export function setFixtureBook(value:unknown){fixtureBook=value;}
const session={user:{id:fixtureOwner},access_token:'synthetic-owner'};
const request=async(path:string,body:unknown)=>{
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return response.json();
};
export function createClient(){return {
 auth:{getSession:async()=>({data:{session},error:null}),getUser:async()=>({data:{user:session.user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 rpc:(name:string,args:unknown)=>name==='get_memory_book'?Promise.resolve({data:(args as {p_album?:string})?.p_album===fixtureBookId?fixtureBook:null,error:null}):request('/fixture-rpc',{name,args}),
 functions:{invoke:(name:string,options:unknown)=>request('/fixture-function',{name,options})},
};}
