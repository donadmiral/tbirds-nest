const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..');
const compile=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function walk(node,out=[]){if(Array.isArray(node))node.forEach(n=>walk(n,out));else if(node&&typeof node==='object'){out.push(node);walk(node.props?.children,out);}return out;}
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):text(node?.props?.children??'');
function hooks(first){let cursor=0,init=true;const slots=[],effects=[];return{api:{useState(value){const i=cursor++;if(!(i in slots))slots[i]=i===0&&first!==undefined?first:value;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},useRef(value){const i=cursor++;return slots[i]??=( {current:value});},useEffect(fn){cursor++;if(init)effects.push(fn);}},render(fn){cursor=0;const tree=fn();init=false;while(effects.length)effects.shift()();return tree;}};}
const runtime={jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key}),Fragment:'Fragment'};
function preview(story){const h=hooks(),module={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.join(root,'web/components/memory/MemoryStoryPreview.tsx'),'utf8')),{module,exports:module.exports,require:name=>name==='react'?h.api:name==='react/jsx-runtime'?runtime:name==='next/image'?{default:'img'}:{ImageOff:'ImageOff',Play:'Play',Type:'Type'}});const render=()=>h.render(()=>module.exports.MemoryStoryPreview({story}));render();return{render};}
test('text stories retain a readable preview instead of a blank media tile',()=>{
 const h=preview({media_type:'text',media_url:null,thumbnail_url:null,caption:'A good memory',text_background:{colors:['#102030','#405060']}}),tree=h.render();
 assert.match(text(tree),/A good memory/);assert.equal(walk(tree).filter(n=>n.type==='img'||n.type==='video').length,0);
});
test('a video without a thumbnail uses a muted video frame, never an image element with an mp4 URL',()=>{
 const h=preview({media_type:'video',media_url:'https://signed.test/story.mp4?token=short',thumbnail_url:null,caption:null}),tree=h.render();
 assert.equal(walk(tree).filter(n=>n.type==='img').length,0);const video=walk(tree).find(n=>n.type==='video');assert.ok(video);assert.equal(video.props.muted,true);assert.equal(video.props.controls,false);assert.equal(video.props.preload,'metadata');
 video.props.onError();assert.match(text(h.render()),/Preview unavailable/);
});
test('a broken poster falls back to authorized original media and a broken image has a clear placeholder',()=>{
 const h=preview({media_type:'image',media_url:'https://signed.test/photo.jpg',thumbnail_url:'https://signed.test/poster.jpg',caption:'Together'});
 let image=walk(h.render()).find(n=>n.type==='img');assert.equal(image.props.src,'https://signed.test/poster.jpg');image.props.onError();
 image=walk(h.render()).find(n=>n.type==='img');assert.equal(image.props.src,'https://signed.test/photo.jpg');image.props.onError();assert.match(text(h.render()),/Preview unavailableTogether/);
});
test('story selection buttons have caption/date labels and announce selected and already-added states',()=>{
 const source=fs.readFileSync(path.join(root,'web/components/MemoryAlbum.tsx'),'utf8'),ast=ts.createSourceFile('album.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let component,date;
 for(const node of ast.statements){if(ts.isFunctionDeclaration(node)&&node.name?.text==='AddMemories')component=node.getText(ast);if(ts.isFunctionDeclaration(node)&&node.name?.text==='fmtDate')date=node.getText(ast);}
 const rows=[{id:'photo',media_type:'image',media_url:'photo.jpg',thumbnail_url:null,caption:'Our holiday',created_at:'2026-10-28T12:00:00Z'},{id:'video',media_type:'video',media_url:'movie.mp4',thumbnail_url:null,caption:null,created_at:'2026-10-27T12:00:00Z'}];
 const h=hooks(rows),module={exports:{}};vm.runInNewContext(compile(date+'\n'+component+'\nexport {AddMemories};'),{module,exports:module.exports,require:()=>runtime,...h.api,useEffect(){},useMemoryDialog:()=>({current:null}),MemoryStoryPreview:'MemoryStoryPreview',X:'X',Check:'Check'});
 const render=()=>h.render(()=>module.exports.AddMemories({albumId:'book',existing:[{story_id:'video'}],onClose(){}}));
 let choices=walk(render()).filter(n=>n.type==='button'&&n.props['aria-pressed']!==undefined);assert.equal(choices.length,2);assert.match(choices[0].props['aria-label'],/Our holiday.*Not selected/);assert.match(choices[1].props['aria-label'],/Video from.*2026.*Already in this book/);assert.equal(choices[1].props.disabled,true);assert.equal(choices[1].props['aria-pressed'],true);
 choices[0].props.onClick();choices=walk(render()).filter(n=>n.type==='button'&&n.props['aria-pressed']!==undefined);assert.equal(choices[0].props['aria-pressed'],true);assert.match(choices[0].props['aria-label'],/Our holiday.*Selected/);
 // React remounts a keyed preview when a refreshed capability replaces a failed
 // URL, while the picker keeps its selected story IDs.
 const before=walk(render()).find(n=>n.type==='MemoryStoryPreview'&&n.props.story.id==='video');
 const failed=preview(before.props.story);walk(failed.render()).find(n=>n.type==='video').props.onError();assert.match(text(failed.render()),/Preview unavailable/);
 rows[1]={...rows[1],media_url:'https://signed.test/movie.mp4?token=renewed'};
 const after=walk(render()).find(n=>n.type==='MemoryStoryPreview'&&n.props.story.id==='video');assert.notEqual(after.key,before.key);
 const renewed=preview(after.props.story);assert.equal(walk(renewed.render()).find(n=>n.type==='video').props.src,rows[1].media_url);
 assert.equal(walk(render()).find(n=>n.type==='button'&&n.props['aria-label']?.startsWith('Our holiday')).props['aria-pressed'],true);

});
