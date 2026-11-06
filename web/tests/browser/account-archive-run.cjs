const path=require('node:path'),fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const {compile}=require(root+'/tests/browser/ui-compile.cjs');
const {chromium}=require(root+'/node_modules/playwright');
(async()=>{
 const output=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pc-export-web-'));
 await compile({entry:path.join(__dirname,'account-archive-fixture.tsx'),output,aliases:{'@/lib/supabase/client':path.join(__dirname,'account-archive-backend.ts')}});
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/api/account-archive/')) {res.writeHead(200,{'Content-Disposition':'attachment; filename="account.jsonl"','Content-Type':'application/octet-stream'});return res.end('hello𐐷\n');}
  const file=path.join(output,req.url==='/'?'index.html':req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await chromium.launch({headless:true,executablePath:process.env.PLATINUM_CHROMIUM || undefined,args:['--no-sandbox']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Download',exact:true}).click();
  await page.getByText('Your archive is queued.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Prepare or check large archive'}).click();
  const [file]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download large archive (JSON Lines)'}).click()]);
  assert.equal(fs.readFileSync(await file.path(),'utf8'),'hello𐐷\n');assert.deepEqual(errors,[]);
  console.log('PASS: actual web settings 413 => queued => ready => downloaded verified test bytes');
 } finally {await browser?.close();server.close();fs.rmSync(output,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
