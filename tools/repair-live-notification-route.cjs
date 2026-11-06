'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const patches=[
 {path:'shared/notificationTap.ts',sha:'bd913e045578a9898cf88165ab77c52072ac0ac6',edits:[
  ['  call_id?: string;','  call_id?: string;\n  live_session_id?: string;'],
  ['  const callId = raw.call_id ?? raw.callId;',"  if (raw.type === 'live_stream') {\n    const liveId = raw.live_session_id ?? raw.sessionId;\n    if (notificationUuid(liveId)) data.live_session_id = liveId;\n  }\n  const callId = raw.call_id ?? raw.callId;"]]},
 {path:'src/navigation/AppNavigator.tsx',sha:'bb6f7db0d24a50942f2b52885b184ef9afdcdb85',edits:[
  ["  switch (data.type) {\n    case 'incoming_call':", "  switch (data.type) {\n    case 'live_stream':\n      if (data.live_session_id) navigationRef.current.navigate('LiveSession', { sessionId: data.live_session_id });\n      else navigationRef.current.navigate('Main', { screen: 'Feed', params: { screen: 'Notifications' } });\n      break;\n    case 'incoming_call':"]]}
];
const writes=patches.map(p=>{let text=fs.readFileSync(p.path,'utf8');const hash=crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');assert.equal(hash,p.sha,`Concurrent changes in ${p.path}`);for(const [from,to] of p.edits){assert.equal(text.split(from).length,2,`Exact preimage mismatch in ${p.path}`);text=text.replace(from,to);}return[p.path,text];});
for(const [path,text] of writes)fs.writeFileSync(path,text);
console.log(JSON.stringify({changed:writes.map(([path])=>path),serverPermissionsChanged:false}));
