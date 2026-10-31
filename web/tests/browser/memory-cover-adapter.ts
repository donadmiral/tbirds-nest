/** Test-only Auth/RPC boundary for the real book designer and editor. */
import type {createClient as actualClient} from '../../lib/supabase/client';
import type {MemoryAlbum,MemoryPage} from '../../lib/memoryAlbum';
import type {MemoryCreativeSaveResult} from '../../../shared/memoryBookCreative';
export {MEMORY_COVER_COLORS as COVER_COLORS} from '../../../shared/memoryBookDesign';

export const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const OTHER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const key='platinum-synthetic-memory-cover';
const picture=(sky:string,land:string)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><path fill="${sky}" d="M0 0h400v600H0z"/><path fill="${land}" d="M0 320 120 200l90 100 100-140 90 170v270H0z"/><circle cx="310" cy="80" r="40" fill="#faf1dc"/></svg>`);
export const stories=[
 {id:'11111111-1111-4111-8111-111111111111',media_type:'image',media_url:picture('#9cae92','#ead9b7'),thumbnail_url:null,caption:'A summer morning',created_at:'2026-08-30T12:00:00Z'},
 {id:'22222222-2222-4222-8222-222222222222',media_type:'image',media_url:picture('#829fbb','#d39a87'),thumbnail_url:null,caption:'The evening walk',created_at:'2026-08-31T12:00:00Z'},
];
type Session={user:{id:string};access_token:string};
type Row={name:string;args:Record<string,unknown>;authorization:string|null};
const listeners=new Set<(event:string,session:Session|null)=>void>();
let user=OWNER,hold=false,release:(()=>void)|null=null;
const requests:Row[]=[];
const session=():Session=>({user:{id:user},access_token:`synthetic-${user}`});
export const savedBook=():MemoryAlbum|null=>{const value=localStorage.getItem(key);return value?JSON.parse(value):null;};
const store=(book:MemoryAlbum)=>localStorage.setItem(key,JSON.stringify(book));
const acknowledgement=(book:MemoryAlbum):MemoryCreativeSaveResult=>({id:book.id,presentation_revision:book.presentation_revision!,cover_artwork:book.cover_artwork!,film_settings:book.film_settings!});

function rpc(name:string,args:Record<string,unknown>={}){
 const row:Row={name,args:structuredClone(args),authorization:null};let signal:AbortSignal|undefined,pending:Promise<{data:unknown;error:unknown}>|null=null;
 const execute=async()=>{
  requests.push(row);
  if(name==='get_memory_book_creative_capabilities')return {data:{version:1,supported:true},error:null};
  if(name==='get_memory_book')return {data:savedBook(),error:null};
  if(!name.endsWith('_memory_book_creative_presentation'))return {data:null,error:null};
  if(hold)await new Promise<void>((resolve,reject)=>{const abort=()=>reject(new Error('Synthetic request aborted'));release=()=>{signal?.removeEventListener('abort',abort);resolve();};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
  if(signal?.aborted)throw new Error('Synthetic request aborted');
  if(row.authorization!==`Bearer synthetic-${OWNER}`)return {data:null,error:{message:'Owner authorization was not pinned'}};
  const old=savedBook();
  if(name==='save_memory_book_creative_presentation'&&(!old||old.id!==args.p_album||old.presentation_revision!==args.p_expected_revision))return {data:null,error:{message:'MEMORY_BOOK_CHANGED'}};
  const ids=name==='create_memory_book_creative_presentation'?args.p_story_ids as string[]:old!.pages.map(page=>page.story_id!);
  if(args.p_cover_story_id&&!ids.includes(String(args.p_cover_story_id)))return {data:null,error:{message:'Cover is not a book member'}};
  const pages:MemoryPage[]=ids.map((id,index)=>{const story=stories.find(value=>value.id===id)!;return {...story,id:`page-${index}`,story_id:id,sort_order:index,taken_at:story.created_at};});
  const book:MemoryAlbum={id:String(args.p_request_id??args.p_album),user_id:OWNER,is_owner:true,can_view:true,title:String(args.p_title),subtitle:String(args.p_subtitle),cover_color:String(args.p_cover_color),cover_design:String(args.p_cover_design),cover_story_id:args.p_cover_story_id as string|null,audience:String(args.p_audience??'profile'),count:pages.length,pages,presentation_revision:name==='create_memory_book_creative_presentation'?0:old!.presentation_revision!+1,cover_artwork:args.p_cover_artwork as MemoryAlbum['cover_artwork'],film_settings:args.p_film_settings as MemoryAlbum['film_settings']};
  store(book);return {data:acknowledgement(book),error:null};
 };
 const request={setHeader(_name:string,value:string){row.authorization=value;return request;},abortSignal(value:AbortSignal){signal=value;return request;},then(onFulfilled?:((value:{data:unknown;error:unknown})=>unknown)|null,onRejected?:((reason:unknown)=>unknown)|null){pending??=execute();return pending.then(onFulfilled,onRejected);}};
 return request;
}
export function createClient():ReturnType<typeof actualClient>{
 const query={select(){return query;},eq(){return query;},in(){return query;},then(resolve:(result:{data:unknown[];error:null})=>unknown){return Promise.resolve({data:[],error:null}).then(resolve);}};
 return {auth:{getSession:async()=>({data:{session:session()},error:null}),getUser:async(jwt?:string)=>({data:{user:{id:jwt?.replace('synthetic-','')??user}},error:null}),onAuthStateChange:(callback:(event:string,value:Session|null)=>void)=>{listeners.add(callback);return{data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};}},rpc,from:()=>query} as unknown as ReturnType<typeof actualClient>;
}
export async function getMemoryBook(){return savedBook();}
export async function getMemoryBooks(){const book=savedBook();return {is_owner:true,books:book?[book]:[]};}
export async function getMyStories(){return stories;}
export async function getAccessList(){return [];}
export async function searchPeople(){return [];}
const unsupported=async()=>{throw new Error('This fixture does not implement unrelated book mutations.');};
export const updateMemoryPage=unsupported,swapMemoryPages=unsupported,deleteMemoryPage=unsupported,addMemoryPage=unsupported,setAccess=unsupported;
export const memoryCoverQA={
 requests,savedBook,
 hold(){hold=true;},
 release(){hold=false;release?.();release=null;},
 changeAccount(id:string){user=id;for(const listener of listeners)listener('SIGNED_IN',session());},
 bumpRevision(){const book=savedBook();if(book)store({...book,presentation_revision:book.presentation_revision!+1});},
};
