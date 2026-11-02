/** Local production-component acceptance for long-session retained history. */
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
const { execFileSync } = require('node:child_process'), { createHash } = require('node:crypto');
const { chromium } = require('../../node_modules/playwright'), { compile } = require('./ui-compile.cjs');
const repo = path.resolve(__dirname, '../../..'), output = process.env.PC_HISTORY_OUTPUT || '/tmp/pc-client-bounds-browser';
const artifacts = process.env.PC_HISTORY_EVIDENCE || '/tmp/pc-client-bounds-browser-evidence';
const sourceFiles = ['shared/sessionHistory.ts','web/lib/sessionHistory.ts','web/lib/homeFeedController.ts','web/components/HomeFeed.tsx',
  'web/components/PostCard.tsx','web/components/VideoPlayer.tsx','web/tests/browser/scroll-fixture.tsx','web/tests/browser/session-history.cjs'];
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(repo,file))).digest('hex')])));
const id = index => `20000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const turns = (page, count = 4) => page.evaluate(count => new Promise(resolve => { const tick = () => --count <= 0 ? resolve() : requestAnimationFrame(tick); requestAnimationFrame(tick); }),count);
async function main() {
  await fs.mkdir(artifacts,{recursive:true}); const before = await hashes(), checks = [], errors = [];
  const backend = path.join(__dirname,'social-backend.ts');
  await compile({entry:path.join(__dirname,'scroll-fixture.tsx'),output,aliases:{'@/lib/supabase/client':backend,'@/lib/supabase/server':backend,'@/lib/serverViewer':backend,'@/lib/contentMedia':backend,'./supabase/client':backend,'../../lib/supabase/client':backend}});
  const video = path.join(output,'video.mp4');
  execFileSync('ffmpeg',['-loglevel','error','-y','-f','lavfi','-i','color=c=0x365d80:s=320x180:d=2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',video]);
  const bytes = await fs.readFile(video);
  const server = http.createServer(async (request,response) => {
    const pathname = new URL(request.url,'http://local').pathname;
    try {
      if (pathname.endsWith('.svg')) { response.writeHead(200,{'content-type':'image/svg+xml'}); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720"><rect width="1200" height="720" fill="#c9d6df"/></svg>'); return; }
      if (pathname.endsWith('.mp4')) { response.writeHead(200,{'content-type':'video/mp4'}); response.end(bytes); return; }
      const asset = pathname.endsWith('.js') ? path.join(output,path.basename(pathname)) : pathname.endsWith('.css') ? path.join(output,'fixture.css') : path.join(output,'index.html');
      response.writeHead(200,{'content-type':asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html'});response.end(await fs.readFile(asset));
    } catch { response.writeHead(404);response.end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true,executablePath:process.env.PLATINUM_CHROMIUM||'/tmp/platinum-web-admin-chrome156/chrome-linux64/chrome',args:['--no-sandbox']});
  let failure = null, measurements = {}, activePage;
  try {
    const page = activePage = await browser.newPage({viewport:{width:1586,height:992}});page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**/*',route=>route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/home?history=1`);
    await page.locator('[data-history-page]').first().waitFor();await turns(page,12);
    const size = () => page.locator('[data-feed-content] [data-pid]').count();
    let maximum = 0;
    for (let step=0;step<200;step++) {
      const last = await page.locator('[data-feed-content] [data-index]').last().getAttribute('data-index');
      maximum = Math.max(maximum,await size());assert.ok(maximum<=120,`Resident feed grew to ${maximum}`);
      if(Number(last)>=219)break;
      await page.mouse.wheel(0,1500);await turns(page,5);
      assert.equal(await page.getByText('The feed could not load. Please try again.',{exact:true}).count(),0);
      if(step===199)throw Error('Long feed did not advance through 220 rows');
    }
    const deep = await page.evaluate(()=>({y:scrollY,before:Number(document.querySelector('[data-history-before]')?.getBoundingClientRect().height||0),
      first:Number(document.querySelector('[data-feed-content] [data-index]')?.getAttribute('data-index')),count:document.querySelectorAll('[data-feed-content] [data-pid]').length}));
    assert.ok(deep.first>=100);assert.ok(deep.before>0);checks.push('220-row real wheel traversal retains at most 120 rows and measured top geometry');
    const anchor = await page.locator('[data-feed-content] [data-pid]').evaluateAll(nodes=>nodes.find(node=>node.getBoundingClientRect().top>=0)?.getAttribute('data-pid'));
    const prior = anchor ? await page.locator(`[data-pid="${anchor}"]`).evaluate(node=>node.getBoundingClientRect().top) : null;
    await page.getByRole('link',{name:'Messages',exact:true}).first().click();await page.getByRole('heading',{name:'Messages',exact:true}).waitFor();
    await page.goBack();await page.locator(`[data-pid="${anchor}"]`).waitFor();await turns(page,16);
    const returned = await page.locator(`[data-pid="${anchor}"]`).evaluate(node=>node.getBoundingClientRect().top);
    assert.ok(Math.abs(returned-prior)<=2,`Back navigation moved anchor ${prior} to ${returned}`);checks.push('Warm route return preserves deep measured scroll and resident rows');
    await page.evaluate(ids=>window.__scrollFixture.deny(ids),[id(2),id(3)]);
    // Route navigation left the pointer over the independently scrollable
    // sidebar. Return it to the feed before testing ordinary reverse wheels.
    await page.mouse.move(850,500);
    for(let step=0;step<200;step++){if(await page.evaluate(()=>scrollY<10))break;await page.mouse.wheel(0,-1800);await turns(page,5);}
    await page.locator(`[data-pid="${id(1)}"]`).waitFor();await turns(page,12);
    assert.equal(await page.locator(`[data-pid="${id(2)}"],[data-pid="${id(3)}"]`).count(),0);
    const reads = await page.evaluate(()=>window.__scrollFixture.historyReads);
    assert.ok(reads.some(ids=>ids.includes('20000000-0000-4000-8000-000000000001')));assert.ok(reads.every(ids=>ids.length<=100));
    assert.ok(await size()<=120);checks.push('Reverse wheel reauthorizes old IDs in bounded batches and omits revoked posts');
    const ledger = await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('pc-history-v1:')).map(key=>sessionStorage.getItem(key)).join('\n'));
    assert.doesNotMatch(ledger,/Wheel verification|synthetic-only|https?:|token=/);checks.push('Device ledger stores identifiers and geometry without content or media grants');
    await page.evaluate(()=>window.__socialFixture.switchOwner(null));await turns(page,8);
    assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('pc-history-v1:')).length),0);checks.push('Sign-out purges the reading ledger and fences the previous account');
    measurements={maximumResidentRows:maximum,deep,backAnchorBefore:prior,backAnchorAfter:returned,restorationBatches:reads.map(ids=>ids.length)};
    assert.deepEqual(errors,[]);await page.screenshot({path:path.join(artifacts,'history-final.png')});
  }catch(error){failure=error;if(activePage){measurements.failureState=await activePage.evaluate(()=>({y:scrollY,
    first:document.querySelector('[data-feed-content] [data-index]')?.getAttribute('data-index'),
    last:[...document.querySelectorAll('[data-feed-content] [data-index]')].at(-1)?.getAttribute('data-index'),
    count:document.querySelectorAll('[data-feed-content] [data-pid]').length,status:[...document.querySelectorAll('[role="status"],[role="alert"]')].map(node=>node.textContent),
    historyReads:window.__scrollFixture?.historyReads.map(ids=>({count:ids.length,first:ids[0],last:ids.at(-1)}))})).catch(()=>null);await activePage.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});}}finally{
    const after=await hashes(),changed=sourceFiles.filter(file=>before[file]!==after[file]);if(changed.length&&!failure)failure=Error('Source changed during test: '+changed.join(','));
    await fs.writeFile(path.join(artifacts,'receipt.json'),JSON.stringify({checks,measurements,errors,hashes:before,changed,failure:failure?.stack||null,scope:'Actual web components with synthetic local authenticated readers and Chromium wheel input; not hosted capacity or physical-device evidence.'},null,2));
    await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
  if(failure)throw failure;console.log(JSON.stringify({checks:checks.length,artifacts}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
