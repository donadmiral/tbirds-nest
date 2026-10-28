const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function compile(source) { return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; }
const sound = {exports:{}};
vm.runInNewContext(compile(fs.readFileSync(path.join(root,'shared/soundtrack.ts'),'utf8')), sound);
const music=sound.exports, selection={soundId:'11111111-1111-4111-8111-111111111111',startSec:12,durationSec:8,volume:0.7,originalVolume:0};
test('soundtrack parser rejects corrupt values and exposes only a bounded recipe',()=>{
 assert.equal(music.readSoundtrack({...selection,durationSec:Infinity}),null);
 assert.equal(music.readSoundtrack({...selection,startSec:-1}),null);
 assert.equal(music.readSoundtrack({...selection,volume:1.1}),null);
 assert.equal(music.readSoundtrack({...selection,soundId:'https://untrusted/audio'}),null);
 assert.deepEqual(JSON.parse(JSON.stringify(music.readSoundtrack({...selection,url:'capability'}))),selection);
});
test('music clock follows seek, trim and repeat positions without accumulating drift',()=>{
 assert.equal(music.soundtrackTime(selection,0),12); assert.equal(music.soundtrackTime(selection,9.25),13.25);
 assert.equal(music.soundtrackTime(selection,3),15); assert.equal(music.soundtrackTime(selection,-3),12);
 const bounded=music.constrainSoundtrack({...selection,startSec:98,durationSec:40},{duration_sec:30,max_excerpt_sec:15});
 assert.equal(bounded.startSec,15);assert.equal(bounded.durationSec,15);
});
function publicationFixture({failTable,loseTable,failUpload=0,switchOnTable}={}) {
 const text=fs.readFileSync(path.join(root,'src/screens/feed/FeedScreen.tsx'),'utf8');
 const start=text.indexOf('  const createPost = async () => {'),end=text.indexOf('  const loadMore =',start);
 const rows={},calls=[],alerts=[],uploads=[];let id=0,failed=false,owner='owner',author='owner';
 const context={
   publicationBusy:{current:false},publicationAttempt:{current:null},userId:'owner',composerText:'Hello',
   composerMedia:[{uri:'file://photo.jpg',type:'image',ext:'jpg',width:100,height:100,edit:{rotation:90,flipX:true,tags:[{user_id:'friend',nx:.3,ny:.7}]}}],
   composerSoundtrack:selection,exclusivePost:false,innovationPost:false,innoField:null,innoStage:null,
   postAudience:'everyone',commentPolicy:'everyone',postCategory:null,articleTitle:'',quotingPost:null,threadingPost:null,
   composerPreview:null,composerSensitive:false,collabPicks:[{id:'friend'}],pollOpts:['One','Two'],pollDays:1,composerProducts:[],
   currentAuthorId:()=>author,useAuthStore:{getState:()=>({profile:{id:owner}})},Crypto:{randomUUID:()=>`id-${++id}`},
   supabase:{auth:{getSession:async()=>({data:{session:{user:{id:owner},access_token:'token'}}})},
    from(table){return{async upsert(data,options){calls.push(table);if(failTable===table&&!failed){failed=true;return{error:new Error('Disconnected')};}rows[table]??=new Map();for(const row of data){const key=options.onConflict.split(',').map(k=>row[k]).join('|');if(!rows[table].has(key))rows[table].set(key,row);}if(switchOnTable===table)owner='other';if(loseTable===table&&!failed){failed=true;return{error:new Error('Response lost')};}return{error:null};}};},rpc:async()=>({error:null})},
   ensureUploadSafe:async(uri)=>({uri,mime:'image/jpeg',ext:'jpg'}),safeExtFromUri:()=> 'jpg',
   fetch:async(url)=>{uploads.push(url);if(failUpload===uploads.length)return{ok:false,status:503};return{ok:true};},
   FormData:class{append(){}},AbortController,process:{env:{EXPO_PUBLIC_SUPABASE_URL:'https://first.party',EXPO_PUBLIC_SUPABASE_ANON_KEY:'anon'}},
   VideoThumbnails:{getThumbnailAsync:async()=>({uri:'file://cover.jpg'})},Haptics:{notificationAsync:async()=>{},NotificationFeedbackType:{Success:1}},
   feedListRef:{current:null},Keyboard:{dismiss(){}},loadFeed(){},Alert:{alert:(...args)=>alerts.push(args)},
   setTimeout:()=>1,clearTimeout(){},
 };
 for(const name of ['setPosting','setPublicationLocked','setMusicOpen','setComposerOpen','setComposerText','setComposerMedia','setComposerSoundtrack','setExclusivePost','setComposerProducts','setInnovationPost','setPostAudience','setCommentPolicy','setComposerSensitive','setCollabPicks','setPollOpts','setPollDays','setQuotingPost','setThreadingPost'])context[name]=()=>{};
 vm.runInNewContext(compile(text.slice(start,end)+'\nthis.publish=createPost;'),context);
 return{context,rows,calls,alerts,uploads,restoreOwner(){owner='owner';},switchAuthor(){author='business';}};
}
test('failed media attachment retries original post and preserves soundtrack, edits and tags',async()=>{
 const h=publicationFixture({failTable:'post_media'});await h.context.publish();
 assert.equal(h.rows.posts.size,1);assert.ok(h.context.publicationAttempt.current);assert.equal(h.uploads.length,1);
 await h.context.publish();assert.equal(h.rows.posts.size,1);assert.equal(h.rows.post_media.size,1);assert.equal(h.rows.post_media_tags.size,1);assert.equal(h.rows.post_collaborators.size,1);assert.equal(h.rows.post_poll_options.size,2);assert.equal(h.uploads.length,1);
 const media=[...h.rows.post_media.values()][0];assert.equal(media.edit.rotation,90);assert.equal(media.edit.flipX,true);assert.deepEqual(media.edit.soundtrack,selection);assert.equal(media.edit.tags,undefined);assert.equal(h.context.publicationAttempt.current,null);
});
test('lost post response can retry without duplicate post or attachment identities',async()=>{
 const h=publicationFixture({loseTable:'posts'});await h.context.publish();const id=[...h.rows.posts.keys()][0];await h.context.publish();assert.equal(h.rows.posts.size,1);assert.equal([...h.rows.posts.keys()][0],id);assert.equal(h.rows.post_media.size,1);assert.equal(h.rows.post_media_tags.size,1);
});
test('upload failure cannot publish an empty media post',async()=>{
 const h=publicationFixture({failUpload:1});await h.context.publish();assert.equal(h.rows.posts,undefined);assert.ok(h.context.publicationAttempt.current);await h.context.publish();assert.equal(h.rows.posts.size,1);assert.equal(h.uploads.length,2);
});
test('account change after post write halts subsequent attachments until original account returns',async()=>{
 const h=publicationFixture({switchOnTable:'posts'});await h.context.publish();assert.equal(h.rows.posts.size,1);assert.equal(h.rows.post_media,undefined);assert.match(h.alerts[0][1],/Return to the account/);await h.context.publish();assert.equal(h.rows.post_media,undefined);
});
test('same-tick double tap starts only one publisher',async()=>{
 const h=publicationFixture();await Promise.all([h.context.publish(),h.context.publish()]);assert.equal(h.rows.posts.size,1);assert.equal(h.uploads.length,1);assert.equal(h.rows.post_poll_options.size,2);
});
