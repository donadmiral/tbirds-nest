const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/screens/messages/ChatScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('ChatScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
function visit(node) { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.arguments[0]) callbacks[node.name.text] = node.initializer.arguments[0].getText(ast); ts.forEachChild(node, visit); }
visit(ast);
const transpile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function evaluate(text, context = {}) { const module = { exports: {} }; vm.runInNewContext(transpile('export const value = '+text), { module, exports: module.exports, Error, ...context }); return module.exports.value; }
const historyModule = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname, '../shared/messageHistory.ts'), 'utf8')), { module: historyModule, exports: historyModule.exports });
const history = historyModule.exports;
const row = n => ({ id: '00000000-0000-4000-8000-'+String(n).padStart(12,'0'), created_at:'2026-10-20T00:00:00Z', conversation_id:'a', text:'Message '+n });
const defer = () => { let resolve; const promise = new Promise(done=>{resolve=done;}); return {promise,resolve}; };

function historyHarness(response) {
  const state = { rows:[], loading:false, loadingOlder:false, error:null, hasOlder:false }, queries=[];
  const context = { ...history, conversationId:'a', currentUserId:'me', mountedRef:{current:true}, activeConversation:{current:'a'}, historyRequest:{current:0}, historyCursor:{current:null}, olderPending:{current:false},
    setMessages(fn){state.rows=typeof fn==='function'?fn(state.rows):fn;}, setLoading(value){state.loading=value;}, setHistoryError(value){state.error=value;}, setHasOlder(value){state.hasOlder=value;}, setLoadingOlder(value){state.loadingOlder=value;},
    signChatMedia:async rows=>rows, loadReactions:async()=>{}, markRead:async()=>{}, refreshStatus:async()=>{}, loadStarredIds:async()=>{}, loadSavedIds:async()=>{},
    supabase:{from(table){const query={table};queries.push(query); const chain={select(){return chain;},eq(key,value){query[key]=value;return chain;},order(){return chain;},limit(value){query.limit=value;return chain;},or(value){query.filter=value;return chain;},then(ok,bad){return Promise.resolve(typeof response==='function'?response(query):response).then(ok,bad);}};return chain;}}
  };
  return {state,context,queries, fetch:()=>evaluate(callbacks.fetchMessages,context)(), older:()=>evaluate(callbacks.loadOlderMessages,{...context,hasOlder:state.hasOlder,loading:state.loading})()};
}
test('native history opens latest bounded page and preserves realtime arrivals', async()=>{
  const wait=defer(), h=historyHarness(()=>wait.promise); const pending=h.fetch(); h.state.rows=[row(99)]; wait.resolve({data:[row(1),row(2)],error:null}); await pending;
  assert.equal(h.queries[0].limit,50); assert.deepEqual(Array.from(h.state.rows,r=>r.id),[row(99).id,row(2).id,row(1).id]); assert.equal(h.state.loading,false);
});
test('native failed history can retry and stale response never changes destination chat',async()=>{
  let fail=true;const h=historyHarness(()=>fail?{data:null,error:{message:'offline'}}:{data:[row(1)],error:null}); await h.fetch();assert.match(h.state.error,/could not be loaded/);fail=false;await h.fetch();assert.equal(h.state.error,null);assert.equal(h.state.rows.length,1);
  const wait=defer(),stale=historyHarness(()=>wait.promise);const p=stale.fetch();stale.context.activeConversation.current='b';wait.resolve({data:[row(1)],error:null});await p;assert.equal(stale.state.rows.length,0);
});
test('native older page uses cursor, coalesces duplicate taps, and keeps current edits',async()=>{
  const wait=defer(),h=historyHarness(()=>wait.promise);h.state.hasOlder=true;h.state.rows=[{...row(5),text:'New edit'}];h.context.historyCursor.current=row(5);
  const p=h.older();await h.older();assert.equal(h.queries.length,1);assert.match(h.queries[0].filter,/id.lt/);wait.resolve({data:[row(5),row(4)],error:null});await p;
  assert.equal(h.state.rows.length,2);assert.equal(h.state.rows[0].text,'New edit');assert.equal(h.state.loadingOlder,false);
});
test('confirmed history replaces a queued optimistic copy with the same message ID',async()=>{
  const wait=defer(),h=historyHarness(()=>wait.promise);const pending=h.fetch();h.state.rows=[{...row(1),_optimistic:true,_queued:true}];wait.resolve({data:[row(1)],error:null});await pending;
  assert.equal(h.state.rows.length,1);assert.equal(h.state.rows[0]._optimistic,undefined);assert.equal(h.state.rows[0]._queued,undefined);
});
test('an older page finishing after a conversation switch cannot unlock the new request',async()=>{
  const wait=defer(),h=historyHarness(()=>wait.promise);h.state.hasOlder=true;h.context.historyCursor.current=row(5);const pending=h.older();
  h.context.activeConversation.current='b';h.context.historyRequest.current++;h.context.olderPending.current=true;
  wait.resolve({data:[row(4)],error:null});await pending;assert.equal(h.context.olderPending.current,true);assert.equal(h.state.rows.length,0);
});
test('camera/gallery shared video send awaits upload and preserves explicit failure',async()=>{
  const calls=[],alerts=[]; const context={currentUserId:'me',mediaSending:{current:false},pendingViewLimitRef:{current:null},setShowToolbar(){},setUploadingMedia(){},
    uploadMedia:async(bucket,user,asset)=>{calls.push(asset.kind);return{url:'https://media.test/'+asset.kind};},VideoThumbnails:{getThumbnailAsync:async()=>({uri:'thumb.jpg'})},doSend:async(...args)=>{calls.push(args[2]);return true;},Alert:{alert:(...args)=>{if(args[0]==='Send video')args[2].find(b=>b.text==='Normal').onPress();else alerts.push(args);}}};
  const send=evaluate(callbacks.sendMediaAssets,context);assert.equal(await send([{uri:'camera.mov',type:'video'}]),true);assert.deepEqual(calls,['video','image','video']);assert.equal(alerts.length,0);
  context.uploadMedia=async()=>{throw new Error('Convert this video to MP4 and try again.');}; const failed=evaluate(callbacks.sendMediaAssets,context);assert.equal(await failed([{uri:'camera.mov',type:'video'}]),false);assert.match(alerts[0][1],/MP4/);assert.equal(context.mediaSending.current,false);
});
test('native reaction failure reports error and duplicate taps cannot race writes',async()=>{
  const wait=defer(),alerts=[];let reads=0,writes=0;const context={currentUserId:'me',reactionPending:{current:new Set()},setSelectedMsg(){},loadReactions:async()=>{},Alert:{alert:(...args)=>alerts.push(args)},supabase:{from(){const chain={select(){reads++;return chain;},eq(){return chain;},maybeSingle:()=>wait.promise,insert:async()=>{writes++;return{error:{message:'offline'}};}};return chain;}}};
  const react=evaluate(callbacks.toggleReaction,context);const p=react('message','❤️');await react('message','❤️');assert.equal(reads,1);wait.resolve({data:null,error:null});await p;assert.equal(writes,1);assert.equal(alerts.length,1);assert.equal(context.reactionPending.current.size,0);
});
test('native sent and received bubble text remains paired in dark mode',()=>{
  const darkModule={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname,'../src/constants/tokens/dark.ts'),'utf8')),{module:darkModule,exports:darkModule.exports});
  const t=darkModule.exports.dark;const styles=evaluate(callbacks.s,{t,StyleSheet:{hairlineWidth:1},NAVY:'#0B1E3D',NAVY_SOFT:'#1A3560',BUBBLE_OTHER:'#fff',TEXT_PRIMARY:'#000',TEXT_SECONDARY:'#888',HAIRLINE:'#eee',SCREEN_W:400,MSG_IMG_MAX_W:288,MSG_IMG_MAX_H:360,MSG_IMG_MIN_H:140,MSG_VID_H:180})(t);
  assert.equal(styles.bubbleMe.backgroundColor,'#0B1E3D');assert.equal(styles.bubbleTxtMe.color,'#FFFFFF');assert.equal(styles.docNameMe.color,'#FFFFFF');assert.equal(styles.bubbleOther.backgroundColor,t.surface.canvas);assert.equal(styles.bubbleTxtOther.color,t.ink.primary);assert.equal(styles.fsActionTxt.color,'#FFFFFF');
});
