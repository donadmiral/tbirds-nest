'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, Flag, Pin, Send, Trash2 } from 'lucide-react';
import { getLiveMessages, liveCommand, liveError, mergeLiveMessages, parseLiveMessage, record, type LiveClient, type LiveDetail, type LiveMessage } from '@/lib/liveApi';
import type { LiveCursor } from '../../shared/liveDirectory';
export function LiveChat({client,detail,ownerId,onRefresh,onPatch,onInteraction,onInteractionCounts}:{client:LiveClient;detail:LiveDetail;ownerId:string;onRefresh():void;onPatch(payload:unknown):void;onInteraction(payload:unknown):void;onInteractionCounts(payload:unknown):void}) {
  const [messages,setMessages]=useState<LiveMessage[]>([]),[cursor,setCursor]=useState<LiveCursor|null>(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connected,setConnected]=useState(false),[loading,setLoading]=useState(false);
  const [pinned,setPinned]=useState(detail.pinned_message),[reaction,setReaction]=useState('');
  const generation=useRef(0),request=useRef<{id:string;text:string}|null>(null),reactionTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const moderator=['host','producer','moderator'].includes(detail.role),live=['live','reconnecting'].includes(detail.session.state);
  const load=useCallback(async(before:LiveCursor|null=null)=>{
    const version=generation.current;setLoading(true);
    try{const page=await getLiveMessages(client,detail.session.id,before);if(version!==generation.current)return;setMessages(prior=>before?mergeLiveMessages(page.items,prior):mergeLiveMessages([],page.items));setCursor(page.cursor);setError('');}
    catch(e){if(version===generation.current)setError(liveError(e));}finally{if(version===generation.current)setLoading(false);}
  },[client,detail.session.id]);
  useEffect(()=>{generation.current++;setMessages([]);setCursor(null);setPinned(detail.pinned_message);void load();return()=>{generation.current++;clearTimeout(reactionTimer.current);};},[detail.session.id,load]);
  useEffect(()=>{setPinned(detail.pinned_message);},[detail.pinned_message]);
  useEffect(()=>{
    if(!detail.chat_topic)return;
    let alive=true,subscribedBefore=false,channel:ReturnType<LiveClient['channel']>|null=null,control:ReturnType<LiveClient['channel']>|null=null;
    const access=({payload}:{payload:unknown})=>{if(!record(payload))return;if(payload.user_id===ownerId){setMessages([]);setPinned(null);onRefresh();}else if(typeof payload.chat_topic==='string')onPatch(payload);};
    const join=()=>{
      if(!alive||document.visibilityState==='hidden'||channel)return;
      channel=client.channel(detail.chat_topic,{config:{private:true}})
      .on('broadcast',{event:'message'},({payload})=>{const item=parseLiveMessage(payload);if(item&&item.session_id===detail.session.id)setMessages(previous=>mergeLiveMessages(previous,[item]));})
      .on('broadcast',{event:'message_removed'},({payload})=>{if(record(payload)&&typeof payload.id==='string'){setMessages(previous=>previous.map(item=>item.id===payload.id?{...item,removed:true,body:''}:item));setPinned(previous=>previous?.id===payload.id?null:previous);}})
      .on('broadcast',{event:'pin'},({payload})=>{if(record(payload))setPinned(parseLiveMessage(payload.message));})
      .on('broadcast',{event:'reaction'},({payload})=>{if(record(payload)&&['heart','applause','fire'].includes(String(payload.reaction))){setReaction(String(payload.reaction));clearTimeout(reactionTimer.current);reactionTimer.current=setTimeout(()=>setReaction(''),1600);}})
      .on('broadcast',{event:'interaction'},({payload})=>onInteraction(payload))
      .on('broadcast',{event:'interaction_counts'},({payload})=>onInteractionCounts(payload))
      .on('broadcast',{event:'session'},({payload})=>onPatch(payload))
      .on('broadcast',{event:'access_changed'},access)
      .on('broadcast',{event:'warning'},({payload})=>{if(record(payload))setError(String(payload.reason||'This stream is under review.').slice(0,500));})
      .subscribe(status=>{if(!alive)return;setConnected(status==='SUBSCRIBED');if(status==='SUBSCRIBED'){if(subscribedBefore)void load();subscribedBefore=true;}});
      control=client.channel('live-control:'+detail.session.id,{config:{private:true}}).on('broadcast',{event:'session'},({payload})=>onPatch(payload)).on('broadcast',{event:'access_changed'},access).subscribe();
    };
    const leave=()=>{if(channel){void client.removeChannel(channel);channel=null;}if(control){void client.removeChannel(control);control=null;}setConnected(false);};
    const visibility=()=>{if(document.visibilityState==='hidden')leave();else{onRefresh();join();}};
    join();document.addEventListener('visibilitychange',visibility);
    return()=>{alive=false;leave();document.removeEventListener('visibilitychange',visibility);};
  },[client,detail.session.id,detail.chat_topic,ownerId,onRefresh,onPatch,onInteraction,onInteractionCounts,load]);
  const act=async(action:string,payload:Record<string,unknown>)=>{try{await liveCommand(client,detail.session.id,action,payload);setError('');if(action==='pin')setPinned(messages.find(m=>m.id===payload.message_id)||null);return true;}catch(e){setError(liveError(e));return false;}};
  return <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface" aria-label="Live chat">
    <header className="flex items-center justify-between border-b border-ink/10 px-4 py-3"><h2 className="font-semibold text-ink">Live chat</h2><span className="text-xs text-muted" role="status">{connected?'Connected':live?'Reconnecting':'Replay chat'}</span></header>
    {pinned?<div className="flex gap-2 border-b border-ink/10 bg-surface-elevated px-4 py-3 text-sm text-ink"><Pin size={15} className="mt-1 shrink-0"/><p className="break-words"><span className="font-semibold">{pinned.author.full_name||pinned.author.username}: </span>{pinned.body}</p>{moderator?<button type="button" aria-label="Unpin message" onClick={()=>void act('pin',{message_id:null})}>×</button>:null}</div>:null}
    <div className="max-h-[440px] flex-1 overflow-y-auto p-4" aria-label="Recent chat messages">
      {cursor?<button type="button" disabled={loading||messages.length>=150} onClick={()=>void load(cursor)} className="mb-4 min-h-10 text-xs text-muted underline">{messages.length>=150?'History limit reached':loading?'Loading…':'Earlier messages'}</button>:null}
      {!messages.length?<p className="py-8 text-center text-sm text-muted">{loading?'Loading chat…':'Start the conversation.'}</p>:null}
      {messages.map(message=><div key={message.id} className="group mb-3 break-words text-sm"><div className="flex items-baseline gap-2"><span className="font-semibold text-ink">{message.author.full_name||message.author.username||'Member'}</span>{message.role!=='viewer'?<span className="text-[10px] capitalize text-muted">{message.role}</span>:null}<time className="ml-auto shrink-0 text-[10px] text-muted" dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div><p className={message.removed?'italic text-muted':'text-ink'}>{message.removed?'Message removed':message.body}</p>{!message.removed?<div className="flex gap-3 text-muted">{moderator?<><button type="button" aria-label="Pin message" className="min-h-8" onClick={()=>void act('pin',{message_id:message.id})}><Pin size={13}/></button><button type="button" aria-label="Remove message" className="min-h-8" onClick={()=>void act('remove_message',{message_id:message.id}).then(ok=>{if(ok)setMessages(items=>items.map(item=>item.id===message.id?{...item,removed:true,body:''}:item));})}><Trash2 size={13}/></button></>:null}<button type="button" aria-label="Report message" className="min-h-8" onClick={()=>{const reason=window.prompt('Why are you reporting this message?');if(reason?.trim())void act('report',{message_id:message.id,reason:reason.trim().slice(0,1000)});}}><Flag size={13}/></button></div>:null}</div>)}
    </div>
    {error?<p role="alert" className="border-t border-ink/10 px-4 py-2 text-xs text-ink">{error}<button type="button" onClick={()=>void load()} className="ml-2 underline">Refresh chat</button></p>:null}
    <div className="border-t border-ink/10 p-3"><div className="mb-2 flex items-center gap-2">{([['heart','Love'],['applause','Applause'],['fire','Fire']] as const).map(([id,label])=><button type="button" key={id} disabled={!live} onClick={()=>void act('reaction',{reaction:id})} className="min-h-10 rounded-full bg-surface-elevated px-3 text-xs text-ink">{id==='heart'?<Heart size={14} className="mr-1 inline"/>:id==='applause'?'👏 ':'🔥 '}{label}</button>)}{reaction?<span aria-live="polite" className="text-sm text-muted">{reaction==='heart'?'♥':reaction==='fire'?'🔥':'👏'}</span>:null}</div>
      <form className="flex items-end gap-2" onSubmit={async event=>{event.preventDefault();if(!text.trim()||busy)return;setBusy(true);setError('');if(!request.current||request.current.text!==text.trim())request.current={id:crypto.randomUUID(),text:text.trim()};try{const result=await liveCommand(client,detail.session.id,'chat',{body:request.current.text},request.current.id);const message=parseLiveMessage(result.message);if(message)setMessages(previous=>mergeLiveMessages(previous,[message]));setText('');request.current=null;}catch(e){setError(liveError(e));}finally{setBusy(false);}}}>
        <textarea value={text} onChange={e=>setText(e.target.value)} maxLength={500} disabled={!live||detail.capabilities.chat!==true} rows={2} aria-label="Message the live chat" placeholder={live?'Say something…':'Chat has ended'} className="min-h-11 w-full resize-none rounded-lg border border-ink/10 bg-[var(--canvas)] px-3 py-2 text-sm text-ink"/><button type="submit" disabled={!live||busy||!text.trim()||detail.capabilities.chat!==true} aria-label="Send chat message" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-ink text-[var(--canvas)] disabled:opacity-40"><Send size={17}/></button>
      </form><p className="mt-2 text-[10px] text-muted">{text.length}/500 · Latest 150 messages kept on this device.</p>
    </div>
  </section>;
}
