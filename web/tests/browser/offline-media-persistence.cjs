/** Exact original bytes, encrypted IndexedDB and browser process restart acceptance. */
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
const artifacts = process.env.PC_OFFLINE_EVIDENCE || '/tmp/platinum-browser-evidence/offline-originals';
const executablePath = process.env.PLATINUM_CHROMIUM || '/tmp/platinum-web-admin-chrome156/chrome-linux64/chrome';
const sourceFiles = ['web/lib/offlineMediaCache.ts', 'web/lib/offlineMedia.ts', 'web/lib/useOfflineMedia.ts', 'web/lib/feedPreviewCache.ts', 'web/components/MediaGallery.tsx', 'shared/mediaDelivery.ts', 'shared/navigationCache.ts', 'web/tests/browser/offline-media-persistence.cjs'];
const checks = []; let context, web, media, profile, directory, mediaRequests = 0;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => server ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  await fs.mkdir(artifacts, { recursive: true }); directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-offline-browser-')); profile = path.join(directory, 'profile');
  const png = new PNG({ width: 2560, height: 1440 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 20; png.data[i+1] = 130; png.data[i+2] = 170; png.data[i+3] = 255; }
  const pixels = PNG.sync.write(png), videoFile = path.join(directory, 'original.mp4');
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=720x1280:rate=24','-t','1.5','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',videoFile], { timeout: 30000 });
  const movie = await fs.readFile(videoFile);
  media = http.createServer((request, response) => {
    mediaRequests++; const video = request.url.includes('movie.mp4'), data = video ? movie : pixels;
    response.writeHead(200, { 'content-type': video ? 'video/mp4' : 'image/png', 'content-length': data.length, 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); response.end(data);
  });
  const mediaOrigin = await listen(media);
  const paths = { './offlineMediaCache': 'web/lib/offlineMediaCache.ts', './offlineMedia': 'web/lib/offlineMedia.ts', './feedPreviewCache': 'web/lib/feedPreviewCache.ts', '../../shared/mediaDelivery': 'shared/mediaDelivery.ts', '../../shared/navigationCache': 'shared/navigationCache.ts' };
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
    window.originalStore = require('./offlineMedia').getOfflineMediaStore();
    window.logout = async () => { session = null; listeners.forEach(fn => fn('SIGNED_OUT', session)); await window.originalStore.ready(); };
    window.row = name => ({ post_id: name, _mediaVersions: {['post-media/' + name + (name === 'movie' ? '.mp4' : '.png')]: 'source-v1'}, media: [{ id: 'media-' + name, media_type: name === 'movie' ? 'video' : 'image', width: name === 'movie' ? 720 : 2560, height: name === 'movie' ? 1280 : 1440, url: ${JSON.stringify(mediaOrigin)} + '/functions/v1/media-content/post-media/' + name + (name === 'movie' ? '.mp4' : '.png') + '?token=' + 'a'.repeat(64) }] });
    window.dbState = () => new Promise((resolve,reject) => { const request=indexedDB.open('pc-public-originals-v1',1); request.onerror=()=>reject(request.error); request.onsuccess=()=>{ const db=request.result, tx=db.transaction(['session','media'],'readonly'), a=tx.objectStore('session').get('current'), b=tx.objectStore('media').getAll(); tx.oncomplete=()=>{resolve({session:a.result,media:b.result});db.close();}; }; });
    window.decode = async () => {
      const results = {};
      for (const name of ['photo','movie']) {
        const asset = await window.originalStore.read(name,'media-'+name); if (!asset) throw Error('Original missing: '+name);
        const bytes = await asset.blob.arrayBuffer(), hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
        const url = URL.createObjectURL(asset.blob);
        if (name === 'photo') {
          const img = new Image(); img.src=url; await img.decode(); document.body.append(img); img.style.width='320px';
          results[name] = {hash,bytes:bytes.byteLength,width:img.naturalWidth,height:img.naturalHeight};
        } else {
          const video = document.createElement('video'); video.muted=true; video.playsInline=true; video.src=url; video.style.height='320px'; document.body.append(video);
          await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Original video did not decode')),10000);video.addEventListener('loadeddata',()=>{clearTimeout(timer);resolve();},{once:true});video.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Original video decoder error'));},{once:true});video.load();});
          await video.play(); await new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{if(video.currentTime>0.2){resolve();return;}if(performance.now()-start>5000){reject(Error('Original video did not advance'));return;}requestAnimationFrame(check);};check();});
          results[name] = {hash,bytes:bytes.byteLength,width:video.videoWidth,height:video.videoHeight,time:video.currentTime}; video.pause();
        }
        URL.revokeObjectURL(url);
      }
      return results;
    };
  })();`;
  web = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); response.end('<!doctype html><html><body><script>'+bundle.replaceAll('</script', '<\\/script')+'</script></body></html>'); });
  const origin = await listen(web);
  const launch = () => chromium.launchPersistentContext(profile, { executablePath, headless: true, args: ['--no-sandbox'], viewport: { width: 900, height: 600 } });
  context = await launch(); let page = await context.newPage(); await page.goto(origin);
  const stored = await page.evaluate(async () => {
    await window.originalStore.write('alice', [window.row('photo'), window.row('movie')], new Set(['photo','movie']));
    const state = await window.dbState(); let exportRejected=false;
    try { await crypto.subtle.exportKey('raw',state.session.key); } catch { exportRejected=true; }
    return {count:state.media.length,exportRejected,extractable:state.session.key.extractable,containsGrant:JSON.stringify(state.media).includes('?token='),bytes:state.media.map(item=>item.encrypted.byteLength)};
  });
  assert.equal(stored.count,2); assert.equal(stored.exportRejected,true); assert.equal(stored.extractable,false); assert.equal(stored.containsGrant,false);
  assert.deepEqual(stored.bytes.sort((a,b)=>a-b),[pixels.length+16,movie.length+16].sort((a,b)=>a-b));
  checks.push('Full original PNG and MP4 bytes persisted with AES-GCM, non-extractable key, no grant URL and exact ciphertext lengths');
  const requestsBefore=mediaRequests; await context.close(); context=null;
  context=await launch(); page=await context.newPage(); await page.goto(origin);
  await page.waitForFunction(()=>window.originalStore.getSnapshot().owner==='alice'); await context.setOffline(true);
  const restored = await page.evaluate(()=>window.decode());
  assert.equal(restored.photo.hash,digest(pixels)); assert.equal(restored.movie.hash,digest(movie));
  assert.equal(restored.photo.width,2560); assert.equal(restored.photo.height,1440); assert.equal(restored.movie.width,720); assert.equal(restored.movie.height,1280); assert.ok(restored.movie.time>0.2); assert.equal(mediaRequests,requestsBefore);
  checks.push('New browser process, offline network: exact full-resolution image decode and original portrait video playback with no media request');
  await page.screenshot({path:path.join(artifacts,'offline-originals.png')});
  const denied = await page.evaluate(async()=>{await window.originalStore.write('alice',[window.row('photo')],new Set());return !!await window.originalStore.read('photo','media-photo');});
  assert.equal(denied,false); checks.push('Fresh public-eligibility denial removes the full original');
  const logout = await page.evaluate(async()=>{await window.logout();const state=await window.dbState();return {count:state.media.length,session:!!state.session,read:!!await window.originalStore.read('movie','media-movie')};});
  assert.deepEqual(logout,{count:0,session:false,read:false}); checks.push('Logout removes original ciphertext, key and read access');
  return { stored, restored, mediaRequests };
}
let result;
main().then(value=>{result={status:'passed',...value};}).catch(error=>{result={status:'failed',error:error.stack||String(error)};process.exitCode=1;}).finally(async()=>{
  await context?.close().catch(()=>{}); await Promise.all([close(web),close(media)]); if(directory)await fs.rm(directory,{recursive:true,force:true});
  const sourceSha256=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,digest(await fs.readFile(path.join(root,file)))])));
  await fs.mkdir(artifacts,{recursive:true}); await fs.writeFile(path.join(artifacts,'result.json'),JSON.stringify({...result,checks,sourceSha256,gitCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()},null,2)+'\n');
  console.log(JSON.stringify({...result,checks}));
});
