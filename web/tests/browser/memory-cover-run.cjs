/** Real designer/editor components and cover pixels; synthetic Auth/RPC only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{compile}=require('./ui-compile.cjs');
const root=path.resolve(__dirname,'../../..'),output=process.env.MEMORY_COVER_QA_OUTPUT||'/tmp/platinum-memory-cover-qa',fixture=path.join(output,'fixture');
fs.mkdirSync(output,{recursive:true});
const adapter=path.join(__dirname,'memory-cover-adapter.ts'),digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['shared/memoryCoverWriting.ts','shared/memoryBookPersistence.ts','src/components/memory/MemoryBookCover.tsx','src/screens/profile/MemoryAlbumScreen.tsx','web/components/memory/MemoryBookCover.tsx','web/components/memory/MemoryBookCover.module.css','web/components/memory/MemoryCreativeControls.tsx','web/components/memory/MemoryBookDesigner.tsx','web/components/MemoryAlbum.tsx','web/tests/browser/memory-cover-adapter.ts','web/tests/browser/memory-cover-fixture.tsx','web/tests/browser/memory-cover-run.cjs'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,digest(fs.readFileSync(path.join(root,file)))]));
const server=http.createServer((request,response)=>{
 const route=new URL(request.url,'http://local').pathname,file=path.resolve(fixture,route==='/'?'index.html':route.slice(1));
 if(!file.startsWith(fixture+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
 response.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');response.end(fs.readFileSync(file));
});
async function imagesReady(page){await page.waitForFunction(()=>[...document.querySelectorAll('img')].every(image=>image.complete&&image.naturalWidth>0));await page.evaluate(()=>document.fonts.ready);}
async function range(page,label,value){await page.getByLabel(label,{exact:true}).evaluate((element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,String(value));element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function designer(page){
 await page.getByLabel('Book title',{exact:true}).fill('A summer to keep');
 await page.getByLabel('Subtitle (optional)',{exact:true}).fill('The places and people we love');
 await page.getByRole('button',{name:'Postcard cover design',exact:true}).click();
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'A summer morning. Not selected',exact:true}).click();
 await page.getByRole('button',{name:'The evening walk. Not selected',exact:true}).click();
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'Use The evening walk as the cover',exact:true}).click();
 await page.getByLabel('Writing on the cover',{exact:true}).fill('A little note\nto keep with these days.');
 await page.getByLabel('Postcard stamp',{exact:true}).fill('SUMMER WITH OUR PEOPLE');
 await page.getByRole('button',{name:'Simple',exact:true}).click();
 await page.getByRole('button',{name:'Upper photo',exact:true}).click();
 await range(page,'Photo horizontal position',.72);await range(page,'Photo vertical position',.28);await range(page,'Photo zoom',1.65);
 await page.getByRole('button',{name:'Bright',exact:true}).click();
 await page.getByRole('button',{name:'About 30 seconds',exact:true}).click();
 await page.getByRole('button',{name:'Date taken',exact:true}).click();
 await page.getByLabel('Opening and closing titles',{exact:true}).uncheck();
 await page.getByLabel('Keep the videos’ original sound',{exact:true}).uncheck();
}
async function gallery(page,base,receipt){
 for(const text of ['normal','multiline','wide','unbroken'])for(const font of ['handwritten','serif','sans'])for(const position of ['top','bottom'])for(const width of [144,230]){
  const query=new URLSearchParams({mode:'gallery',text,font,position,width:String(width)});await page.goto(base+'/?'+query);await page.locator('[data-cover]').last().waitFor();await imagesReady(page);
  const covers=await page.locator('[data-cover]').evaluateAll(nodes=>nodes.map(node=>{
   const cover=node.querySelector('[role=img]'),note=cover.querySelector('[class*=inscription]'),title=cover.querySelector('[class*=clamp]');
   const c=cover.getBoundingClientRect(),n=note.getBoundingClientRect(),t=title.getBoundingClientRect();
   const style=getComputedStyle(note);return {design:node.getAttribute('data-cover'),width:c.width,height:c.height,noteFont:Number.parseFloat(style.fontSize),noteLineHeight:Number.parseFloat(style.lineHeight),noteText:note.textContent,titleText:title.textContent,outerOverflow:Math.max(0,c.top-n.top,n.bottom-c.bottom,c.left-n.left,n.right-c.right),textOverflow:Math.max(0,note.scrollHeight-note.clientHeight,note.scrollWidth-note.clientWidth),titleOverflow:Math.max(0,title.scrollHeight-title.clientHeight,title.scrollWidth-title.clientWidth),titleOverlap:Math.max(0,Math.min(n.bottom,t.bottom)-Math.max(n.top,t.top))};
  }));
  fs.writeFileSync(path.join(output,'latest-gallery.json'),JSON.stringify({text,font,position,width,covers},null,2));
  for(const cover of covers){const id=`${text}/${font}/${position}/${width}/${cover.design}`;assert.ok(cover.outerOverflow<1,id+' note leaves the cover');assert.ok(cover.textOverflow<=1,id+' note text is clipped '+cover.textOverflow);assert.ok(cover.titleOverflow<=1,id+' title is clipped '+cover.titleOverflow);assert.ok(cover.titleOverlap<1,id+' note covers the title');assert.ok(cover.noteLineHeight>=cover.noteFont*1.2,id+' has an invalid line height');}
  receipt.gallery.push({text,font,position,width,covers});
  if(font==='serif'&&position==='bottom'&&width===230&&['normal','wide'].includes(text))await page.screenshot({path:path.join(output,`covers-${text}.png`),fullPage:true});
 }
}
(async()=>{
 const beforeSource=sourceHashes();
 await compile({entry:path.join(__dirname,'memory-cover-fixture.tsx'),output:fixture,aliases:{'@/lib/supabase/client':adapter,[path.join(root,'web/lib/supabase/client.ts')]:adapter,'@/lib/memoryAlbum':adapter,[path.join(root,'web/lib/memoryAlbum.ts')]:adapter},title:'Actual memory book cover verification'});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const browser=await chromium.launch({executablePath:process.env.STORY_QA_CHROME,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}),base=`http://127.0.0.1:${server.address().port}`;
 const receipt={browser:await browser.version(),scope:'Actual web cover, designer and editor components. Auth/RPC and persistence use a test-only localStorage adapter; this is not hosted Supabase acceptance.',gallery:[],cases:[]},errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1180,height:1000}});page.on('pageerror',error=>errors.push(error.message));await gallery(page,base,receipt);
  await page.goto(base);await designer(page);await imagesReady(page);await page.screenshot({path:path.join(output,'designer-custom-cover.png'),fullPage:true});
  await page.getByRole('button',{name:'Create memory book',exact:true}).click();await page.getByRole('button',{name:'Open book',exact:true}).waitFor();await imagesReady(page);
  const created=await page.evaluate(()=>({book:window.memoryCoverQA.savedBook(),requests:window.memoryCoverQA.requests}));const book=created.book;
  assert.equal(book.title,'A summer to keep');assert.equal(book.cover_story_id,'22222222-2222-4222-8222-222222222222');assert.equal(book.presentation_revision,0);
  assert.deepEqual(book.cover_artwork,{version:1,inscription:'A little note\nto keep with these days.',inscriptionStyle:'sans',inscriptionPosition:'top',postmark:'SUMMER WITH OUR PEOPLE',showDate:true,photo:{x:.72,y:.28,scale:1.65}});
  assert.deepEqual(book.film_settings,{version:1,mode:'automatic',style:'bright',length:'short',order:'chronological',titleCard:false,originalAudio:false});
  const create=created.requests.find(row=>row.name==='create_memory_book_creative_presentation');assert.equal(create.authorization,'Bearer synthetic-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.equal(create.args.p_request_id,book.id);assert.deepEqual(create.args.p_story_ids,['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']);
  const cover=page.getByRole('img',{name:/Postcard book cover: A summer to keep/});const before=await cover.screenshot({path:path.join(output,'created-cover.png')});
  await page.reload();await page.getByRole('button',{name:'Open book',exact:true}).waitFor();await imagesReady(page);const after=await page.getByRole('img',{name:/Postcard book cover: A summer to keep/}).screenshot();
  assert.equal(digest(before),digest(after),'Reload must preserve actual cover pixels and photo framing');receipt.cases.push({name:'actual designer creates the chosen owned photo and complete creative documents',bookId:book.id,revision:0,pinnedAuthorization:true,reloadCoverSha256:digest(after)});
  await page.getByRole('button',{name:'Album settings',exact:true}).click();const editor=page.getByRole('dialog',{name:'Book editor',exact:true});
  for(const label of ['Photo horizontal position','Photo vertical position','Photo zoom'])assert.equal(await editor.getByLabel(label,{exact:true}).count(),1,'A photo cover must retain '+label);
  await editor.getByLabel('Title',{exact:true}).fill('Our next chapter');await editor.getByRole('button',{name:'Keepsake cover design',exact:true}).click();await editor.getByRole('button',{name:'Use memory 1 on the cover',exact:true}).click();
  const note=Array.from({length:24},(_,index)=>`Line ${index}`).join('\n').slice(0,160);await editor.getByLabel('Writing on the cover',{exact:true}).fill(note);await editor.getByRole('button',{name:'Book type',exact:true}).click();await editor.getByRole('button',{name:'Lower photo',exact:true}).click();
  await editor.getByRole('button',{name:'Original timing',exact:true}).click();await editor.getByLabel('Show the memory’s date',{exact:true}).uncheck();await editor.getByRole('button',{name:'Only me',exact:true}).click();
  await editor.getByRole('button',{name:'Save book',exact:true}).click();await editor.waitFor({state:'detached'});await page.getByRole('img',{name:/Keepsake book cover: Our next chapter/}).waitFor();
  const updated=await page.evaluate(()=>({book:window.memoryCoverQA.savedBook(),requests:window.memoryCoverQA.requests}));assert.equal(updated.book.presentation_revision,1);assert.equal(updated.book.audience,'only_me');assert.equal(updated.book.cover_story_id,'11111111-1111-4111-8111-111111111111');assert.equal(updated.book.cover_artwork.inscription,note);assert.equal(updated.book.film_settings.mode,'original');
  const saved=updated.requests.find(row=>row.name==='save_memory_book_creative_presentation');assert.equal(saved.args.p_expected_revision,0);assert.equal(saved.authorization,'Bearer synthetic-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await page.reload();await page.getByRole('img',{name:/Keepsake book cover: Our next chapter/}).waitFor();await page.getByRole('button',{name:'Album settings',exact:true}).click();
  assert.equal(await editor.getByLabel('Writing on the cover',{exact:true}).inputValue(),note);assert.equal(await editor.getByRole('button',{name:'Original timing',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await editor.getByLabel('Show the memory’s date',{exact:true}).isChecked(),false);
  await editor.getByLabel('Writing on the cover',{exact:true}).fill('Keep this unsaved draft.');await page.evaluate(()=>window.memoryCoverQA.bumpRevision());await editor.getByRole('button',{name:'Save book',exact:true}).click();await editor.getByRole('alert').filter({hasText:/another session/}).waitFor();
  assert.equal(await editor.getByLabel('Writing on the cover',{exact:true}).inputValue(),'Keep this unsaved draft.');assert.equal(await page.evaluate(()=>window.memoryCoverQA.savedBook().cover_artwork.inscription),note);await editor.getByRole('button',{name:'Close',exact:true}).click();
  receipt.cases.push({name:'actual editor persists revisions and protects the draft on a conflicting save',updatedRevision:1,conflictPreservesDraft:true,savedDocumentUnchangedAfterConflict:true});
  await page.setViewportSize({width:390,height:844});await imagesReady(page);await page.screenshot({path:path.join(output,'saved-book-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Saved book has horizontal overflow');
  receipt.cases.push({name:'saved cover and album controls fit the mobile viewport',width:390,noHorizontalOverflow:true});
  const textContext=await browser.newContext({viewport:{width:390,height:844}}),textPage=await textContext.newPage();textPage.on('pageerror',error=>errors.push(error.message));await textPage.goto(base);
  await textPage.getByLabel('Book title',{exact:true}).fill('A book of words');await textPage.getByRole('button',{name:'Next',exact:true}).click();await textPage.getByRole('button',{name:'Words worth keeping. Not selected',exact:true}).click();await textPage.getByRole('button',{name:'Next',exact:true}).click();
  await textPage.getByRole('button',{name:'Create memory book',exact:true}).click();await textPage.getByRole('button',{name:'Open book',exact:true}).waitFor();
  const textBook=await textPage.evaluate(()=>window.memoryCoverQA.savedBook());assert.equal(textBook.pages.length,1);assert.equal(textBook.pages[0].media_type,'text');assert.equal(textBook.pages[0].media_url,null);assert.equal(textBook.pages[0].thumbnail_url,null);
  await textPage.getByRole('button',{name:'Album settings',exact:true}).click();const textEditor=textPage.getByRole('dialog',{name:'Book editor',exact:true});await textEditor.getByLabel('Writing on the cover',{exact:true}).fill('Every word is a memory.');
  for(const label of ['Photo horizontal position','Photo vertical position','Photo zoom'])assert.equal(await textEditor.getByLabel(label,{exact:true}).count(),0,'Text-only book must not expose '+label);
  assert.equal(await textEditor.getByRole('button',{name:'Reset photo framing',exact:true}).count(),0);assert.equal(await textEditor.getByText('Frame your album photo',{exact:true}).count(),0);
  await textPage.screenshot({path:path.join(output,'text-only-book-editor.png'),fullPage:true});
  await textEditor.getByRole('button',{name:'Save book',exact:true}).click();await textEditor.waitFor({state:'detached'});assert.equal(await textPage.evaluate(()=>window.memoryCoverQA.savedBook().cover_artwork.inscription),'Every word is a memory.');await textContext.close();
  receipt.cases.push({name:'actual text-only book editor omits photo framing while cover writing remains editable',pages:1,photoFramingControls:0,writingSaved:true});
  const isolated=await browser.newContext({viewport:{width:390,height:844}}),accountPage=await isolated.newPage();accountPage.on('pageerror',error=>errors.push(error.message));await accountPage.goto(base);await designer(accountPage);await accountPage.evaluate(()=>window.memoryCoverQA.hold());await accountPage.getByRole('button',{name:'Create memory book',exact:true}).click();
  await accountPage.waitForFunction(()=>window.memoryCoverQA.requests.some(row=>row.name==='create_memory_book_creative_presentation'));
  await accountPage.evaluate(()=>{window.memoryCoverQA.changeAccount('cccccccc-cccc-4ccc-8ccc-cccccccccccc');window.memoryCoverQA.changeAccount('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');window.memoryCoverQA.release();});
  await accountPage.getByRole('status').filter({hasText:/previous owner/}).waitFor();assert.equal(await accountPage.evaluate(()=>window.memoryCoverQA.savedBook()),null);assert.equal(await accountPage.getByRole('button',{name:'Open book',exact:true}).count(),0);await isolated.close();
  receipt.cases.push({name:'actual designer fences A to B to A during a pending create',oldDraftClosed:true,noLateCreatedBook:true});
  assert.deepEqual(errors,[]);receipt.consoleErrors=errors;
  receipt.sourceSha256=sourceHashes();assert.deepEqual(receipt.sourceSha256,beforeSource,'Verification source changed after fixture compilation');
  fs.writeFileSync(path.join(output,'browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({browser:receipt.browser,galleryConfigurations:receipt.gallery.length,measuredCovers:receipt.gallery.reduce((sum,row)=>sum+row.covers.length,0),cases:receipt.cases},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
