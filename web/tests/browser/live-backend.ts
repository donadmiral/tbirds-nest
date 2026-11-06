export const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const listeners=new Set<()=>void>();let snapshot={owner:id(1),scope:'qa:'+id(1),revision:1,initialized:true,changed:false};
const subscriptions=new Set<{event:string;callback:(payload:{payload:unknown})=>void}[]>();
export const calls:{name:string;args:Record<string,unknown>}[]=[];
let failClip=true;
let liveRole='host',ownRequest:string|null=null;
const joinRequests:{user_id:string;status:string;created_at:string;profile:{full_name:string}}[]=[];
let holdChat=false,pendingChatRead:((value:unknown)=>void)|null=null;
const session={id:id(10),host:{id:id(1),full_name:'Don Musa',username:'don',is_verified:true},title:'Global business live',description:'A live conversation with founders.',state:'live',topic:'business',language:'en',audience:'public',viewer_count:1342,recording_enabled:true,replay_available:false};
const clip={id:id(20),session_id:id(10),title:'A founder explains the opportunity',caption:'A short excerpt from our live discussion.',tags:['business'],state:'ready',start_ms:90000,end_ms:120000,created_at:new Date().toISOString(),formats:['horizontal','vertical'],share_count:9,view_count:120};
let settings={viewer_clipping:false,review_required:true,watermark_required:true,brand_text:'Platinum Circles',copyright_policy:'standard',approved_user_ids:[],can_manage:true};
const history:Record<string,unknown>[]=[];
const interactions={polls:[{id:id(30),question:'What should we cover next?',state:'open',options:[{id:id(31),label:'Business',votes:8},{id:id(32),label:'Technology',votes:2}],total_votes:10,my_option_id:null as string|null}],questions:[{id:id(40),body:'How do you choose a market?',author:{id:id(2),full_name:'Viewer',username:'viewer'},votes:3,upvoted:false,answer:'',state:'open'}],chapters:[{id:id(50),title:'Opening discussion',position_ms:0}]};
let followingRoomHost=false;
function reply(data:unknown,error:unknown=null){return Promise.resolve({data,error});}
const client={
  rpc(name:string,args:Record<string,unknown>={}){calls.push({name,args});
    if(name==='live_directory')return reply({items:[session],next_cursor:null,capabilities:{create:true,broadcast:true,view:true,recording:true,reminders:true}});
    if(name==='feed_block_exists')return reply(false);
    if(name==='get_profile'&&args.p_profile_id===id(2))return reply({id:id(2),viewer_follows:followingRoomHost,viewer_requested:false});
    if(name==='set_live_host_follow_v1'&&args.p_session_id===session.id&&args.p_host_id===id(2)&&liveRole==='viewer'&&typeof args.p_follow==='boolean'){followingRoomHost=args.p_follow;return reply({state:followingRoomHost?'following':'none'});}
    if(name==='live_session')return reply({session:liveRole==='viewer'?{...session,host:{...session.host,id:id(2)}}:session,role:liveRole,join_requests:joinRequests,own_join_request:ownRequest?{status:ownRequest,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}:null,stage:{limit:12,occupied:1,available:11},can_request_join:liveRole==='viewer'&&ownRequest!=='pending',guest_topic:`live-guests:${id(10)}:${id(1)}`,capabilities:{create:true,broadcast:true,view:true,recording:true,reminders:true,multi_camera:true,screen_share:true,chat:true},members:[],chat_topic:`live:${id(10)}:${id(11)}`,pinned_message:null,invitation:null});
    if(name==='live_messages')return holdChat?new Promise(resolve=>{pendingChatRead=resolve;}):reply({items:[],next_cursor:null});
    if(name==='live_interactions')return reply({...interactions,can_manage:true});
    if(name==='live_interaction_command'){const payload=args.p_payload as Record<string,unknown>;if(args.p_action==='poll_vote'){interactions.polls[0].my_option_id=String(payload.option_id);interactions.polls[0].total_votes++;interactions.polls[0].options.find(item=>item.id===payload.option_id)!.votes++;}if(args.p_action==='question_ask')interactions.questions.push({id:id(41),body:String(payload.body),author:{id:id(1),full_name:'Don Musa',username:'don'},votes:0,upvoted:false,answer:'',state:'open'});if(args.p_action==='question_answer')interactions.questions.find(item=>item.id===payload.question_id)!.answer=String(payload.answer);if(args.p_action==='chapter_add')interactions.chapters.push({id:id(51),title:String(payload.title),position_ms:Number(payload.position_ms)||60000});return reply({ok:true});}
    if(name==='live_analytics')return reply({current_viewers:1342,peak_viewers:1500,unique_viewers:null,watch_minutes:null,chat_messages:500,reactions:null,clips:1,clip_views:120,clip_shares:9,measured_at:new Date().toISOString()});
    if(name==='live_clip_context')return reply({can_clip:true,can_manage:true,available_start_ms:0,available_end_ms:120000,max_duration_ms:600000,recording_available:true,settings});
    if(name==='live_clip_library')return reply({items:[clip],next_cursor:null});
    if(name==='live_clip_get')return reply({clip:{...clip,moderation_state:'approved',copyright_state:'cleared',subtitles:[{start_ms:0,end_ms:3000,text:'A clear opportunity.'}]},permissions:{can_manage:true,can_publish:true,can_review:true,can_share_link:history.some(item=>item.state==='published')},publication_history:{items:history,next_cursor:null}});
    if(name==='live_clip_history')return reply({items:history,next_cursor:null});
    if(name==='live_clip_settings')return reply(settings);
    if(name==='live_platform_connections')return reply({items:[],history:history.filter(item=>['x','facebook','instagram','youtube','tiktok'].includes(String(item.destination))),next_cursor:null});
    if(name==='live_clip_command'){const payload=args.p_payload as Record<string,unknown>;if(args.p_action==='create'&&failClip){failClip=false;return reply(null,{message:'NETWORK_ERROR'});}if(args.p_action==='settings')settings={...settings,...payload};if(['publish','share'].includes(String(args.p_action)))history.unshift({id:id(60+history.length),clip_id:clip.id,destination:payload.destination,platform:payload.destination,state:args.p_action==='share'?'export_required':'published',created_at:new Date().toISOString(),retryable:false});return reply({ok:true,clip_id:id(21),post_id:args.p_action==='publish'?id(22):undefined,state:args.p_action==='share'?'export_required':undefined});}
    if(name==='live_command'){const action=String(args.p_action);if(action==='request_join')ownRequest='pending';if(action==='cancel_join_request')ownRequest='cancelled';if(['accept_join_request','decline_join_request'].includes(action))joinRequests.splice(0);return reply({ok:true,session_id:id(10)});}
    return reply({ok:true});
  },
  functions:{invoke(name:string,{body}:{body:Record<string,unknown>}){calls.push({name,args:body});if(name==='live-playback')return reply({url:'https://media.live.test/master.m3u8',expires_at:new Date(Date.now()+120000).toISOString(),format:'hls',live:true,tracks:[]});if(name==='live-clip-media')return reply({url:'https://media.live.test/'+(body.format==='thumbnail'?'thumbnail.jpg':body.format==='captions'?'captions.vtt':'source.mp4'),filename:'live-clip.mp4',expires_at:new Date(Date.now()+120000).toISOString()});return reply({ok:true});}},
  channel(){const rows:{event:string;callback:(payload:{payload:unknown})=>void}[]=[];subscriptions.add(rows);const channel={on(_type:string,filter:{event:string},callback:(payload:{payload:unknown})=>void){rows.push({event:filter.event,callback});return channel;},subscribe(callback?:(status:string)=>void){queueMicrotask(()=>callback?.('SUBSCRIBED'));return channel;},rows};return channel;},
  removeChannel(channel:{rows:{event:string;callback:(payload:{payload:unknown})=>void}[]}){subscriptions.delete(channel.rows);return Promise.resolve();},
  realtime:{setAuth:async()=>{}},
  auth:{getSession:()=>reply({session:{user:{id:id(1)},access_token:'synthetic'}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
};
export const createClient=()=>client;
export const getNavigationStore=()=>({subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);},getSnapshot:()=>snapshot,getServerSnapshot:()=>snapshot});
export function broadcast(event:string,payload:unknown){for(const rows of subscriptions)for(const row of rows)if(row.event===event)row.callback({payload});}
export function signout(){snapshot={...snapshot,owner:null as unknown as string,scope:null as unknown as string,revision:2};listeners.forEach(listener=>listener());}
Object.assign(window,{__liveFixture:{calls,broadcast,signout,id,setGuestMode(role:string){liveRole=role;ownRequest=role==='guest'?'accepted':null;broadcast('guest_requests_changed',{session_id:id(10)});},addJoinRequest(){joinRequests.push({user_id:id(3),status:'pending',created_at:new Date().toISOString(),profile:{full_name:'Guest applicant'}});broadcast('guest_requests_changed',{session_id:id(10)});},holdChatRead(){holdChat=true;},chatReadPending:()=>!!pendingChatRead,completeChatRead(items:unknown[]){holdChat=false;pendingChatRead?.({data:{items,next_cursor:null},error:null});pendingChatRead=null;}}});
