/** Production encrypted preview storage and raster capture in a real browser. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const { PNG } = require('pngjs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const artifacts = process.env.PC_PREVIEW_EVIDENCE || '/tmp/platinum-browser-evidence/feed-previews';
const executablePath = process.env.PLATINUM_CHROMIUM || '/tmp/platinum-web-admin-chrome156/chrome-linux64/chrome';
const sourceFiles = ['web/lib/feedPreviewCache.ts', 'web/lib/feedPreviews.ts', 'shared/mediaDelivery.ts', 'shared/navigationCache.ts', 'web/tests/browser/feed-preview-persistence.cjs'];
const checks = []; let context, web, media, profile, mediaRequests = 0;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => server ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
async function main() {
  await fs.mkdir(artifacts, { recursive: true }); profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-preview-browser-'));
  const png = new PNG({ width: 320, height: 240 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 20; png.data[i+1] = 130; png.data[i+2] = 170; png.data[i+3] = 255; }
  const pixels = PNG.sync.write(png);
  media = http.createServer((request, response) => {
    mediaRequests++;
    response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', ...(request.url.includes('cors-failure') ? {} : { 'access-control-allow-origin': '*' }) }); response.end(pixels);
  });
  const mediaOrigin = await listen(media);
  const paths = { './feedPreviewCache': 'web/lib/feedPreviewCache.ts', './feedPreviews': 'web/lib/feedPreviews.ts', '../../shared/mediaDelivery': 'shared/mediaDelivery.ts', '../../shared/navigationCache': 'shared/navigationCache.ts' };
  let modules = '';
  for (const [name, file] of Object.entries(paths)) {
    const compiled = ts.transpileModule(await fs.readFile(path.join(root, file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    modules += `factories[${JSON.stringify(name)}] = (module, exports, require) => {\n${compiled}\n};\n`;
  }
  const bundle = `(() => {
    const process = { env: { NEXT_PUBLIC_SUPABASE_URL: ${JSON.stringify(mediaOrigin)} } };
    const factories = {}, cache = {}, listeners = new Set();
    let session = { user: { id: 'alice' }, access_token: 'x.' + btoa(JSON.stringify({session_id:'test-session-a'})) + '.x' };
    const client = { auth: { getSession: async () => ({ data: { session }, error: null }), onAuthStateChange: fn => { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; } } };
    factories['./supabase/client'] = module => { module.exports = { createClient: () => client }; };
    factories['./mediaPrefs'] = module => { module.exports = { dataSaverEnabled: () => false }; };
    ${modules}
    function require(name) { if (!cache[name]) { const module = cache[name] = { exports: {} }; factories[name](module, module.exports, require); } return cache[name].exports; }
    window.previewApi = require('./feedPreviews'); window.previewStore = window.previewApi.getFeedPreviewStore();
    window.previewLogout = async () => { session = null; listeners.forEach(fn => fn('SIGNED_OUT', session)); await window.previewStore.ready(); };
    window.previewRow = name => ({ post_id: name, media: [{ id: 'media-' + name, media_type: 'image', width: 320, height: 240, url: ${JSON.stringify(mediaOrigin)} + '/functions/v1/media-content/post-media/' + name + '.png?token=' + 'a'.repeat(64) }] });
    window.readPreviewRecord = () => new Promise((resolve,reject) => { const request=indexedDB.open('pc-public-previews-v1',1); request.onerror=()=>reject(request.error); request.onsuccess=()=>{ const db=request.result, tx=db.transaction('preview','readonly'), read=tx.objectStore('preview').get('recent'); read.onsuccess=()=>resolve(read.result); tx.oncomplete=()=>db.close(); }; });
  })();`;
  web = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); response.end('<!doctype html><html><body><script>'+bundle.replaceAll('</script', '<\\/script')+'</script></body></html>'); });
  const origin = await listen(web);
  const launch = () => chromium.launchPersistentContext(profile, { executablePath, headless: true, args: ['--no-sandbox'], viewport: { width: 600, height: 500 } });
  context = await launch(); let page = await context.newPage(); await page.goto(origin);
  const first = await page.evaluate(async () => {
    await window.previewApi.loadFeedPreviews('alice');
    await window.previewStore.write('alice', [window.previewRow('photo')], new Set(['photo']));
    const preview = window.previewStore.getSnapshot().previews[0];
    if (!preview) throw Error('Real raster capture did not produce a preview');
    const image = new Image(); image.src = preview.uri; await image.decode(); document.body.append(image);
    const canvas = document.createElement('canvas'); canvas.width=image.naturalWidth; canvas.height=image.naturalHeight;
    canvas.getContext('2d').drawImage(image,0,0); const pixel=[...canvas.getContext('2d').getImageData(5,5,1,1).data];
    const record = await window.readPreviewRecord(); let exportRejected=false;
    try { await crypto.subtle.exportKey('raw',record.key); } catch { exportRejected=true; }
    return { width:image.naturalWidth, height:image.naturalHeight, pixel, exportRejected, storedCryptoKey:record.key instanceof CryptoKey,
      extractable:record.key.extractable, plainPixelPersisted:JSON.stringify(record).includes(preview.uri), count:window.previewStore.getSnapshot().previews.length };
  });
  assert.equal(first.count,1); assert.equal(first.width,160); assert.equal(first.height,120); assert.ok(Math.abs(first.pixel[0]-20)<5 && Math.abs(first.pixel[1]-130)<5 && Math.abs(first.pixel[2]-170)<5);
  assert.equal(first.storedCryptoKey,true); assert.equal(first.extractable,false); assert.equal(first.exportRejected,true); assert.equal(first.plainPixelPersisted,false);
  checks.push('Actual cross-origin fetch, bitmap decode, 160px canvas JPEG and non-extractable IndexedDB CryptoKey clone');
  await page.screenshot({path:path.join(artifacts,'captured-preview.png')}); const requestsBefore=mediaRequests;
  await context.close(); context=null;
  context=await launch(); page=await context.newPage(); await page.goto(origin);
  const restored=await page.evaluate(async()=>{const rows=await window.previewApi.loadFeedPreviews('alice'); const image=new Image(); image.src=rows[0]?.uri||''; await image.decode(); document.body.append(image); return {count:rows.length,width:image.naturalWidth};});
  assert.equal(restored.count,1); assert.equal(restored.width,160); assert.equal(mediaRequests,requestsBefore);
  checks.push('New browser process restores and decodes encrypted preview without a media request');
  await page.screenshot({path:path.join(artifacts,'restored-preview.png')});
  const rejected=await page.evaluate(async()=>{await window.previewStore.clear(); await window.previewStore.write('alice',[window.previewRow('cors-failure')],new Set(['cors-failure'])); return {count:window.previewStore.getSnapshot().previews.length,record:!!await window.readPreviewRecord()};});
  assert.equal(rejected.count,0); assert.equal(rejected.record,false); checks.push('CORS-denied capture fails quietly without durable pixels');
  const logout=await page.evaluate(async()=>{await window.previewStore.write('alice',[window.previewRow('photo')],new Set(['photo'])); await window.previewLogout(); return {count:window.previewStore.getSnapshot().previews.length,record:!!await window.readPreviewRecord()};});
  assert.equal(logout.count,0); assert.equal(logout.record,false); checks.push('Logout removes decrypted preview and IndexedDB envelope');
  return { first, mediaRequests };
}
let result;
main().then(value=>{result={status:'passed',...value};}).catch(error=>{result={status:'failed',error:error.stack||String(error)};process.exitCode=1;}).finally(async()=>{
  await context?.close().catch(()=>{}); await Promise.all([close(web),close(media)]); if(profile)await fs.rm(profile,{recursive:true,force:true});
  const sourceSha256=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')])));
  await fs.mkdir(artifacts,{recursive:true}); await fs.writeFile(path.join(artifacts,'result.json'),JSON.stringify({...result,checks,sourceSha256,gitCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()},null,2)+'\n');
  console.log(JSON.stringify({...result,checks}));
});
