'use client';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Plus,X,Search,Lock,Globe,Users} from 'lucide-react';
import {getMemoryBooks,type MemoryBookInfo,type MemoryShelf} from '@/lib/memoryAlbum';
import {getProfileNavigationStore,profileNavigationKey,safeProfileMemoryRows} from '@/lib/profileNavigation';
import {memoryBookShelfRevision,onMemoryBookShelfChanged} from '@/lib/memoryBookEvents';
import {withTimeout} from '@/lib/withTimeout';
import {memoryCoverMedia,memoryAudienceLabel} from '../../shared/memoryBookDesign';
import {ResponsiveMemoryBookCover} from './memory/MemoryBookCover';
import {MemoryBookDesigner} from './memory/MemoryBookDesigner';
import {useMemoryDialog} from './memory/useMemoryDialog';
export function MemoryAlbumBook(props:{profileId:string}) {
 const [navigationStore]=useState(getProfileNavigationStore);
 const session=useSyncExternalStore(navigationStore.subscribe,navigationStore.getSnapshot,navigationStore.getServerSnapshot);
 return <MemoryAlbumShelf key={`${props.profileId}:${session.revision}`} {...props} navigationStore={navigationStore} session={session}/>;
}
type ShelfMemory={revision:number;shelf:MemoryShelf};
function MemoryAlbumShelf({profileId,navigationStore,session}:{profileId:string;navigationStore:ReturnType<typeof getProfileNavigationStore>;session:ReturnType<ReturnType<typeof getProfileNavigationStore>['getSnapshot']>}) {
 const router=useRouter();
 const cacheScope=session.owner===profileId?session.scope:null,cacheKey=profileNavigationKey(profileId,'books');
 const [initial]=useState(()=>{
  const memory=navigationStore.cache.read<ShelfMemory>(cacheScope,cacheKey);
  return memory?.revision===memoryBookShelfRevision(profileId)&&memory.shelf.is_owner?{...memory.shelf,books:safeProfileMemoryRows(memory.shelf.books)}:null;
 });
 const [books,setBooks]=useState<MemoryBookInfo[]>(initial?.books??[]),[isOwner,setIsOwner]=useState(initial?.is_owner??false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[creating,setCreating]=useState(false),[collection,setCollection]=useState(false),[query,setQuery]=useState(''),[filter,setFilter]=useState('All');const epoch=useRef(0),request=useRef<AbortController|null>(null);
 const dialog=useMemoryDialog(collection,()=>setCollection(false));
 const [loading,setLoading]=useState(!initial),[loaded,setLoaded]=useState(!!initial);
 useEffect(()=>{
  if(!session.initialized)return;
  const g=++epoch.current,revision=memoryBookShelfRevision(profileId),controller=new AbortController();
  request.current=controller;
  const current=()=>g===epoch.current&&navigationStore.getSnapshot().revision===session.revision;
  queueMicrotask(()=>{if(current()){setLoading(true);setError('');}});
  void withTimeout(getMemoryBooks(profileId,controller.signal)).then(s=>{
   if(!current()||revision!==memoryBookShelfRevision(profileId))return;
   const owner=s.is_owner&&session.owner===profileId;
   const shelf={is_owner:owner,books:s.books.filter(b=>owner||b.count>0)};
   setIsOwner(shelf.is_owner);setBooks(shelf.books);setLoaded(true);
   if(shelf.is_owner)navigationStore.cache.save(cacheScope,cacheKey,{revision,shelf});
  }).catch(()=>{controller.abort();if(current())setError('Memory books could not load. Retry.');}).finally(()=>{if(request.current===controller)request.current=null;if(current())setLoading(false);});
  return()=>{epoch.current += 1;controller.abort();if(request.current===controller)request.current=null;};
 },[profileId,attempt,navigationStore,session.initialized,session.revision,session.owner,cacheScope,cacheKey]);
 useEffect(()=>onMemoryBookShelfChanged(profileId,()=>{epoch.current++;request.current?.abort();setAttempt(value=>value+1);}),[profileId]);
 useEffect(()=>{const refresh=()=>{if(!document.hidden&&!request.current)setAttempt(x=>x+1);};const timer=setInterval(refresh,240000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[]);
 if(loaded&&!books.length&&!isOwner&&!error)return null;
 const filtered=books.filter(b=>(b.title+' '+(b.subtitle??'')).toLowerCase().includes(query.toLowerCase())&&(filter==='All'||(filter==='Public'?b.audience==='profile':b.audience!=='profile')));
 const card=(b:MemoryBookInfo,audience=false)=><Link key={b.id} href={'/album/'+b.id} onClick={()=>setCollection(false)} aria-label={`${b.title}, ${b.count} memories`} className="group block min-w-0"><span className="block transition-transform duration-200 group-hover:-translate-y-1 motion-reduce:transform-none"><ResponsiveMemoryBookCover artwork={b.cover_artwork} title={b.title} subtitle={b.subtitle} color={b.cover_color} design={b.cover_design} {...memoryCoverMedia(b.cover_page)}/></span><span className="mt-3 block truncate font-display text-lg text-ink">{b.title}</span><span className="mt-1 flex items-center gap-1.5 text-xs text-muted">{audience?<>{b.audience==='only_me'?<Lock size={12}/>:b.audience==='profile'?<Globe size={12}/>:<Users size={12}/>} {memoryAudienceLabel(b.audience)}</>:b.count+' '+(b.count===1?'memory':'memories')}</span></Link>;
 return <section className="rounded-2xl border border-ink/10 bg-white p-5"><header className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold tracking-tight text-ink">Memory books</h2><p className="mt-1 text-xs text-muted">A collection of places, people and moments.</p></div>{!!books.length&&<button onClick={()=>setCollection(true)} className="min-h-11 text-sm text-muted">View all</button>}</header>{error&&!creating&&<button className="mb-4 text-sm text-muted underline" onClick={()=>setAttempt(x=>x+1)}>{error}</button>}<div className="grid grid-cols-2 gap-4 pb-4 min-[1200px]:grid-cols-4">{loading&&!books.length&&!isOwner&&<span role="status" aria-label="Loading memory books" className="block aspect-[200/262] animate-pulse rounded bg-ink/10 motion-reduce:animate-none"/>}{books.slice(0,4).map(b=>card(b))}</div>{isOwner&&<button onClick={()=>{setCreating(true);setError('');}} aria-label="Create memory book" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ink/25 text-sm text-ink"><Plus size={18}/>New book</button>}
 {collection&&<div ref={dialog} tabIndex={-1} className="fixed inset-0 z-50 flex items-end justify-center bg-[#071326]/55 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Your memory books" onKeyDown={e=>{if(e.key==='Escape')setCollection(false);}}><section className="flex max-h-[94dvh] w-full max-w-[660px] flex-col rounded-t-3xl bg-[var(--canvas)] p-5 text-ink shadow-2xl sm:rounded-3xl sm:p-7"><header className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl">Memory books</h2><button aria-label="Close memory books" onClick={()=>setCollection(false)} className="flex h-11 w-11 items-center justify-center"><X size={21}/></button></header><label className="mb-4 flex items-center gap-2 rounded-full bg-ink/5 px-4 py-3"><Search size={17} className="text-muted"/><input aria-label="Search memory books" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your books" className="w-full bg-transparent text-sm outline-none"/></label><div className="mb-6 flex rounded-full bg-ink/5 p-1" role="tablist" aria-label="Book visibility">{['All','Public','Private'].map(f=><button key={f} role="tab" aria-selected={filter===f} onClick={()=>setFilter(f)} className={'min-h-10 flex-1 rounded-full text-sm '+(filter===f?'bg-pearl font-semibold text-on-pearl':'text-muted')}>{f}</button>)}</div><div className="overflow-y-auto px-1 pb-4"><div className="grid grid-cols-2 gap-x-5 gap-y-7">{filtered.map(b=>card(b,true))}</div>{!filtered.length&&<p className="py-10 text-center text-sm text-muted">No books match your search.</p>}</div>{isOwner&&<button onClick={()=>{setCollection(false);setCreating(true);}} className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#142642] font-display text-lg text-white"><Plus size={20}/>New book</button>}</section></div>}
 {creating&&<MemoryBookDesigner ownerId={profileId} onClose={()=>setCreating(false)} onCreated={id=>{setCreating(false);router.push('/album/'+id);}}/>}
 </section>;
}
