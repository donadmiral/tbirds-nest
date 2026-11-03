import React from 'react';
const host='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const params=new URLSearchParams(window.location.search);
const state:any={calls:[],routes:[],created:0,destroyed:0,failCreate:params.get('fail')==='1',caps:{create:true,broadcast:params.get('broadcast')!=='0',view:true,multi_camera:true,recording:true,screen_share:true,reminders:true},session:{id,title:'Live stream',description:'',topic:'irl',state:'draft',audience:'invite',host:{id:host,full_name:'Synthetic host',username:'synthetic',is_verified:false},viewer_count:0,scheduled_at:null,replay_available:false,chat_mode:'open',slow_mode_seconds:0}};
(window as any).__liveStart=state;
const snapshot={owner:host,scope:'synthetic-host'};
const navigation={subscribe:()=>()=>{},getSnapshot:()=>snapshot,getServerSnapshot:()=>snapshot};
const client={rpc:async()=>({data:{items:[],next_cursor:null,capabilities:state.caps},error:null})};
export const createClient=()=>client;
export const getNavigationStore=()=>navigation;
export const useRouter=()=>({push:(url:string)=>{state.routes.push(url);history.pushState({},'',url);window.dispatchEvent(new Event('fixture-route'));}});
export default function Link({href,children,...props}:any){return <a href={href} {...props}>{children}</a>;}
export const record=(v:unknown)=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const liveError=(e:unknown)=>e instanceof Error?e.message:'Synthetic request failed';
export async function liveCommand(_client:unknown,_id:unknown,action:string,payload:any,requestId?:string){state.calls.push({action,payload,requestId});if(action==='create'){if(state.failCreate){state.failCreate=false;throw Error('Temporary connection failure. Retry.');}state.created++;state.session={...state.session,...payload,state:payload.scheduled_at?'scheduled':'draft'};return {ok:true,session_id:id};}return {ok:true};}
export async function getLiveDetail(){return {session:{...state.session},role:'host',capabilities:state.caps,members:[],chat_topic:'',reminded:false};}
export async function getLiveStage(){state.calls.push({action:'stage'});return {roomUrl:'https://synthetic.daily.co/test',token:'synthetic-only',can_screen_share:true,max_stage_members:12};}
export async function liveInvoke(_client:unknown,name:string,body:any){if(name!=='live-control')throw Error('Unexpected fixture service');state.calls.push({action:body.action,body});state.session={...state.session,state:body.action==='start'?'live':body.action==='stop'?'ended':state.session.state};return {ok:true};}
const playback={session:null,close(){},open(){},minimize(){}};
export const useLivePlayback=()=>playback;
export const LivePlayerSlot=()=> <div>Viewer playback fixture</div>;
export const LiveChat=()=> <div>Chat fixture</div>;
export const LiveInteractions=()=>null;
export const LiveAnalyticsPanel=()=> <div>Analytics fixture</div>;
export const parseLiveInteractions=()=>null;
