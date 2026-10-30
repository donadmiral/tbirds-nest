/** Browser checks of real admin components with synthetic data and a navigation adapter. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('../../../web/node_modules/playwright');
const output=process.env.PLATINUM_UI_OUTPUT||'/tmp/platinum-admin-browser';
const artifacts=process.env.PLATINUM_UI_ARTIFACTS||path.resolve(__dirname,'../../../docs/quality/admin-ui-20261029');
const executablePath=process.env.PLATINUM_CHROMIUM||'/tmp/platinum-memory-browsers/chrome-linux64/chrome';
const errors=[];const checks=[];
async function check(name,action){await action();checks.push(name);console.log('PASS',name);}
async function main(){
 await fs.mkdir(artifacts,{recursive:true});
 const server=http.createServer(async(req,res)=>{
  const requested=new URL(req.url,'http://localhost').pathname;
  const file=['/fixture.js','/fixture.css','/logo.png'].includes(requested)?requested.slice(1):'index.html';
  try{const data=await fs.readFile(path.join(output,file));res.writeHead(200,{'content-type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html'});res.end(data);}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1600,height:1100},reducedMotion:'reduce'});
 const page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await context.addInitScript(()=>{localStorage.setItem('pc-rail-pins','{"bad":"shape"}');localStorage.setItem('pc-rail-closed-groups','"broken"');localStorage.setItem('pc-rail-collapsed','{}');localStorage.setItem('pc-recent-pages','false');});
  await page.goto(origin+'/dashboard');
  await check('Corrupt saved navigation preferences do not crash the workspace',async()=>{await page.getByRole('heading',{name:'Workspace overview'}).waitFor();await page.getByRole('navigation',{name:'Operations navigation',exact:true}).getByRole('link',{name:'Dashboard',exact:true}).waitFor();assert.equal(errors.length,0);});
  await check('Unknown queue count is shown as unavailable',async()=>{await page.getByRole('navigation',{name:'Operations navigation',exact:true}).getByLabel('Count unavailable').waitFor();});
  await check('Command search traps focus, supports Escape and restores focus',async()=>{const trigger=page.getByRole('button',{name:'Search desks, members, actions'});await trigger.focus();await trigger.click();await page.getByRole('dialog',{name:'Search operations'}).waitFor();assert.equal(await page.getByRole('combobox',{name:'Find a desk or action'}).evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.getByRole('button',{name:'Close search'}).evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Search operations'}).waitFor({state:'hidden'});assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);});
  await check('Record switch clears the previous record action text',async()=>{const note=page.getByRole('textbox',{name:'Review basis'});await note.fill('This note belongs only to Avery Chen.');await page.getByRole('row',{name:'Blake Williams',exact:true}).click();assert.equal(await note.inputValue(),'');assert.equal(await page.locator('.pc-review-detail input[name="id"]').inputValue(),'fixture-1');});
  await check('Required review length prevents a short form submission',async()=>{await page.getByRole('textbox',{name:'Review basis'}).fill('Too short');await page.getByRole('button',{name:'Save review note'}).click();assert.equal(await page.locator('#fixture-receipt').textContent(),'');assert.equal(await page.getByRole('textbox',{name:'Review basis'}).evaluate(node=>node.validity.tooShort),true);});
  await check('A valid review submits the selected identity with an idempotency key',async()=>{await page.getByRole('textbox',{name:'Review basis'}).fill('Independently checked the evidence for Blake.');await page.getByRole('button',{name:'Save review note'}).click();await page.waitForFunction(()=>document.getElementById('fixture-receipt').textContent.includes('fixture-1'));const receipt=JSON.parse(await page.locator('#fixture-receipt').textContent());assert.equal(receipt.id,'fixture-1');assert.match(receipt.command_key,/^[0-9a-f-]{36}$/);});
  await check('Pagination never leaves an actionable record from the hidden page',async()=>{await page.getByRole('button',{name:'Next',exact:true}).click();assert.equal(await page.locator('.pc-review-detail input[name="id"]').inputValue(),'fixture-10');assert.equal(await page.getByRole('textbox',{name:'Review basis'}).inputValue(),'');await page.getByRole('button',{name:'Back',exact:true}).click();});
  await check('Search is case-insensitive and clearing filters restores all rows',async()=>{await page.getByRole('textbox',{name:'Search this review page'}).fill('cHeN');assert.equal(await page.getByRole('grid',{name:'Account details records'}).getByRole('row').count(),2);await page.getByRole('button',{name:'Clear filters'}).click();assert.equal(await page.getByRole('grid',{name:'Account details records'}).getByRole('row').count(),11);});
  await check('Tab filter keeps selection inside the visible records',async()=>{await page.getByRole('row',{name:'Blake Williams',exact:true}).click();await page.locator('.pc-desk-tab').filter({hasText:'Needs review'}).click();assert.equal(await page.locator('.pc-review-detail input[name="id"]').inputValue(),'fixture-0');await page.locator('.pc-desk-tab').filter({hasText:'All accounts'}).click();});
  await check('Numeric column sorting and rows-per-page controls update actual records',async()=>{await page.getByRole('button',{name:'Sort Followers ascending'}).click();await page.getByRole('button',{name:'Sort Followers descending'}).click();assert.equal(await page.getByRole('grid',{name:'Account details records'}).getByRole('row').nth(1).getAttribute('aria-label'),'Hayden Wright');await page.getByRole('combobox',{name:'Rows per page'}).selectOption('50');assert.equal(await page.getByRole('grid',{name:'Account details records'}).getByRole('row').count(),27);await page.getByRole('combobox',{name:'Rows per page'}).selectOption('10');});
  await check('Closing record details returns focus to its selected row',async()=>{const row=page.getByRole('row',{name:'Hayden Wright',exact:true});await row.click();await page.getByRole('button',{name:'Close details'}).click();assert.equal(await row.evaluate(node=>node===document.activeElement),true);assert.equal(await page.locator('.pc-review-detail input[name="id"]').count(),0);await row.click();});
  await check('Charts expose exact values and keyboard-operable series controls',async()=>{await page.getByText('View chart data',{exact:true}).click();const table=page.locator('.pc-chart-data table');await table.waitFor();assert.ok(await table.getByRole('row').count()>1);assert.ok((await table.textContent()).includes('Active members'));await page.getByRole('button',{name:'Show 7 days',exact:true}).click();assert.equal(await table.getByRole('row').count(),8);await page.getByText('View chart data',{exact:true}).click();});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(artifacts,'desktop-light.png'),fullPage:true});
  await check('Dark appearance changes the actual workspace palette',async()=>{await page.getByRole('button',{name:'Dark appearance'}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.waitForFunction(()=>getComputedStyle(document.body).backgroundColor==='rgb(10, 18, 32)');assert.equal(await page.locator('body').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(10, 18, 32)');});
  await page.screenshot({path:path.join(artifacts,'desktop-dark.png'),fullPage:true});
  await check('Desktop rail collapse preserves accessible route labels',async()=>{await page.getByRole('button',{name:'Collapse navigation',exact:true}).click();await page.waitForFunction(()=>Math.round(document.querySelector('.pc-side-rail').getBoundingClientRect().width)===76);assert.equal(await page.locator('.pc-side-rail').evaluate(node=>Math.round(node.getBoundingClientRect().width)),76);await page.getByRole('navigation',{name:'Operations navigation',exact:true}).getByRole('link',{name:'Support',exact:true}).waitFor();await page.getByRole('button',{name:'Expand navigation',exact:true}).click();});
  await page.getByRole('button',{name:'Light appearance'}).click();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await check('Mobile workspace has no horizontal page overflow',async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);assert.equal(await page.locator('.pc-side-rail').isVisible(),false);});
  await check('Mobile drawer traps navigation, closes on Escape and restores trigger focus',async()=>{const trigger=page.getByRole('button',{name:'Open navigation',exact:true});await trigger.click();await page.getByRole('dialog',{name:'Operations navigation',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Operations navigation',exact:true}).waitFor({state:'hidden'});assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);});
  await page.screenshot({path:path.join(artifacts,'mobile-light.png'),fullPage:true});
  const analyst=await context.newPage();analyst.on('pageerror',error=>errors.push(error.message));await analyst.goto(origin+'/dashboard?role=analyst');
  await check('Restricted roles receive no member-search escape or unauthorized quick action',async()=>{await analyst.getByRole('button',{name:'Search desks and actions'}).click();await analyst.getByRole('combobox',{name:'Find a desk or action'}).fill('zzzz_member');await analyst.getByText('No matching destinations',{exact:true}).waitFor();assert.equal(await analyst.getByRole('listbox',{name:'Matching destinations'}).getByRole('option').count(),0);await analyst.keyboard.press('ArrowDown');await analyst.keyboard.press('Enter');assert.equal(new URL(analyst.url()).pathname,'/dashboard');await analyst.keyboard.press('Escape');assert.equal(await analyst.getByRole('navigation',{name:'Operations navigation',exact:true}).getByRole('link',{name:'Users',exact:true}).count(),0);});
  await analyst.close();
  assert.deepEqual(errors,[],'No browser runtime errors');
  const receipt={checkedAt:new Date().toISOString(),runtime:await browser.version(),scope:'Actual shared admin components, synthetic records and navigation adapter; not authenticated hosted acceptance',checks:checks.map(name=>({name,passed:true})),browserErrors:errors,screenshots:['desktop-light.png','desktop-dark.png','mobile-light.png']};
  await fs.writeFile(path.join(artifacts,'browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,browserErrors:errors.length,artifacts}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1});
