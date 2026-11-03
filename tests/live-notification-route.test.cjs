const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('shared/notificationTap.ts','utf8'),moduleValue={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleValue,exports:moduleValue.exports,AbortController,setTimeout,clearTimeout,Promise});
const {notificationTapData,createNotificationTapController}=moduleValue.exports;
const id='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
test('Live notification keeps its validated session id',()=>{assert.equal(notificationTapData({type:'live_stream',live_session_id:id,recipient_id:user}).live_session_id,id);});
test('Legacy Live sessionId is normalized without trusting arbitrary screen names',()=>{const data=notificationTapData({type:'live_stream',sessionId:id,screen:'Admin',url:'https://evil.invalid'});assert.equal(data.live_session_id,id);assert.equal(data.screen,undefined);assert.equal(data.url,undefined);});
test('Invalid Live identifiers are never passed to navigation',()=>{for(const value of ['', 'not-a-uuid','https://evil.invalid',{},null])assert.equal(notificationTapData({type:'live_stream',live_session_id:value}).live_session_id,undefined);});
test('Other notification types cannot acquire a Live route from injected metadata',()=>{assert.equal(notificationTapData({type:'message',live_session_id:id}).live_session_id,undefined);});
test('Live response is account-bound and duplicate delivery is consumed once',async()=>{
 let handled=0;const session={scope:'scope-a',userId:user,accessToken:'synthetic-test-only'};
 const c=createNotificationTapController({session:()=>session,ready:()=>true,subscribeScope:()=>()=>{},handle:async data=>{assert.equal(data.live_session_id,id);handled++;}});
 const response=recipient=>({actionIdentifier:'expo.modules.notifications.actions.DEFAULT',notification:{request:{identifier:recipient,content:{data:{type:'live_stream',live_session_id:id,recipient_id:recipient}}}}});
 await c.receive(response(id));assert.equal(handled,0);
 await Promise.all([c.receive(response(user)),c.receive(response(user))]);assert.equal(handled,1);c.dispose();
});
test('Navigator sends Live alerts to the actual session, not a generic notification list',()=>{
 const nav=fs.readFileSync('src/navigation/AppNavigator.tsx','utf8');assert.match(nav,/case 'live_stream':[\s\S]*?navigate\('LiveSession', \{ sessionId: data\.live_session_id \}\)/);assert.match(nav,/<RootStack\.Screen name="LiveSession"/);
});
