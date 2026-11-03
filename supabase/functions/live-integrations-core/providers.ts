import {Platform, IntegrationFailure, fail, boundedJson, challenge, record, retryAfter} from './security.ts';

export type ClientConfig = {clientId:string;clientSecret:string};
export type ProviderConfig = {redirectUri:string;clients:Partial<Record<Platform,ClientConfig>>;metaVersion?:string};
export type Tokens = {accessToken:string;refreshToken?:string;expiresAt:number;refreshExpiresAt?:number;scopes:string[];accountId?:string};
export type Account = {id:string;name:string;tokens:Tokens};
export type Fetcher = typeof fetch;
export const requiredScopes:Record<Platform,string[]> = {
 x:['tweet.read','tweet.write','users.read','offline.access','media.write'],
 facebook:['pages_show_list','pages_read_engagement','pages_manage_posts'],
 instagram:['pages_show_list','pages_read_engagement','instagram_basic','instagram_content_publish'],
 youtube:['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly'],
 tiktok:['user.info.basic','video.publish'],
};
function configuration(config:ProviderConfig,platform:Platform):ClientConfig {
 const client=config.clients[platform];
 if(!client||!client.clientId||!client.clientSecret)fail('INTEGRATION_NOT_CONFIGURED');
 const redirect=new URL(config.redirectUri);
 if(redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.search||redirect.hash||redirect.pathname!=='/live/connections/callback')fail('INTEGRATION_NOT_CONFIGURED');
 if((platform==='facebook'||platform==='instagram')&&!/^v\d{2}\.\d$/.test(config.metaVersion||''))fail('INTEGRATION_NOT_CONFIGURED');
 return client;
}
export function configured(config:ProviderConfig,platform:Platform):boolean {try{configuration(config,platform);return true;}catch{return false;}}
export async function authorizationUrl(config:ProviderConfig,platform:Platform,state:string,verifier:string):Promise<string>{
 const client=configuration(config,platform);
 const uri=platform==='x'?'https://x.com/i/oauth2/authorize':platform==='youtube'?'https://accounts.google.com/o/oauth2/v2/auth':platform==='tiktok'?'https://www.tiktok.com/v2/auth/authorize/':`https://www.facebook.com/${config.metaVersion}/dialog/oauth`;
 const url=new URL(uri);url.searchParams.set(platform==='tiktok'?'client_key':'client_id',client.clientId);
 url.searchParams.set('redirect_uri',config.redirectUri);url.searchParams.set('response_type','code');url.searchParams.set('state',state);
 url.searchParams.set('scope',requiredScopes[platform].join(platform==='tiktok'||platform==='facebook'||platform==='instagram'?',':' '));
 if(platform==='x'||platform==='youtube'){url.searchParams.set('code_challenge',await challenge(verifier));url.searchParams.set('code_challenge_method','S256');}
 if(platform==='youtube'){url.searchParams.set('access_type','offline');url.searchParams.set('prompt','consent');url.searchParams.set('include_granted_scopes','false');}
 if(platform==='tiktok')url.searchParams.set('disable_auto_auth','1');
 return url.href;
}
function text(value:unknown,max=12000):string {if(typeof value!=='string'||value.length<1||value.length>max)fail('PROVIDER_RESPONSE_INVALID');return value as string;}
function id(value:unknown):string {const result=text(value,160);if(!/^[a-zA-Z0-9_.-]+$/.test(result))fail('PROVIDER_RESPONSE_INVALID');return result;}
function lifetime(value:unknown,fallback=3600):number {return typeof value==='number'&&Number.isFinite(value)&&value>0?Math.min(value,366*86400):fallback;}
function scopes(value:unknown):string[]{return typeof value==='string'?value.split(/[ ,]+/).filter(Boolean):[];}
export async function providerJson(fetcher:Fetcher,url:string,init:RequestInit,signal:AbortSignal):Promise<Record<string,unknown>>{
 let response:Response;try{response=await fetcher(url,{...init,signal,redirect:'error'});}catch{throw new IntegrationFailure('PROVIDER_UNAVAILABLE');}
 if(!response.ok){void response.body?.cancel().catch(()=>{});
  if(response.status===429)throw new IntegrationFailure('PROVIDER_RATE_LIMITED',retryAfter(response.headers.get('Retry-After')));
  if(response.status===401)fail('RECONNECT_REQUIRED');if(response.status>=500)fail('PROVIDER_UNAVAILABLE');fail('PROVIDER_REJECTED');}
 const data=await boundedJson(response,128000,signal);if(!record(data))fail('PROVIDER_RESPONSE_INVALID');
 // TikTok includes {error:{code:'ok'}} on successful API responses.
 if(data.error&&!(record(data.error)&&data.error.code==='ok'))fail('PROVIDER_REJECTED');return data;
}
const form=(values:Record<string,string>)=>({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values)});
function tokens(data:Record<string,unknown>,platform:Platform,previous?:Tokens):Tokens{
 const granted=scopes(data.scope);if(granted.length&&requiredScopes[platform].some(scope=>!granted.includes(scope)))fail('SCOPES_NOT_GRANTED');
 if(data.token_type&&String(data.token_type).toLowerCase()!=='bearer')fail('PROVIDER_RESPONSE_INVALID');
 return {accessToken:text(data.access_token),refreshToken:data.refresh_token?text(data.refresh_token):previous?.refreshToken,
  expiresAt:Date.now()+lifetime(data.expires_in)*1000,refreshExpiresAt:data.refresh_expires_in?Date.now()+lifetime(data.refresh_expires_in)*1000:previous?.refreshExpiresAt,
  scopes:granted.length?granted:previous?.scopes||requiredScopes[platform],...(previous?.accountId?{accountId:previous.accountId}:{})};
}
export async function exchange(config:ProviderConfig,platform:Platform,code:string,verifier:string,fetcher:Fetcher,signal:AbortSignal):Promise<Tokens>{
 const client=configuration(config,platform);if(!code||code.length>8000)fail('INVALID_REQUEST');
 let data:Record<string,unknown>;
 if(platform==='x'){
  const init=form({grant_type:'authorization_code',code,redirect_uri:config.redirectUri,code_verifier:verifier});
  data=await providerJson(fetcher,'https://api.x.com/2/oauth2/token',{...init,headers:{...init.headers,Authorization:'Basic '+btoa(encodeURIComponent(client.clientId)+':'+encodeURIComponent(client.clientSecret))}},signal);
 }else if(platform==='youtube')data=await providerJson(fetcher,'https://oauth2.googleapis.com/token',form({grant_type:'authorization_code',code,client_id:client.clientId,client_secret:client.clientSecret,redirect_uri:config.redirectUri,code_verifier:verifier}),signal);
 else if(platform==='tiktok')data=await providerJson(fetcher,'https://open.tiktokapis.com/v2/oauth/token/',form({grant_type:'authorization_code',code,client_key:client.clientId,client_secret:client.clientSecret,redirect_uri:config.redirectUri}),signal);
 else{
  data=await providerJson(fetcher,`https://graph.facebook.com/${config.metaVersion}/oauth/access_token`,form({code,client_id:client.clientId,client_secret:client.clientSecret,redirect_uri:config.redirectUri}),signal);
  // Exchange the short-lived user token server-side before resolving Page tokens.
  data=await providerJson(fetcher,`https://graph.facebook.com/${config.metaVersion}/oauth/access_token`,form({grant_type:'fb_exchange_token',client_id:client.clientId,client_secret:client.clientSecret,fb_exchange_token:text(data.access_token)}),signal);
 }
 const result=tokens(data,platform);if((platform==='x'||platform==='youtube'||platform==='tiktok')&&!result.refreshToken)fail('SCOPES_NOT_GRANTED');return result;
}
export async function refresh(config:ProviderConfig,platform:Platform,old:Tokens,fetcher:Fetcher,signal:AbortSignal):Promise<Tokens>{
 const client=configuration(config,platform);if(platform==='facebook'||platform==='instagram'||!old.refreshToken||old.refreshExpiresAt&&old.refreshExpiresAt<=Date.now())fail('RECONNECT_REQUIRED');
 let init=form({grant_type:'refresh_token',refresh_token:old.refreshToken!,client_id:client.clientId,client_secret:client.clientSecret});let url='https://oauth2.googleapis.com/token';
 if(platform==='x'){init=form({grant_type:'refresh_token',refresh_token:old.refreshToken!});init.headers={...init.headers,...{Authorization:'Basic '+btoa(encodeURIComponent(client.clientId)+':'+encodeURIComponent(client.clientSecret))}};url='https://api.x.com/2/oauth2/token';}
 if(platform==='tiktok'){init=form({grant_type:'refresh_token',refresh_token:old.refreshToken!,client_key:client.clientId,client_secret:client.clientSecret});url='https://open.tiktokapis.com/v2/oauth/token/';}
 return tokens(await providerJson(fetcher,url,init,signal),platform,old);
}
export async function accounts(config:ProviderConfig,platform:Platform,token:Tokens,fetcher:Fetcher,signal:AbortSignal):Promise<Account[]>{
 configuration(config,platform);const headers={Authorization:'Bearer '+token.accessToken};
 if(platform==='x'){
  const data=await providerJson(fetcher,'https://api.x.com/2/users/me',{headers},signal),user=record(data.data)?data.data:{};
  return [{id:id(user.id),name:text(user.username,100),tokens:token}];
 }
 if(platform==='youtube'){
  const data=await providerJson(fetcher,'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50',{headers},signal);
  if(data.nextPageToken)fail('ACCOUNT_LIMIT');if(!Array.isArray(data.items)||data.items.length>50)fail('PROVIDER_RESPONSE_INVALID');
  return data.items.map((item:any)=>({id:id(item.id),name:text(item.snippet?.title,160),tokens:token}));
 }
 if(platform==='tiktok'){
  const data=await providerJson(fetcher,'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',{headers},signal);
  const user=record(data.data)&&record(data.data.user)?data.data.user:{};
  return [{id:id(user.open_id),name:text(user.display_name,160),tokens:token}];
 }
 const base=`https://graph.facebook.com/${config.metaVersion}`;
 const permissions=await providerJson(fetcher,base+'/me/permissions',{headers},signal);
 const granted=Array.isArray(permissions.data)?permissions.data.filter((v:any)=>v.status==='granted').map((v:any)=>v.permission):[];
 if(requiredScopes[platform].some(scope=>!granted.includes(scope)))fail('SCOPES_NOT_GRANTED');
 const data=await providerJson(fetcher,base+'/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50',{headers},signal);
 if(record(data.paging)&&data.paging.next)fail('ACCOUNT_LIMIT');if(!Array.isArray(data.data)||data.data.length>50)fail('PROVIDER_RESPONSE_INVALID');
 return data.data.flatMap((page:any)=>{
  const target=platform==='facebook'?page:page.instagram_business_account;if(!target)return [];
  return [{id:id(target.id),name:text(platform==='facebook'?target.name:target.username,160),tokens:{...token,accessToken:text(page.access_token),refreshToken:undefined}}];
 });
}
export function validTokens(value:unknown):value is Tokens {
 return record(value)&&typeof value.accessToken==='string'&&value.accessToken.length>0&&value.accessToken.length<=12000&&typeof value.expiresAt==='number'&&Array.isArray(value.scopes);
}
