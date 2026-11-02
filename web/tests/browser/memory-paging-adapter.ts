/** Local synthetic transport for the actual web book/shelf components. */
import type { createClient as actualClient } from '../../lib/supabase/client';
export const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',BOOK='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="#87a8ab" d="M0 0h100v100H0z"/></svg>');
const pages=Array.from({length:61},(_,i)=>({id:`page-${i}`,story_id:`${String(i+1).padStart(8,'0')}-1111-4111-8111-111111111111`,media_type:'image',media_url:image,thumbnail_url:image,caption:`Memory ${i+1}`,duration_sec:2,sort_order:i}));
const book={id:BOOK,user_id:OWNER,is_owner:true,can_view:true,title:'Complete memories',subtitle:'All 61 memories remain available',cover_color:'cream',cover_design:'postcard',audience:'profile',is_default:true,presentation_revision:1,count:pages.length,pages,cover_page:pages[60],cover_pages:[pages[60]],cover_artwork:{version:1},film_settings:{version:1,mode:'automatic',style:'reflective',length:'full',order:'book',titleCard:false,originalAudio:false}};
const books=Array.from({length:31},(_,i)=>({...book,id:i===0?BOOK:`${String(i).padStart(8,'0')}-cccc-4ccc-8ccc-cccccccccccc`,title:`Collection ${String(i+1).padStart(2,'0')}`,count:1,pages:[pages[0]],cover_page:pages[0],cover_pages:[pages[0]],audience:i%2?'only_me':'profile',is_default:i===0}));
type Session={user:{id:string};access_token:string};
type Result={data:unknown;error:unknown};
let viewer:string|null=OWNER,authRevision=0;
const listeners=new Set<(event:string,session:Session|null)=>void>();
const session=():Session|null=>viewer?{user:{id:viewer},access_token:`fixture-${viewer}-${authRevision}`}:null;
const held=new Set(['book-next','shelf-next']),pending:{kind:string;release:()=>void}[]=[];
const requests:{name:string;args:Record<string,unknown>;viewer:string|null;aborted?:boolean;pinned?:boolean}[]=[];
function request(name:string,args:Record<string,unknown>={}){
 let signal:AbortSignal|undefined,authorization:string|undefined,one=false,promise:Promise<Result>|null=null;
 const execute=async()=>{
  const owner=viewer,record={name,args,viewer:owner,aborted:false,pinned:authorization===`Bearer ${session()?.access_token}`};requests.push(record);
  const kind=name==='get_memory_book_page_v2'&&args.p_cursor?'book-next':name==='get_memory_books_page_v2'&&args.p_cursor?'shelf-next':name;
  if(held.has(kind))await new Promise<void>((resolve,reject)=>{
   const abort=()=>{record.aborted=true;reject(Error('Fixture cancelled'));};
   pending.push({kind,release:()=>{signal?.removeEventListener('abort',abort);resolve();}});
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
  if(signal?.aborted){record.aborted=true;throw Error('Fixture cancelled');}
  if(name==='get_paged_reader_capabilities')return{data:{version:1,books:true,inbox:false},error:null};
  if(name==='get_next_memory_book_v2')return{data:null,error:null};
  if(name==='get_memory_book_page_v2'){
   if(owner!==OWNER)return{data:{version:2,can_view:false,pages:[],count:0},error:null};
   const start=Number((args.p_cursor as {after?:number}|null)?.after||0),end=Math.min(start+Number(args.p_limit||24),pages.length);
   return{data:{...(start?{id:BOOK,can_view:true}:book),version:2,revision:'1',metadata_included:start===0,pages:pages.slice(start,end),has_more:end<pages.length,
    next_cursor:end<pages.length?{version:2,viewer:owner,album:BOOK,revision:'1',after:end}:null},error:null};
  }
  if(name==='get_memory_books_page_v2'){
   const start=Number((args.p_cursor as {after?:number}|null)?.after||0),all=owner===OWNER?books:[],end=Math.min(start+Number(args.p_limit||12),all.length);
   return{data:{version:2,is_owner:owner===OWNER,revision:'1',books:all.slice(start,end),has_more:end<all.length,
    next_cursor:end<all.length?{version:2,viewer:owner,owner:OWNER,revision:'1',after:end}:null},error:null};
  }
  if(name==='get_memory_book_creative_capabilities')return{data:{version:1,supported:true},error:null};
  if(name==='profiles'&&one)return{data:{id:OWNER,full_name:'Fixture owner',username:'fixture_owner'},error:null};
  if(name==='get_memory_book'||name==='get_memory_albums')throw Error('Enabled paging unexpectedly used a full legacy reader');
  return{data:one?null:[],error:null};
 };
 const query={select(){return query;},eq(){return query;},in(){return query;},order(){return query;},limit(){return query;},
  maybeSingle(){one=true;return query;},single(){one=true;return query;},setHeader(name:string,value:string){if(name.toLowerCase()==='authorization')authorization=value;return query;},
  abortSignal(value:AbortSignal){signal=value;return query;},then(yes?:((r:Result)=>unknown)|null,no?:((e:unknown)=>unknown)|null){promise??=execute();return promise.then(yes,no);}};
 return query;
}
export function createClient():ReturnType<typeof actualClient>{return{
 auth:{getSession:async()=>({data:{session:session()},error:null}),getUser:async()=>({data:{user:viewer?{id:viewer}:null},error:null}),
  onAuthStateChange:(listener:(event:string,value:Session|null)=>void)=>{listeners.add(listener);return{data:{subscription:{unsubscribe:()=>listeners.delete(listener)}}};}},
 rpc:request,from:(name:string)=>request(name),functions:{invoke:async()=>{throw Error('No hosted media operations in paging fixture');}},
} as unknown as ReturnType<typeof actualClient>;}
export const pagingFixture={requests,release(kind:string){held.delete(kind);for(const entry of pending.splice(0)){if(entry.kind===kind)entry.release();else pending.push(entry);}},
 changeAccount(){viewer=OTHER;authRevision++;listeners.forEach(listener=>listener('SIGNED_IN',session()));}};
