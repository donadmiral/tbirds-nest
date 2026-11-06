import { supabase } from './supabase';
import { isLiveUuid } from '../../shared/liveDirectory';
import { liveObject, type LiveObject } from './liveService';

type Listener=(event:'session'|'access_changed'|'warning',payload:LiveObject)=>void;
type Entry={channel:ReturnType<typeof supabase.channel>;listeners:Set<Listener>};
const channels=new Map<string,Entry>();

/** Share one private control subscription between the player and visible chat. */
export function subscribeLiveControl(sessionId:string,owner:string,listener:Listener):()=>void {
  if(!isLiveUuid(sessionId)||!isLiveUuid(owner))return()=>{};
  const key=owner+':'+sessionId;let entry=channels.get(key);
  if(!entry){
    const listeners=new Set<Listener>();
    const channel=supabase.channel('live-control:'+sessionId,{config:{private:true}});
    for(const name of ['session','access_changed','warning'] as const)channel.on('broadcast',{event:name},event=>{if(liveObject(event.payload))for(const callback of [...listeners])callback(name,event.payload);});
    entry={channel,listeners};channels.set(key,entry);channel.subscribe();
  }
  entry.listeners.add(listener);const subscribed=entry;
  return()=>{subscribed.listeners.delete(listener);if(!subscribed.listeners.size&&channels.get(key)===subscribed){channels.delete(key);void supabase.removeChannel(subscribed.channel);}};
}
