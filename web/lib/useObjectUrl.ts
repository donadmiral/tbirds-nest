"use client";
import {useMemo,useSyncExternalStore} from "react";
class BlobUrlStore {
  private url:string|null=null;
  private listeners=new Set<()=>void>();
  constructor(private readonly file:Blob|null) {}
  snapshot=()=>this.url;
  server=()=>null;
  subscribe=(listener:()=>void)=>{
    this.listeners.add(listener);
    if(this.file&&!this.url){this.url=URL.createObjectURL(this.file);this.listeners.forEach(notify=>notify());}
    return()=>{this.listeners.delete(listener);if(!this.listeners.size&&this.url){URL.revokeObjectURL(this.url);this.url=null;}};
  };
}
/** A Blob URL is owned by its committed subscribers, never by a discarded render. */
export function useObjectUrl(file:Blob|null) {
  const store=useMemo(()=>new BlobUrlStore(file),[file]);
  return useSyncExternalStore(store.subscribe,store.snapshot,store.server);
}
