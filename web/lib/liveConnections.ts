import {liveInvoke,record,type LiveClient} from './liveApi';
export const socialPlatforms=['x','facebook','instagram','youtube','tiktok'] as const;
export type SocialPlatform=typeof socialPlatforms[number];
export const socialNames:Record<SocialPlatform,string>={x:'X',facebook:'Facebook Pages',instagram:'Instagram professional',youtube:'YouTube',tiktok:'TikTok'};
export type SocialConnection={platform:SocialPlatform;enabled:boolean;state:string;account_name:string|null;can_publish:boolean};
export const socialPlatform=(value:unknown):value is SocialPlatform=>typeof value==='string'&&socialPlatforms.includes(value as SocialPlatform);
export const connectionError=(error:unknown)=>{
 const code=error instanceof Error?error.message:'';
 if(/AUTH_REQUIRED|401/.test(code))return 'Sign in again with the account that started this connection.';
 if(/STATE_EXPIRED|STATE_REPLAYED|RECONNECT_REQUIRED|OPERATION_AMBIGUOUS/.test(code))return 'This connection attempt has expired or was already used. Start a new connection.';
 if(/INTEGRATION_NOT_CONFIGURED|INTEGRATION_DISABLED/.test(code))return 'This platform is not available for connection yet.';
 if(/SCOPES_NOT_GRANTED/.test(code))return 'The required permissions or an eligible creator account were not available. Review your provider permissions and try again.';
 if(/ACCOUNT_LIMIT/.test(code))return 'This provider returned too many accounts for one connection. Limit the accounts shared with this application, then reconnect.';
 if(/PROVIDER_RATE_LIMITED/.test(code))return 'The platform asked us to wait. Try again later.';
 return 'The connection could not complete. Your existing clips and device exports remain available.';
};
export async function connectionStatus(client:LiveClient){
 const result=await liveInvoke(client,'live-connect',{action:'status'});
 const available=Array.isArray(result.available)?result.available.filter(socialPlatform):[];
 const items=Array.isArray(result.items)?result.items.slice(0,5).flatMap(item=>record(item)&&socialPlatform(item.platform)?[{platform:item.platform,enabled:item.enabled===true&&available.includes(item.platform),state:String(item.state||'disconnected').slice(0,40),account_name:typeof item.account_name==='string'?item.account_name.slice(0,160):null,can_publish:item.can_publish===true}]:[]):[];
 return items;
}
export function validAuthorizationUrl(value:unknown,platform:SocialPlatform,origin:string):URL{
 if(typeof value!=='string'||value.length>8000)throw Error('INVALID_AUTHORIZATION_URL');const url=new URL(value);
 const paths:Record<SocialPlatform,{origin:string;path:RegExp}>={x:{origin:'https://x.com',path:/^\/i\/oauth2\/authorize$/},youtube:{origin:'https://accounts.google.com',path:/^\/o\/oauth2\/v2\/auth$/},tiktok:{origin:'https://www.tiktok.com',path:/^\/v2\/auth\/authorize\/$/},facebook:{origin:'https://www.facebook.com',path:/^\/v\d{2}\.\d\/dialog\/oauth$/},instagram:{origin:'https://www.facebook.com',path:/^\/v\d{2}\.\d\/dialog\/oauth$/}};
 if(url.origin!==paths[platform].origin||!paths[platform].path.test(url.pathname)||url.username||url.password||url.hash||url.searchParams.get('redirect_uri')!==origin+'/live/connections/callback'||!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state')||''))throw Error('INVALID_AUTHORIZATION_URL');return url;
}
export type ConnectionSelection={id:string;accounts:{id:string;name:string}[]};
export function parseConnectionSelection(value:unknown):ConnectionSelection|null{
 if(!record(value)||value.state!=='select_account'||typeof value.selection_id!=='string'||!/^[a-f0-9-]{36}$/.test(value.selection_id)||!Array.isArray(value.accounts))return null;
 const accounts=value.accounts.slice(0,20).flatMap(a=>record(a)&&typeof a.id==='string'&&/^[a-zA-Z0-9_.-]{1,160}$/.test(a.id)&&typeof a.name==='string'?[{id:a.id,name:a.name.slice(0,160)}]:[]);return accounts.length?{id:value.selection_id,accounts}:null;
}
