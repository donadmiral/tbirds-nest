/** Actual profile, book reader and editor; synthetic Auth/RPC and Next route adapters. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000003';
const frames=(page,count)=>page.evaluate(count=>new Promise(resolve=>{const tick=()=>--count?requestAnimationFrame(tick):resolve();requestAnimationFrame(tick);}),count);
const counts=page=>page.evaluate(()=>({posts:document.querySelectorAll('#profile-posts article').length,books:document.querySelectorAll('a[href^="/album/"]').length,loadingPosts:[...document.querySelectorAll('[role=status]')].some(node=>node.textContent==='Loading posts…'),loadingBooks:!!document.querySelector('[aria-label="Loading memory books"]')}));
async function runProfileNavigation(browser,origin,artifacts){
 const context=await browser.newContext({viewport:{width:1586,height:992},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],checks=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
 const check=(name,detail={})=>checks.push({name,passed:true,...detail});
 let probe;
 try{
  await page.goto(origin+'/avery_lane');await page.getByRole('link',{name:'Postcards, 3 memories',exact:true}).waitFor();await page.locator('#profile-posts article').waitFor();
  await page.getByRole('link',{name:'Postcards, 3 memories',exact:true}).click();await page.getByRole('button',{name:'Open book',exact:true}).waitFor();await frames(page,3);
  await page.evaluate(()=>{window.__socialFixture.clear();window.__socialFixture.holdNavigationReads(['profile-posts','books']);const probe=window.__profileProbe={start:null,stop:false,frames:[]};document.addEventListener('click',()=>{probe.start=performance.now();},{once:true,capture:true});const tick=time=>{if(probe.stop)return;if(probe.start!==null&&location.pathname==='/avery_lane'&&document.querySelector('#profile-posts'))probe.frames.push({at:time,sinceClickMs:performance.now()-probe.start,posts:document.querySelectorAll('#profile-posts article').length,books:document.querySelectorAll('a[href^="/album/"]').length,loadingPosts:[...document.querySelectorAll('[role=status]')].some(node=>node.textContent==='Loading posts…'),loadingBooks:!!document.querySelector('[aria-label="Loading memory books"]')});requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.waitForFunction(()=>window.__socialFixture.receipt.some(row=>row.operation==='heldNavigationRead'&&row.kind==='books'));
  await frames(page,36);
  // Repeated visibility/focus notifications must share the already pending reads.
  await page.evaluate(()=>{for(let n=0;n<8;n++){window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));}});await frames(page,5);
  probe=await page.evaluate(()=>{window.__profileProbe.stop=true;return window.__profileProbe;});assert.ok(probe.frames.length>=36);
  for(const frame of probe.frames){assert.equal(frame.posts,1,'every warm profile frame retains the loaded post');assert.equal(frame.books,4,'every warm profile frame retains the loaded books');assert.equal(frame.loadingPosts,false);assert.equal(frame.loadingBooks,false);}
  const held=await page.evaluate(()=>window.__socialFixture.receipt.filter(row=>row.operation==='heldNavigationRead'));
  assert.equal(held.filter(row=>row.kind==='profile-posts').length,1);assert.equal(held.filter(row=>row.kind==='books').length,1);
  await page.screenshot({path:path.join(artifacts,'warm-profile-refresh-held.png')});
  await page.evaluate(()=>window.__socialFixture.releaseNavigationReads(['profile-posts','books']));await frames(page,5);
  check('real book Back restores owner posts and four books on every sampled frame during held refreshes',{frames:probe.frames.length,firstProfileFrameMs:probe.frames[0].sinceClickMs,blankProfileFrames:0,postsReads:1,bookReads:1});

  await page.getByRole('link',{name:'Postcards, 3 memories',exact:true}).click();await page.getByRole('button',{name:'Open book',exact:true}).waitFor();await page.getByRole('button',{name:'Album settings',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Book editor',exact:true});await editor.getByLabel('Title',{exact:true}).fill('Saved private chapter');await editor.getByRole('button',{name:'Only me',exact:true}).click();await editor.getByRole('button',{name:'Save book',exact:true}).click();await editor.waitFor({state:'detached'});await page.getByRole('img',{name:/book cover: Saved private chapter/}).waitFor();
  const saved=await page.evaluate(()=>({book:window.__socialFixture.books[0],write:window.__socialFixture.receipt.find(row=>row.rpc==='save_memory_book_creative_presentation')}));assert.equal(saved.book.presentation_revision,1);assert.equal(saved.book.audience,'only_me');assert.equal(saved.write.args.p_expected_revision,0);assert.equal(saved.write.authorizationPinned,true);
  await page.evaluate(()=>window.__socialFixture.holdNavigationReads(['profile-posts','books']));await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('heading',{name:'Avery Lane',exact:true}).waitFor();await frames(page,4);
  assert.equal((await counts(page)).posts,1);assert.equal((await counts(page)).books,0,'a saved edit cannot reuse the previous shelf revision');
  await page.evaluate(()=>window.__socialFixture.releaseNavigationReads(['profile-posts','books']));await page.getByRole('link',{name:'Saved private chapter, 3 memories',exact:true}).waitFor();await page.getByRole('button',{name:'View all',exact:true}).click();const collection=page.getByRole('dialog',{name:'Your memory books',exact:true});await collection.getByRole('tab',{name:'Public',exact:true}).click();assert.equal(await collection.getByRole('link',{name:'Saved private chapter, 3 memories',exact:true}).count(),0);await collection.getByRole('tab',{name:'Private',exact:true}).click();await collection.getByRole('link',{name:'Saved private chapter, 3 memories',exact:true}).waitFor();await collection.getByRole('button',{name:'Close memory books',exact:true}).click();
  check('actual editor save invalidates off-route shelf revision and returns current title and private visibility',{revision:1,audience:'only_me',pinnedSave:true});

  await page.evaluate(()=>{window.__socialFixture.clear();window.__socialFixture.holdNavigationReads(['books']);window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>window.__socialFixture.receipt.some(row=>row.operation==='heldNavigationRead'&&row.kind==='books'));
  await page.evaluate(A=>{for(let n=0;n<8;n++)window.__socialFixture.renameBook(A,'Current chapter '+n);},A);await frames(page,5);
  const bookBurst=await page.evaluate(()=>window.__socialFixture.receipt.filter(row=>row.operation==='heldNavigationRead'&&row.kind==='books'));assert.equal(bookBurst.length,2,'a batched mutation burst starts one replacement read');assert.equal(bookBurst[0].aborted,true);
  await page.evaluate(()=>window.__socialFixture.releaseNavigationReads(['books']));await page.getByRole('link',{name:'Current chapter 7, 3 memories',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Saved private chapter, 3 memories',exact:true}).count(),0);
  check('rapid successful shelf changes cancel the stale read and coalesce to the latest book revision',{mutations:8,reads:2,staleReadAborted:true});

  await page.evaluate(()=>{window.__socialFixture.clear();window.__socialFixture.holdNavigationReads(['profile-posts','books']);document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>window.__socialFixture.receipt.some(row=>row.operation==='heldNavigationRead'&&row.kind==='books'));
  await page.evaluate(([A,B])=>{window.__socialFixture.books[0].title='After account round trip';window.__socialFixture.switchOwner(B);window.__socialFixture.switchOwner(A);},[A,B]);await frames(page,5);
  const switched=await counts(page);assert.equal(switched.posts,0);assert.equal(switched.books,0);assert.equal(switched.loadingPosts,true);assert.equal(switched.loadingBooks,true);
  await page.evaluate(()=>window.__socialFixture.releaseNavigationReads(['profile-posts','books']));await page.getByRole('link',{name:'After account round trip, 3 memories',exact:true}).waitFor();await page.locator('#profile-posts article').waitFor();
  const cancelled=await page.evaluate(()=>window.__socialFixture.receipt.filter(row=>row.operation==='heldNavigationRead'&&row.aborted));assert.ok(cancelled.some(row=>row.kind==='profile-posts'));assert.ok(cancelled.some(row=>row.kind==='books'));
  check('A to B to A clears warm content and cancels old transport before fresh results appear',{abortedReads:cancelled.length});

  await page.goto(origin+'/jordan_ellis');await page.getByRole('link',{name:'Postcards, 3 memories',exact:true}).waitFor();await page.locator('#profile-posts article').waitFor();await page.getByRole('link',{name:'Postcards, 3 memories',exact:true}).click();await page.getByRole('button',{name:'Open book',exact:true}).waitFor();await frames(page,3);
  await page.evaluate(()=>{window.__socialFixture.hideProfile('10000000-0000-4000-8000-000000000002');window.__socialFixture.holdNavigationReads(['profile-posts','books']);});await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('heading',{name:'Jordan Ellis',exact:true}).waitFor();await frames(page,4);assert.equal((await counts(page)).posts,0);assert.equal((await counts(page)).books,0,'visitor content never uses an old owner grant');
  await page.evaluate(()=>window.__socialFixture.releaseNavigationReads(['profile-posts','books']));await page.getByText('No posts yet.',{exact:true}).waitFor();await page.getByRole('heading',{name:'Memory books',exact:true}).waitFor({state:'detached'});
  check('visitor return waits for current visibility and removes revoked posts and books');
  assert.deepEqual(errors,[]);
  const receipt={checkedAt:new Date().toISOString(),runtime:await browser.version(),scope:'Actual ProfilePage, ProfilePosts, MemoryAlbumBook, MemoryAlbumView and book editor in Chromium. Auth/RPC, media signing and Next routing use synthetic local adapters. Frame samples measure component content presence, not hosted RSC latency, physical-device performance or GPU paint time.',checks,frames:probe.frames,browserErrors:errors};
  await fs.writeFile(path.join(artifacts,'profile-navigation-frames.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
 }catch(error){await page.screenshot({path:path.join(artifacts,'profile-navigation-failure.png'),fullPage:true});await fs.writeFile(path.join(artifacts,'profile-navigation-failure.json'),JSON.stringify({error:String(error),checks,probe,counts:await counts(page),errors},null,2)+'\n');throw error;}
 finally{await page.evaluate(()=>window.__socialFixture?.releaseNavigationReads(['profile-posts','books'])).catch(()=>{});await context.close();}
}
module.exports={runProfileNavigation};
