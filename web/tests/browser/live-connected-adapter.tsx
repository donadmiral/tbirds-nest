// Test-only navigation/auth adapter. All Live RPCs, Edge functions, Daily media,
// realtime messages and HLS requests use the actual QA services.
import React,{useEffect,useState} from 'react';
import {createClient as sdkClient} from '@supabase/supabase-js';
const input=(window as any).__LIVE_ACCEPTANCE;
if(!input||input.origin!=='https://uaulhuelcfkjwojtymmw.supabase.co')throw Error('QA configuration required');
const client=sdkClient(input.origin,input.anon,{auth:{persistSession:false,autoRefreshToken:false}});
const snapshot={owner:input.actor.id,scope:'qa:'+input.actor.id,initialized:true,profile:{id:input.actor.id}};
const store={subscribe:()=>()=>{},getSnapshot:()=>snapshot,getServerSnapshot:()=>snapshot};
export const createClient=()=>client;
export const getNavigationStore=()=>store;
export async function initialize(){const result=await client.auth.setSession({access_token:input.actor.access_token,refresh_token:input.actor.refresh_token});if(result.error)throw Error('QA session initialization failed');(window as any).__qaClient=client;}
const navigate=(url:string)=>{history.pushState({},'',url);window.dispatchEvent(new Event('qa-route'));};
export const useRouter=()=>({push:navigate,replace:(url:string)=>{history.replaceState({},'',url);window.dispatchEvent(new Event('qa-route'));},refresh:()=>window.dispatchEvent(new Event('qa-route'))});
export function usePathname(){const [path,setPath]=useState(location.pathname);useEffect(()=>{const change=()=>setPath(location.pathname);window.addEventListener('qa-route',change);window.addEventListener('popstate',change);return()=>{window.removeEventListener('qa-route',change);window.removeEventListener('popstate',change);};},[]);return path;}
export const useSearchParams=()=>new URLSearchParams(location.search);
export default function Link({href,children,onClick,...props}:any){return <a href={href} {...props} onClick={event=>{onClick?.(event);if(!event.defaultPrevented&&typeof href==='string'&&href.startsWith('/')&&!event.metaKey&&!event.ctrlKey){event.preventDefault();navigate(href);}}}>{children}</a>;}
