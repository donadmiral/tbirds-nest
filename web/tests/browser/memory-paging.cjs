/** Real Chromium and production book/shelf modules; local synthetic RPC only. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../../node_modules/playwright');
const {compile}=require('./ui-compile.cjs');
const output=process.env.PC_PAGING_BROWSER_OUTPUT||'/tmp/pc-memory-paging-browser';
const artifacts=process.env.PC_PAGING_BROWSER_ARTIFACTS||'/tmp/pc-memory-paging-evidence';
const executablePath=process.env.PLATINUM_CHROMIUM||'/tmp/platinum-web-admin-chrome156/chrome-linux64/chrome';
async function main(){
 await fs.mkdir(artifacts,{recursive:true});const backend=path.join(__dirname,'memory-paging-adapter.ts');
 await compile({entry:path.join(__dirname,'memory-paging-fixture.tsx'),output,aliases:{'@/lib/supabase/client':backend,'./supabase/client':backend,'../../lib/supabase/client':backend},title:'Local paged memory verification'});
 const server=http.createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const file=name==='/fixture.js'?'fixture.js':name==='/fixture.css'?'fixture.css':'index.html';try{res.writeHead(200,{'content-type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await fs.readFile(path.join(output,file)));}catch{res.writeHead(404);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1200,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],checks=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 try{
  await page.goto(origin);await page.getByRole('button',{name:'Open book',exact:true}).waitFor();
  await page.waitForFunction(()=>window.pagingFixture.requests.some(r=>r.name==='get_memory_book_page_v2'&&r.args.p_cursor));
  await page.getByRole('button',{name:'Album settings',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'Book editor',exact:true}).count(),0);
  await page.evaluate(()=>window.pagingFixture.release('book-next'));
  const editor=page.getByRole('dialog',{name:'Book editor',exact:true});await editor.waitFor();
  const bookReads=await page.evaluate(()=>window.pagingFixture.requests.filter(r=>r.name==='get_memory_book_page_v2'));
  assert.deepEqual(bookReads.map(r=>r.args.p_cursor?.after||0),[0,24,48]);assert.ok(bookReads.every(r=>r.args.p_limit===24&&r.pinned));
  await editor.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Open book',exact:true}).click();
  await page.getByRole('button',{name:'View all pages',exact:true}).click();await page.getByRole('button',{name:'Memory 61',exact:true}).waitFor();
  await page.getByRole('button',{name:'Memory 61',exact:true}).click();await page.getByText('61 / 61',{exact:true}).waitFor();
  checks.push('book editor waits for all three windows; all61 pages remain selectable and readable');
  await page.screenshot({path:path.join(artifacts,'last-book-page.png')});

  await page.goto(origin+'/?window=1&hold-window=1');await page.getByRole('button',{name:'Open book',exact:true}).waitFor();
  await page.waitForFunction(()=>window.pagingFixture.requests.some(r=>r.name==='get_memory_book_window_v3'));
  await page.getByRole('button',{name:'Open book',exact:true}).click();
  for(let position=2;position<=10;position++){
   await page.getByRole('button',{name:'Next page',exact:true}).last().click();
   await page.getByText(position+' / 61',{exact:true}).waitFor();
  }
  await page.evaluate(()=>window.pagingFixture.release('get_memory_book_window_v3'));
  await page.waitForFunction(()=>Number(document.querySelector('[data-memory-retained-pages]')?.getAttribute('data-memory-retained-pages'))>24);
  await page.getByText('10 / 61',{exact:true}).waitFor();
  checks.push('a delayed window response preserves the current page after nine intervening turns');

  await page.goto(origin+'/?window=1');await page.getByRole('button',{name:'Open book',exact:true}).waitFor();
  await page.evaluate(()=>window.pagingFixture.release('book-next'));
  await page.getByRole('button',{name:'Open book',exact:true}).click();
  for(let position=2;position<=61;position++){
   await page.getByRole('button',{name:'Next page',exact:true}).last().click();
   await page.getByText(position+' / 61',{exact:true}).waitFor();
   assert.ok(await page.locator('[data-memory-retained-pages]').evaluate(node=>Number(node.getAttribute('data-memory-retained-pages'))<=48));
  }
  await page.getByRole('button',{name:'Album settings',exact:true}).click();
  const windowEditor=page.getByRole('dialog',{name:'Book editor',exact:true});await windowEditor.waitFor();
  assert.equal(await page.locator('[data-memory-retained-pages]').getAttribute('data-memory-retained-pages'),'61');
  await windowEditor.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByText('61 / 61',{exact:true}).waitFor();
  await page.waitForFunction(()=>Number(document.querySelector('[data-memory-retained-pages]')?.getAttribute('data-memory-retained-pages'))<=48);
  for(let position=60;position>=1;position--){
   await page.getByRole('button',{name:'Previous page',exact:true}).last().click();
   await page.getByText(position+' / 61',{exact:true}).waitFor();
   assert.ok(await page.locator('[data-memory-retained-pages]').evaluate(node=>Number(node.getAttribute('data-memory-retained-pages'))<=48));
  }
  const windowReads=await page.evaluate(()=>window.pagingFixture.requests.filter(r=>r.name==='get_memory_book_window_v3'));
  assert.ok(windowReads.length>=3);assert.ok(windowReads.every(r=>r.args.p_before+r.args.p_after<=47&&r.pinned));
  assert.ok(windowReads.some(r=>r.args.p_before===35));
  checks.push('bounded reader walks all61 pages forward and backward, preserves global position, and trims back after complete editor hydration');
  await page.screenshot({path:path.join(artifacts,'bounded-book-return.png')});

  await page.goto(origin+'/?mode=shelf');await page.getByRole('button',{name:'View all',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.pagingFixture.requests.filter(r=>r.name==='get_memory_books_page_v2').length),1);
  await page.getByRole('button',{name:'View all',exact:true}).click();const collection=page.getByRole('dialog',{name:'Your memory books',exact:true});
  await collection.getByRole('textbox',{name:'Search memory books',exact:true}).fill('Collection 31');
  await page.waitForFunction(()=>window.pagingFixture.requests.some(r=>r.name==='get_memory_books_page_v2'&&r.args.p_cursor));
  assert.equal(await collection.getByText('No books match your search.',{exact:true}).count(),0);
  await page.evaluate(()=>window.pagingFixture.release('shelf-next'));
  await collection.getByRole('link',{name:'Collection 31, 1 memories',exact:true}).waitFor();
  const shelfReads=await page.evaluate(()=>window.pagingFixture.requests.filter(r=>r.name==='get_memory_books_page_v2'));
  assert.deepEqual(shelfReads.map(r=>r.args.p_cursor?.after||0),[0,12,24]);assert.ok(shelfReads.every(r=>r.args.p_limit===12&&r.pinned));
  await collection.getByRole('textbox',{name:'Search memory books',exact:true}).fill('');assert.equal(await collection.getByRole('link').count(),31);
  checks.push('shelf starts with12, expands all31 on collection open, and search never reports a partial empty result');
  await page.screenshot({path:path.join(artifacts,'complete-shelf.png')});

  await page.goto(origin);await page.getByRole('button',{name:'Open book',exact:true}).waitFor();await page.getByRole('button',{name:'Album settings',exact:true}).click();
  await page.waitForFunction(()=>window.pagingFixture.requests.some(r=>r.name==='get_memory_book_page_v2'&&r.args.p_cursor));
  await page.evaluate(()=>{window.pagingFixture.changeAccount();window.pagingFixture.release('book-next');});
  await page.getByText('This album is private.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'Book editor',exact:true}).count(),0);
  checks.push('account replacement cannot complete a pending editor or show the old reader');
  assert.deepEqual(errors,[]);
  const receipt={checkedAt:new Date().toISOString(),runtime:await browser.version(),checks,errors,scope:'Actual web components and shared paging client; synthetic local responses. SQL authorization/cursor semantics tested separately. No hosted traffic or production capacity claim.'};
  await fs.writeFile(path.join(artifacts,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
 }catch(error){await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true});await fs.writeFile(path.join(artifacts,'failure.json'),JSON.stringify({error:String(error),errors,checks,text:await page.locator('body').innerText()},null,2));throw error;}
 finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
