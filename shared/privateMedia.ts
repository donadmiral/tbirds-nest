export type PrivateGrant={requestId:string;expiresAt:string;remaining:number;mediaType:'image'|'video';watermark:string};
export type PrivateCloseReason='closed'|'background'|'screenshot'|'camera_detected'|'guard_failed'|'expired'|'account_changed'|'error';
/** Tokens stay in memory and in headers. Closing is local-first and terminal. */
export function createPrivateViewSession(options:{endpoint:string;token:string;apiKey:string;messageId:string;requestId:string;fetch:typeof fetch;current:()=>boolean;hide:()=>void}){
 let closed=false;const headers={Authorization:`Bearer ${options.token}`,apikey:options.apiKey,'Content-Type':'application/json'};
 const body=(action:string,extra={})=>JSON.stringify({action,messageId:options.messageId,requestId:options.requestId,...extra});
 const revoke=async(reason:PrivateCloseReason)=>{try{await options.fetch(options.endpoint,{method:'POST',headers,body:body('close',{reason}),keepalive:true,signal:AbortSignal.timeout(10000)});}catch{/* Server expiry bounds offline revocation. */}};
 return {
  get closed(){return closed;},
  mediaUrl:`${options.endpoint}?messageId=${encodeURIComponent(options.messageId)}&requestId=${encodeURIComponent(options.requestId)}`,
  headers,
  async open():Promise<PrivateGrant|null>{
   if(closed||!options.current())return null;
   const r=await options.fetch(options.endpoint,{method:'POST',headers,body:body('open'),signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw new Error(r.status===410?'This attachment is no longer available.':'Could not open this private attachment.');
   const grant=await r.json() as PrivateGrant;
   if(grant.requestId!==options.requestId||!['image','video'].includes(grant.mediaType)||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=Date.now())throw new Error('This viewing session has ended.');
   if(closed||!options.current()){closed=true;options.hide();await revoke('account_changed');return null;}return grant;
  },
  close(reason:PrivateCloseReason='closed'){closed=true;options.hide();return revoke(reason);},
 };
}
