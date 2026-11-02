const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
const { createHash } = require('node:crypto'), { chromium } = require('../../node_modules/playwright'), { compile } = require('./ui-compile.cjs');
const repo = path.resolve(__dirname, '../../..'), output = '/tmp/pc-thread-history-browser', evidence = process.env.PC_THREAD_HISTORY_EVIDENCE || '/tmp/pc-thread-history-evidence';
const sources = ['shared/threadWindow.ts','web/components/MessagesApp.tsx','web/components/MeasuredThreadMessage.tsx','web/lib/messageNavigationMemory.ts','web/tests/browser/thread-fixture.tsx'];
const hashes = () => Promise.all(sources.map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(repo,file))).digest('hex')])).then(Object.fromEntries);
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const turns = (page, count = 6) => page.evaluate(count => new Promise(resolve => { const frame = () => --count <= 0 ? resolve() : requestAnimationFrame(frame); requestAnimationFrame(frame); }), count);
async function main() {
  await fs.mkdir(evidence,{recursive:true}); const before = await hashes(), checks = [], errors = [];
  const backend = path.join(__dirname,'social-backend.ts');
  await compile({ entry:path.join(__dirname,'thread-fixture.tsx'), output, aliases:{'@/lib/supabase/client':backend,'./supabase/client':backend,'../../lib/supabase/client':backend} });
  const server = http.createServer(async (request,response) => {
    const route = new URL(request.url,'http://local').pathname;
    try { const file = route.endsWith('.js') ? path.join(output,path.basename(route)) : route.endsWith('.css') ? path.join(output,'fixture.css') : path.join(output,'index.html');
      response.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}); response.end(await fs.readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true,executablePath:process.env.PLATINUM_CHROMIUM||'/tmp/platinum-web-admin-chrome156/chrome-linux64/chrome',args:['--no-sandbox']});
  let failure = null, page, measurement = {};
  try {
    page = await browser.newPage({viewport:{width:1440,height:1000}}); page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**/*',route=>route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/messages?c=conversation-fixture`);
    await page.locator('[data-thread-message]').first().waitFor(); await turns(page,12);
    const count = () => page.locator('[data-thread-message]').count(); let maximum = await count();
    for (let n = 0; n < 8; n++) {
      await page.getByRole('button',{name:'Load older messages',exact:true}).click(); await turns(page,10);
      maximum = Math.max(maximum,await count()); assert.ok(maximum<=120,`Retained ${maximum} messages`);
      assert.equal(await page.getByRole('alert').count(),0);
    }
    assert.equal(await page.getByRole('button',{name:'Load older messages',exact:true}).count(),0);
    assert.ok(await page.locator('[data-thread-gap]').count()>0); checks.push('420-message older paging keeps at most120 rendered messages with measured history gaps');
    await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep this unsent draft');
    await page.locator('[data-thread-window]').evaluate(node=>{node.parentElement.scrollTop=0;}); await turns(page,12);
    const anchor = await page.locator('[data-thread-message]').evaluateAll(nodes=>nodes.find(node=>node.getBoundingClientRect().top>=100)?.getAttribute('data-thread-message'));
    const oldTop = await page.locator(`[data-thread-message="${anchor}"]`).evaluate(node=>node.getBoundingClientRect().top);
    const oldReceipts = await page.evaluate(()=>window.__threadFixture.readReceipts());
    await page.evaluate(()=>window.__threadFixture.insert(421)); await turns(page,12);
    const newTop = await page.locator(`[data-thread-message="${anchor}"]`).evaluate(node=>node.getBoundingClientRect().top);
    assert.ok(Math.abs(oldTop-newTop)<=2,`Live arrival moved reading anchor ${oldTop} to ${newTop}`);
    assert.equal(await page.evaluate(()=>window.__threadFixture.readReceipts()),oldReceipts); checks.push('Live arrival preserves older reading position and does not acknowledge unseen messages');
    await page.evaluate(()=>window.__threadFixture.leave()); await page.locator('[data-away]').waitFor();
    await page.evaluate(()=>window.__threadFixture.return()); await page.locator(`[data-thread-message="${anchor}"]`).waitFor(); await turns(page,15);
    assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'Keep this unsent draft');
    const returnTop = await page.locator(`[data-thread-message="${anchor}"]`).evaluate(node=>node.getBoundingClientRect().top);
    assert.ok(Math.abs(returnTop-newTop)<=2,`Route return moved reading anchor ${newTop} to ${returnTop}`); checks.push('Route return preserves the draft and older reading position');
    await page.evaluate(()=>window.__threadFixture.deny([300,301]));
    const box = await page.locator('[data-thread-window]').evaluate(node=>{const r=node.parentElement.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};}); await page.mouse.move(box.x,box.y);
    for(let step=0;step<120;step++) {
      const done=await page.locator('[data-thread-window]').evaluate(node=>{const el=node.parentElement;return el.scrollTop+el.clientHeight>=el.scrollHeight-8;}); if(done)break;
      await page.mouse.wheel(0,1500); await turns(page,5); maximum=Math.max(maximum,await count()); assert.ok(maximum<=120);
      if(step===119)throw Error('Forward wheel did not reach the newest message');
    }
    await page.locator(`[data-thread-message="${id(421)}"]`).waitFor(); await turns(page,12);
    const reads=await page.evaluate(()=>window.__threadFixture.reads.filter(read=>read.ids));
    assert.ok(reads.length>0); assert.ok(reads.every(read=>read.ids.length<=100));
    assert.ok(reads.some(read=>read.pinned && read.ids.includes('30000000-0000-4000-8000-000000000300')));
    assert.equal(await page.locator(`[data-thread-message="${id(300)}"],[data-thread-message="${id(301)}"]`).count(),0);
    assert.ok(await page.evaluate(()=>window.__threadFixture.readReceipts())>oldReceipts); checks.push('Forward wheels reauthorize cold history in token-pinned batches and read receipts resume only at the newest edge');
    await page.evaluate(()=>window.__socialFixture.switchOwner(null)); await turns(page,10);
    assert.equal(await page.locator('[data-thread-message]').count(),0); checks.push('Sign-out purges the thread content');
    assert.deepEqual(errors,[]); measurement={maximumResidentMessages:maximum,oldTop,newTop,returnTop,restorationBatchSizes:reads.map(read=>read.ids.length)};
  } catch(error) { failure=error; if(page){measurement.failure=await page.evaluate(()=>({body:document.body.innerText.slice(0,4000),readCount:window.__threadFixture?.reads.length,rendered:document.querySelectorAll('[data-thread-message]').length})).catch(()=>null);await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});} }
  finally {
    const after=await hashes(); if(JSON.stringify(before)!==JSON.stringify(after)&&!failure)failure=Error('Source changed during browser verification');
    await fs.writeFile(path.join(evidence,'receipt.json'),JSON.stringify({checks,measurement,errors,hashes:before,failure:failure?.stack||null,scope:'Actual MessagesApp in Chromium with synthetic authorized records; no live backend or physical device capacity claim.'},null,2));
    await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  }
  if(failure)throw failure; console.log(JSON.stringify({checks:checks.length,evidence}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
