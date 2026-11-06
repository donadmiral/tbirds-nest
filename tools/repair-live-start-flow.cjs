'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const pending=new Map();
function read(file){if(!pending.has(file))pending.set(file,fs.readFileSync(file,'utf8'));return pending.get(file);}
function edit(file,from,to){const value=read(file);if(value.includes(to)&&!value.includes(from))return;assert.equal(value.split(from).length-1,1,`Unexpected preimage in ${file}: ${from.slice(0,90)}`);pending.set(file,value.replace(from,to));}
function replaceTest(name,next){const file='tests/live-ui-repair.test.cjs',value=read(file);const start=value.indexOf(`test('${name}'`);assert.ok(start>=0,name);const end=value.indexOf('\ntest(',start+5);assert.ok(end>start,name);pending.set(file,value.slice(0,start)+next+'\n'+value.slice(end));}
const session='web/components/LiveSessionView.tsx';
edit(session,"  const onInteraction=", "  const [studioOpened,setStudioOpened]=useState(false),[autoPreview,setAutoPreview]=useState(false);\n  const onInteraction=");
edit(session,"setError('');setTab('watch');setInteractionSnapshot(null);", "setError('');const entry=new URLSearchParams(window.location.search),open=entry.get('studio')==='1';setTab(open?'studio':'watch');setStudioOpened(open);setAutoPreview(open&&entry.get('preview')==='1');setInteractionSnapshot(null);");
edit(session,"onClick={()=>{if(playback.session?.id===id)playback.close();setTab('studio');}}", "onClick={()=>{if(playback.session?.id===id)playback.close();setStudioOpened(true);setTab('studio');}}");
edit(session,"onClick={()=>setTab('studio')} className=", "onClick={()=>{playback.close();setAutoPreview(true);setStudioOpened(true);setTab('studio');}} className=");
edit(session,":tab==='studio'&&studio?<LiveStudio client={client} detail={detail} onRefresh={refresh}/>", ":tab==='studio'&&studio?null");
edit(session,'<div className="min-w-0 space-y-5">{tab===', '<div className="min-w-0 space-y-5">{studioOpened&&studio?<div hidden={tab!==\'studio\'}><LiveStudio key={id+identity.scope} client={client} detail={detail} autoPreview={autoPreview} onRefresh={refresh}/></div>:null}{tab===');
const studio='web/components/LiveStudio.tsx';
edit(studio,"export function LiveStudio({client,detail,onRefresh}:{client:LiveClient;detail:LiveDetail;onRefresh():void})", "export function LiveStudio({client,detail,onRefresh,autoPreview=false}:{client:LiveClient;detail:LiveDetail;onRefresh():void;autoPreview?:boolean})");
edit(studio,"  const producer=", "  const joinLock=useRef(false),controlLock=useRef(false),autoPreviewUsed=useRef(false);\n  const producer=");
edit(studio,"if(busy||joined)return;setBusy(true);setError('');const version=++epoch.current;", "if(joinLock.current||busy||joined||detail.capabilities.multi_camera!==true||['ended','cancelled','ending'].includes(detail.session.state))return;joinLock.current=true;setBusy(true);setError('');const version=++epoch.current;");
edit(studio,"if(local){setMic(local.tracks.audio.state==='playable');", "if(local){if(isLiveUuid(local.user_id)){setSource(value=>rows.some(row=>row.user_id===value)?value:local.user_id);setSelected(value=>value.length?value.filter(id=>rows.some(row=>row.user_id===id)):[local.user_id]);}setMic(local.tracks.audio.state==='playable');");
edit(studio,"await instance.join({url:access.roomUrl,token:access.token,startVideoOff:true,startAudioOff:true});", "await withTimeout(instance.join({url:access.roomUrl,token:access.token,startVideoOff:true,startAudioOff:true}),25000);");
edit(studio,"setJoined(true);sync();const available=await instance.enumerateDevices();if(alive.current&&version===epoch.current)setDevices(available.devices);onRefresh();", "await instance.setLocalVideo(true);if(!alive.current||version!==epoch.current){await instance.destroy();return;}setJoined(true);sync();try{const available=await instance.enumerateDevices();if(alive.current&&version===epoch.current)setDevices(available.devices);}catch{/* Default devices remain usable. */}onRefresh();");
edit(studio,"}finally{if(alive.current&&version===epoch.current)setBusy(false);}\n  };\n  const control", "}finally{joinLock.current=false;if(alive.current&&version===epoch.current)setBusy(false);}\n  };\n  useEffect(()=>{if(['ended','cancelled','ending'].includes(detail.session.state))void leave();},[detail.session.state]);\n  useEffect(()=>{if(autoPreview&&!autoPreviewUsed.current&&detail.capabilities.multi_camera===true&&!['ended','cancelled','ending'].includes(detail.session.state)){autoPreviewUsed.current=true;void join();}},[autoPreview,detail.capabilities.multi_camera,detail.session.state]);\n  const control");
edit(studio,"if(busy)return;setBusy(true);setError('');setNotice('');const version=epoch.current;", "if(controlLock.current||busy||action==='start'&&(!joined||detail.capabilities.broadcast!==true||!participants.some(p=>p.tracks.video.state==='playable'||p.tracks.screenVideo.state==='playable'||p.tracks.audio.state==='playable'))||['ended','cancelled','ending'].includes(detail.session.state))return;controlLock.current=true;setBusy(true);setError('');setNotice('');const version=epoch.current;");
edit(studio,"}finally{if(alive.current&&version===epoch.current)setBusy(false);}\n  };\n  const button", "}finally{controlLock.current=false;if(alive.current&&version===epoch.current)setBusy(false);}\n  };\n  const button");
edit(studio,">Production studio</h2>", ">{onAir?'Your live':'Camera preview'}</h2>");
edit(studio,"Join backstage, prepare your sources, then go live.", "Preview first. Your microphone starts muted. Nothing broadcasts until you select Go live.");
edit(studio,"Your camera and microphone start off.", "Preview your camera before broadcasting. Your microphone starts muted.");
edit(studio,"{busy?'Joining studio…':'Join studio'}", "{busy?'Opening preview…':'Preview camera'}");
edit(studio,"disabled={!joined||busy||detail.capabilities.broadcast!==true}", "disabled={!joined||busy||detail.capabilities.broadcast!==true||!participants.some(p=>p.tracks.video.state==='playable'||p.tracks.screenVideo.state==='playable'||p.tracks.audio.state==='playable'))||['ended','cancelled','ending'].includes(detail.session.state)}");
{
 const value=read(studio),start=value.indexOf('      <div className="mt-4 flex flex-wrap gap-3">{onAir?'),end=value.indexOf('</div></div>\n      <div',start);
 assert.ok(start>=0&&end>start,'Find broadcast toolbar');
 const toolbar=value.slice(start,end+6);
 pending.set(studio,value.slice(0,start)+value.slice(end+6));
 edit(studio,"    {!joined?<div", "    {producer&&joined?<>"+toolbar+"</>:null}\n    {!joined?<div");
}
edit(studio,"{producer?<><div className=", "{producer?<details><summary className=\"min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink\">Stream tools and team</summary><div className=");
edit(studio,"</div></div></>:null}", "</div></div></details>:null}");
edit(studio,"audioTrack=participant.tracks.audio.persistentTrack,screenAudioTrack=participant.tracks.screenAudio.persistentTrack", "audioTrack=participant.tracks.audio.state==='playable'?participant.tracks.audio.persistentTrack:undefined,screenAudioTrack=participant.tracks.screenAudio.state==='playable'?participant.tracks.screenAudio.persistentTrack:undefined");
const native='src/screens/feed/LiveSessionScreen.tsx';
edit(native,"  const [studioOpened,setStudioOpened]=useState(route.params?.openStudio===true);", "  const [studioOpened,setStudioOpened]=useState(route.params?.openStudio===true);\n  const [previewRequested,setPreviewRequested]=useState(route.params?.previewCamera===true);");
edit(native,"setStudioOpened(route.params?.openStudio===true); setPeople([]);", "setStudioOpened(route.params?.openStudio===true); setPreviewRequested(route.params?.previewCamera===true); setPeople([]);");
edit(native,"button('Open camera preview',()=>{setTab('Studio');setStudioOpened(true);},false)", "button('Open camera preview',()=>{playback.close();setPreviewRequested(true);setTab('Studio');setStudioOpened(true);},false)");
edit(native,"autoPreview={route.params?.previewCamera===true}", "autoPreview={previewRequested}");
const admin='admin-web/components/LiveOperations.tsx';
edit(admin,"  return <div style={{display:'grid',gap:18}}>\n", "  const readiness=object(directory.capabilities)?directory.capabilities:{};\n  return <div style={{display:'grid',gap:18}}>\n    <section style={section} aria-label=\"Live service readiness\"><h2 style={{fontSize:16,fontWeight:700}}>Live service readiness</h2><p style={{fontSize:12,color:'var(--txt-muted)'}}>Current backend configuration. Enabled does not certify a successful camera broadcast.</p><div style={{display:'flex',gap:18,flexWrap:'wrap'}}>{[['create','Create streams'],['broadcast','Broadcasting'],['view','Playback'],['recording','Recording'],['reminders','Reminders']].map(([key,label])=><div key={key}><div style={{fontSize:12,color:'var(--txt-muted)'}}>{label}</div><strong style={{fontSize:14,color:readiness[key]===false?'var(--bad)':'var(--txt)'}}>{readiness[key]===true?'Enabled':readiness[key]===false?'Disabled':'Not loaded'}</strong></div>)}</div>{readiness.broadcast===false?<p role=\"status\" style={{fontSize:13,color:'var(--bad)',marginTop:12}}>Broadcasting is disabled in this backend. Creating a draft will not make a stream live.</p>:null}</section>\n");
edit(admin,"{!loading&&!rows(directory.items).length?", "{!error&&!loading&&!rows(directory.items).length?");
const tests='tests/live-ui-repair.test.cjs';
edit(tests,"const directory = load('shared/liveDirectory.ts', {});", "const directory = load('shared/liveDirectory.ts', {});\nconst setup = load('shared/liveSetup.ts', {});");
edit(tests,"    '../../../shared/liveDirectory': directory,", "    '../../../shared/liveDirectory': directory,\n    '../../../shared/liveSetup': setup,");
replaceTest('scheduling never opens the camera automatically',`test('scheduling never opens the camera automatically', async () => {
  const app=quickStart();app.render();await app.h.settle();
  by(app.render(),'accessibilityLabel','Schedule for later').props.onPress();
  by(app.render(),'testID','live-preview-button').props.onPress();await app.h.settle();
  assert.equal(app.calls.length,1);assert.ok(Date.parse(app.calls[0][2].scheduled_at)>Date.now());
  assert.equal(app.routes[0][1].previewCamera,false);assert.equal(app.routes[0][1].openStudio,false);
});`);
replaceTest('invalid dates cannot create a stream',`test('invalid dates cannot create a stream', async () => {
  const app=quickStart({schedule:true});app.render();await app.h.settle();
  by(app.render(),'accessibilityLabel','Scheduled date').props.onChangeText('invalid');
  by(app.render(),'testID','live-preview-button').props.onPress();await app.h.settle();assert.equal(app.calls.length,0);
  assert.match(words(app.render()),/Choose a date/);
});`);
replaceTest('Schedule entry never opens an unscheduled camera preview',`test('Schedule entry never opens an unscheduled camera preview',async()=>{
  const app=quickStart({schedule:true});app.render();await app.h.settle();const tree=app.render();
  assert.ok(by(tree,'accessibilityLabel','Scheduled date'));assert.ok(by(tree,'accessibilityLabel','Scheduled time'));
  assert.equal(by(tree,'testID','live-preview-button').props.accessibilityLabel,'Schedule stream');
  by(tree,'testID','live-preview-button').props.onPress();await app.h.settle();assert.equal(app.calls.length,1);assert.equal(app.routes[0][1].previewCamera,false);
});`);
pending.set(tests,read(tests)+`\ntest('switching from Schedule to Live now discards the scheduled timestamp',async()=>{
 const app=quickStart({schedule:true});app.render();await app.h.settle();by(app.render(),'accessibilityLabel','Live now').props.onPress();
 assert.equal(by(app.render(),'accessibilityLabel','Scheduled date'),undefined);by(app.render(),'testID','live-preview-button').props.onPress();await app.h.settle();
 assert.equal(app.calls[0][2].scheduled_at,undefined);assert.equal(app.routes[0][1].previewCamera,true);
});
test('scheduling is usable when only immediate broadcasting is disabled',async()=>{
 const app=quickStart({schedule:true,caps:{create:true,broadcast:false,recording:false}});app.render();await app.h.settle();
 assert.equal(by(app.render(),'testID','live-preview-button').props.disabled,false);by(app.render(),'testID','live-preview-button').props.onPress();await app.h.settle();
 assert.equal(app.calls.length,1);assert.equal(app.calls[0][2].recording_enabled,false);assert.equal(app.routes[0][1].openStudio,false);
});
test('web studio stays mounted across watch tabs and immediate setup selects studio',()=>{
 const source=read('web/components/LiveSessionView.tsx');assert.match(source,/entry.get\\('studio'\\)/);assert.match(source,/<div hidden=\\{tab!=='studio'\\}><LiveStudio/);
 assert.match(read('web/app/live/new/page.tsx'),/studio=1&preview=1/);
 const studio=read('web/components/LiveStudio.tsx');assert.match(studio,/autoPreviewUsed/);assert.match(studio,/setLocalVideo\\(true\\)/);assert.doesNotMatch(studio,/setLocalAudio\\(true\\)/);
});
test('operations desk exposes disabled backend capability gates',()=>{
 const source=read('admin-web/components/LiveOperations.tsx');assert.match(source,/Live service readiness/);assert.match(source,/readiness.broadcast===false/);
});
`);
for(const [file,value]of pending)fs.writeFileSync(file,value);
console.log(JSON.stringify({changed:[...pending.keys()],backendChanged:false}));
