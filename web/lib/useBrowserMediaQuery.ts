"use client";
import {useCallback,useSyncExternalStore} from "react";
/** React subscribes to the browser preference, including changes while open. */
export function useBrowserMediaQuery(query:string, serverValue=false) {
  const subscribe=useCallback((notify:()=>void)=>{const media=window.matchMedia(query);media.addEventListener("change",notify);return()=>media.removeEventListener("change",notify);},[query]);
  const snapshot=useCallback(()=>window.matchMedia(query).matches,[query]);
  const server=useCallback(()=>serverValue,[serverValue]);
  return useSyncExternalStore(subscribe,snapshot,server);
}
