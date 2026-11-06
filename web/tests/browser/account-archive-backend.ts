const id = '20000000-0000-4000-8000-000000000001';
const owner = '10000000-0000-4000-8000-000000000001';
let polls = 0;
export const createClient = () => ({
  auth:{onAuthStateChange: (cb:any) => {queueMicrotask(()=>cb('INITIAL_SESSION',{user:{id:owner}}));return { data:{subscription:{unsubscribe(){}}}};},
    getUser:async()=>({data:{user:{id:owner}}})},
  functions: {invoke:async()=>({error:{context:{json:async()=>({code:'EXPORT_TOO_LARGE'})}}})},
  rpc:async(name:string)=> name === 'request_account_archive' ? {data:id} : {data:{id,owner_id:owner,format:'jsonl-v1',
    status:++polls === 1 ? 'queued':'ready',part_count:1,byte_count:10,next_part:0}}
});
