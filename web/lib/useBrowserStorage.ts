"use client";
import {useCallback,useSyncExternalStore} from "react";
const EVENT="pc-browser-storage";
/** Stable string snapshots keep local drafts and same-tab readers in sync. */
export function useBrowserStorage(key:string) {
  const subscribe=useCallback((notify:()=>void)=>{
    const update=(event:Event)=>{if(event instanceof StorageEvent&&event.key!==null&&event.key!==key)return;notify();};
    window.addEventListener("storage",update);window.addEventListener(EVENT,update);
    return()=>{window.removeEventListener("storage",update);window.removeEventListener(EVENT,update);};
  },[key]);
  const read=useCallback(()=>{try{return localStorage.getItem(key);}catch{return null;}},[key]);
  const server=useCallback(()=>null,[]);
  const value=useSyncExternalStore(subscribe,read,server);
  const write=useCallback((next:string|null)=>{
    try {if(next===null)localStorage.removeItem(key);else localStorage.setItem(key,next);window.dispatchEvent(new Event(EVENT));return true;}catch{return false;}
  },[key]);
  return [value,write] as const;
}
