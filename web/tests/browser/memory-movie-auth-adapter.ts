/** Test-only deterministic Auth/RPC boundary. Never included in an app build. */
import type {MemoryPage} from '../../lib/memoryAlbum';
export const FIXTURE_BOOK='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
type FixtureWindow=Window&{movieBook?:{id:string;title:string;can_view:boolean;is_owner:boolean;pages:MemoryPage[];presentation_revision:number;film_settings?:unknown};movieAuth?:(id:string)=>void;movieUser?:string};
const listeners=new Set<(event:string,session:{user:{id:string}}|null)=>void>();
const target=()=>window as FixtureWindow;
export function createClient(){
 target().movieAuth=id=>{target().movieUser=id;for(const listener of listeners)listener('SIGNED_IN',{user:{id}});};
 return {auth:{getUser:async()=>({data:{user:{id:target().movieUser??OWNER}},error:null}),getSession:async()=>({data:{session:{user:{id:target().movieUser??OWNER},access_token:'synthetic-only'}},error:null}),onAuthStateChange:(callback:(event:string,session:{user:{id:string}}|null)=>void)=>{listeners.add(callback);return{data:{subscription:{unsubscribe(){listeners.delete(callback);}}}};}},rpc:async(name:string)=>({data:name==='get_memory_book'?target().movieBook:null,error:null})};
}
