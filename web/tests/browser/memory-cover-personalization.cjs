/** Actual editor interactions and pixels; Auth/RPC are synthetic. Real SQL persistence
 * is covered by supabase/tests/rpc-authorization/test-memory-book-creative.mjs. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{compile}=require('./ui-compile.cjs');
const root=path.resolve(__dirname,'../../..'),output=process.env.MEMORY_COVER_V2_OUTPUT||'/tmp/platinum-memory-cover-v2',fixture=path.join(output,'fixture');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const server=http.createServer((request,response)=>{
 const route=new URL(request.url,'http://local').pathname,file=path.resolve(fixture,route==='/'?'index.html':route.slice(1));
 if(!file.startsWith(fixture+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
 response.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.ttf')?'font/ttf':'text/html');response.end(fs.readFileSync(file));
});
async function ready(page){await page.waitForFunction(()=>[...document.querySelectorAll('img')].every(image=>image.complete&&image.naturalWidth>0));await page.evaluate(()=>document.fonts.ready);}
async function draw(page){
 const canvas=page.getByTestId('memory-cover-drawing-canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
 await page.mouse.move(box.x+box.width*.18,box.y+box.height*.55);await page.mouse.down();
 await page.mouse.move(box.x+box.width*.38,box.y+box.height*.48,{steps:12});await page.mouse.move(box.x+box.width*.57,box.y+box.height*.61,{steps:12});await page.mouse.move(box.x+box.width*.78,box.y+box.height*.49,{steps:12});await page.mouse.up();
}
(async()=>{
 fs.mkdirSync(output,{recursive:true});const adapter=path.join(__dirname,'memory-cover-adapter.ts');
 await compile({entry:path.join(__dirname,'memory-cover-fixture.tsx'),output:fixture,aliases:{'@/lib/supabase/client':adapter,[path.join(root,'web/lib/supabase/client.ts')]:adapter,'@/lib/memoryAlbum':adapter,[path.join(root,'web/lib/memoryAlbum.ts')]:adapter},title:'Personalized memory covers'});
 fs.cpSync(path.join(root,'web/public/fonts'),path.join(fixture,'fonts'),{recursive:true});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const browser=await chromium.launch({executablePath:process.env.STORY_QA_CHROME,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}),page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByLabel('Book title',{exact:true}).fill('Our handwritten days');await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.getByRole('button',{name:'A summer morning. Not selected',exact:true}).click();await page.getByRole('button',{name:'The evening walk. Not selected',exact:true}).click();await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.getByRole('button',{name:'Photo collage',exact:true}).click();await page.getByRole('button',{name:'Cursive title',exact:true}).click();await page.getByRole('button',{name:'Cover background #FBE3EA',exact:true}).click();await page.getByRole('button',{name:'Title color #142642',exact:true}).click();
  await page.getByLabel('Writing on the cover',{exact:true}).fill('Little things, kept together.');await page.getByRole('button',{name:'Draw on cover',exact:true}).click();await page.getByRole('button',{name:'Drawing color #932535',exact:true}).click();await draw(page);
  assert.equal(await page.getByRole('button',{name:'Undo drawing',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'Undo drawing',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Undo drawing',exact:true}).isEnabled(),false);await page.getByRole('button',{name:'Redo drawing',exact:true}).click();await page.getByRole('button',{name:'Done drawing',exact:true}).click();
  await page.getByRole('button',{name:'Create memory book',exact:true}).click();await page.getByRole('button',{name:'Open book',exact:true}).waitFor();await ready(page);
  const created=await page.evaluate(()=>window.memoryCoverQA.savedBook());assert.equal(created.cover_artwork.version,2);assert.equal(created.cover_artwork.titleStyle,'handwritten');assert.equal(created.cover_artwork.layout,'collage');assert.equal(created.cover_artwork.paperColor,'#FBE3EA');assert.equal(created.cover_artwork.strokes.length,1);assert.ok(created.cover_artwork.strokes[0].points.length>20);assert.deepEqual(created.cover_artwork.storyIds,['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']);
  const cover=page.getByRole('img',{name:/Postcard book cover: Our handwritten days/}),before=await cover.screenshot({path:path.join(output,'personalized-cover.png')});
  assert.equal(await cover.locator('img').count(),2);assert.ok(await page.evaluate(()=>document.fonts.check('24px "Memory Cover Handwriting"')));
  await page.reload();await page.getByRole('button',{name:'Open book',exact:true}).waitFor();await ready(page);const after=await page.getByRole('img',{name:/Postcard book cover: Our handwritten days/}).screenshot();assert.equal(digest(before),digest(after),'Saved collage and ink must preserve their pixels on reload');
  await page.getByRole('button',{name:'Album settings',exact:true}).click();const editor=page.getByRole('dialog',{name:'Book editor',exact:true});assert.equal(await editor.getByRole('button',{name:'Photo collage',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await editor.getByRole('button',{name:'Cursive title',exact:true}).getAttribute('aria-pressed'),'true');
  await editor.getByRole('button',{name:'Draw on cover',exact:true}).click();await draw(page);await editor.getByRole('button',{name:'Done drawing',exact:true}).click();await editor.getByRole('button',{name:'Save book',exact:true}).click();await editor.waitFor({state:'detached'});
  const edited=await page.evaluate(()=>window.memoryCoverQA.savedBook());assert.equal(edited.cover_artwork.strokes.length,2);assert.equal(edited.presentation_revision,1);assert.deepEqual(edited.cover_artwork.strokes[0],created.cover_artwork.strokes[0]);
  await page.reload();await page.getByRole('button',{name:'Open book',exact:true}).waitFor();await ready(page);assert.equal(await page.evaluate(()=>window.memoryCoverQA.savedBook().cover_artwork.strokes.length),2);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Album settings',exact:true}).click();await editor.waitFor();await page.screenshot({path:path.join(output,'personalized-editor-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const extra=await browser.newPage({viewport:{width:1100,height:900}});extra.on('pageerror',error=>errors.push(error.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  await extra.goto(base+'/?mode=text-first');await extra.getByRole('button',{name:'Photo collage',exact:true}).click();await ready(extra);assert.equal(await extra.getByRole('img',{name:/Postcard book cover: A cover of words/}).locator('img').count(),2,'A text cover must seed its collage from actual photos');
  for(const kind of ['unbroken','wide']){await extra.goto(base+'/?mode=gallery&titleStyle=handwritten&text='+kind);await ready(extra);const overflow=await extra.locator('[data-cover]').evaluateAll(nodes=>nodes.map(node=>{const title=node.querySelector('[class*=clamp]');return{design:node.getAttribute('data-cover'),height:title.scrollHeight-title.clientHeight,width:title.scrollWidth-title.clientWidth};}));for(const item of overflow)assert.ok(item.height<=1&&item.width<=1,JSON.stringify({kind,...item}));}
  await extra.close();assert.deepEqual(errors,[]);const receipt={browser:await browser.version(),scope:'Actual web UI; synthetic local persistence. SQL RPC roundtrip tested separately.',passed:['distinct authorized thumbnail collage','local cursive font','paper and title colors','pointer drawing','undo and redo','create and edit persist strokes','same cover pixels after reload','mobile editor fits','text-first books seed photo collages','long and non-Latin cursive titles fit'],strokePoints:created.cover_artwork.strokes[0].points.length,reloadCoverSha256:digest(after),consoleErrors:errors};
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
