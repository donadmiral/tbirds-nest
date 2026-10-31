const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Module=require('node:module'),ts=require('typescript'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const root=path.resolve(__dirname,'..');
function loader(overrides={}) {
 const cache=new Map();
 function load(file) {
  file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;
  const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,mod);
  mod.require=ref=>ref in overrides?overrides[ref]:ref.startsWith('.')?load(path.resolve(path.dirname(file),ref)):require(ref);
  mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
  return mod.exports;
 }return load;
}
const load=loader(),policy=load('supabase/functions/link-preview/networkPolicy.ts'),transport=load('supabase/functions/link-preview/transport.ts'),handler=load('supabase/functions/link-preview/handler.ts');
const bytes=text=>new TextEncoder().encode(text);
const publicAddress={address:'93.184.216.34',family:4};
const result=(html='<title>Verified title</title>',extra={})=>({status:200,headers:{'content-type':'text/html'},bytes:bytes(html),url:'https://example.com/',...extra});
const token='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001';
const denoTransport=load('supabase/functions/link-preview/denoTransport.ts');

function wireFixture(raw,{readSize=7,stall=false,writeSize=13}={}) {
 const input=typeof raw==='string'?bytes(raw):raw;let offset=0,closed=0,written=[],waiting;
 const connections=[],names=[];
 const connection={
  read:async target=>{if(offset===input.length){if(stall)return new Promise((_,reject)=>waiting=reject);return null;}const size=Math.min(target.length,readSize,input.length-offset);target.set(input.subarray(offset,offset+size));offset+=size;return size;},
  write:async input=>{const size=Math.min(writeSize,input.length);written.push(Buffer.from(input.subarray(0,size)));return size;},
  close:()=>{closed++;waiting?.(new Error('closed'));},handshake:async()=>({}),
 };
 const connector={connect:async options=>{connections.push(options);return connection;},startTls:async(conn,options)=>{assert.equal(conn,connection);names.push(options);return connection;}};
 return {connector,connection,connections,names,closed:()=>closed,read:()=>offset,written:()=>Buffer.concat(written).toString()};
}
const wireHead=(extra='',mime='text/html')=>`HTTP/1.1 200 OK\r\nContent-Type: ${mime}\r\n${extra}\r\n`;
const wireRead=(fixture,kind='html',signal=new AbortController().signal,url='https://example.com/item?x=1',address=publicAddress)=>denoTransport.createDenoPinnedRequest(fixture.connector)(new URL(url),address,kind,signal);

test('Deno TCP/TLS reader handles content length, EOF, informational and chunked framing with partial reads/writes',async()=>{
 const responses=[wireHead('Content-Length: 5\r\n')+'hello',wireHead()+'hello',
  'HTTP/1.1 103 Early Hints\r\nLink: </main.css>\r\n\r\n'+wireHead('Content-Length: 5\r\n')+'hello',
  wireHead('Transfer-Encoding: chunked\r\n')+'2;source=test\r\nhe\r\n3\r\nllo\r\n0\r\nX-Trace: fixture\r\n\r\n'];
 for(const raw of responses){const f=wireFixture(raw),r=await wireRead(f);assert.equal(new TextDecoder().decode(r.bytes),'hello');assert.ok(f.closed());
  assert.deepEqual(f.connections,[{hostname:publicAddress.address,port:443}]);assert.deepEqual(f.names,[{hostname:'example.com',alpnProtocols:['http/1.1']}]);
  assert.match(f.written(),/^GET \/item\?x=1 HTTP\/1.1\r\nHost: example.com\r\n/);assert.doesNotMatch(f.written(),/Authorization:|Cookie:|apikey:/i);}
 const ipv6={address:'2606:4700:4700::1111',family:6},f=wireFixture(wireHead('Content-Length: 0\r\n'));
 await wireRead(f,'html',new AbortController().signal,'https://[2606:4700:4700::1111]/',ipv6);
 assert.equal(f.connections[0].hostname,ipv6.address);assert.equal(f.names[0].hostname,ipv6.address);assert.match(f.written(),/Host: \[2606:4700:4700::1111\]/);
});

test('Deno HTTP framing rejects ambiguous, malformed, truncated, compressed and oversized heads',async()=>{
 const invalid=[
  'HTTP/2 200 OK\r\n\r\n', 'HTTP/1.1 200 OK\nContent-Type: text/html\n\nhello',
  wireHead('Content-Length: 5\r\nContent-Length: 5\r\n')+'hello',
  wireHead('Content-Length: -1\r\n'),wireHead('Content-Length: 1e2\r\n'),wireHead('Content-Length: 9007199254740993\r\n'),
  wireHead('Content-Length: 5\r\nTransfer-Encoding: chunked\r\n')+'5\r\nhello\r\n0\r\n\r\n',
  wireHead('Transfer-Encoding: gzip, chunked\r\n'), wireHead('Content-Encoding: gzip\r\n')+'compressed',
  wireHead(' Folded: header\r\n'), wireHead('Bad Header: value\r\n'), wireHead('X-Huge: '+'a'.repeat(17000)+'\r\n'),
  wireHead(Array.from({length:101},(_,i)=>`X-${i}: a\r\n`).join('')), wireHead('Content-Length: 5\r\n')+'hey',
  wireHead('Transfer-Encoding: chunked\r\n')+'oops\r\n',wireHead('Transfer-Encoding: chunked\r\n')+'5\r\nhe',
  wireHead('Transfer-Encoding: chunked\r\n')+'5\r\nhelloXX0\r\n\r\n',
  wireHead('Transfer-Encoding: chunked\r\n')+'0\r\nContent-Length: 0\r\n\r\n',
  'HTTP/1.1 101 Switching Protocols\r\n\r\n', wireHead('Content-Length: 0\r\n','application/json'),
 ];
 for(const raw of invalid){const f=wireFixture(raw,{readSize:4096});await assert.rejects(wireRead(f),/upstream/);assert.ok(f.closed());}
});

test('Deno body limits stop HTML early and reject oversized raster length, chunks or EOF streams',async()=>{
 const html=wireFixture(wireHead('Content-Length: 400000\r\n')+'a'.repeat(400000),{readSize:16384});
 assert.equal((await wireRead(html)).bytes.length,300000);assert.ok(html.read()<400000);assert.ok(html.closed());
 for(const raw of [wireHead('Content-Length: 2000001\r\n','image/png'),wireHead('Transfer-Encoding: chunked\r\n','image/png')+'1e8481\r\n',wireHead('','image/png')+'a'.repeat(2000001)]){
  const f=wireFixture(raw,{readSize:16384});await assert.rejects(wireRead(f,'image'),/too_large/);assert.ok(f.closed());
 }
 const framing=wireFixture(wireHead('Transfer-Encoding: chunked\r\n')+('1;'+ 'x'.repeat(1000)+'\r\na\r\n').repeat(80)+'0\r\n\r\n',{readSize:16384});
 await assert.rejects(wireRead(framing),/upstream/);assert.ok(framing.closed());
});

test('Deno cancellation and the absolute deadline close an unfinished socket without accepting partial images',async()=>{
 const ctrl=new AbortController();
 // Leave the declared body unfinished so cancellation must close the read.
 const stalled=wireFixture(wireHead('Content-Length: 100\r\n')+'partial',{stall:true});
 const work=wireRead(stalled,'html',ctrl.signal);await new Promise(r=>setImmediate(r));ctrl.abort();await assert.rejects(work,/timeout/);assert.ok(stalled.closed());
 const slow=wireFixture('HTTP/1.1 200',{stall:true});
 const fetch=transport.createSafeFetch({resolve:async()=>[publicAddress],request:denoTransport.createDenoPinnedRequest(slow.connector),timeoutMs:15});
 await assert.rejects(fetch('https://example.com/','html'),/timeout/);assert.ok(slow.closed());
});

test('Deno late TCP connection is closed after an aborted request and never starts TLS or sends HTTP',async()=>{
 let deliver;const f=wireFixture(wireHead('Content-Length: 0\r\n'));
 const connector={...f.connector,connect:()=>new Promise(resolve=>deliver=resolve)};
 const fetch=transport.createSafeFetch({resolve:async()=>[publicAddress],request:denoTransport.createDenoPinnedRequest(connector),timeoutMs:15});
 await assert.rejects(fetch('https://example.com/','html'),/timeout/);deliver(f.connection);await new Promise(r=>setImmediate(r));
 assert.ok(f.closed());assert.equal(f.names.length,0);assert.equal(f.written(),'');
});

test('network policy rejects local, special, mapped, tunnel and noncanonical private URLs',()=>{
 for(const address of ['0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.2.1','192.0.0.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::','::ffff:127.0.0.1','::ffff:7f00:1','fc00::1','fe80::1','64:ff9b::a00:1','2001::1','2001:db8::1','2002:7f00:1::1','3fff::1'])assert.equal(policy.isPublicAddress(address),false,address);
 for(const address of ['1.1.1.1','8.8.8.8','93.184.216.34','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(policy.isPublicAddress(address),true,address);
 for(const url of ['http://localhost/','http://localhost./','http://name.local/','http://metadata.google.internal/','http://127.1/','http://2130706433/','http://0x7f000001/','http://0177.0.0.1/','http://[::ffff:127.0.0.1]/','https://example.com:8443/','https://name:password@example.com/','file:///etc/passwd','https://example.com/\nsecret'])assert.throws(()=>policy.previewUrl(url),policy.PreviewError,url);
 assert.equal(policy.previewUrl('https://example.com./page#fragment').href,'https://example.com/page');
 assert.throws(()=>policy.choosePublicAddress([publicAddress,{address:'10.0.0.1',family:4}]),/blocked/);
 assert.throws(()=>policy.choosePublicAddress([{address:'93.184.216.34',family:6}]),/blocked/);
});

test('each redirect is independently validated and a private DNS answer stops before connection',async()=>{
 for(const location of ['http://169.254.169.254/latest/meta-data/','https://127.1/','https://metadata.internal/','https://user:pass@example.com/']) {
  const calls=[];const fetch=transport.createSafeFetch({resolve:async()=>[publicAddress],request:async(url,address)=>{calls.push({url:url.href,address});return result('',{status:302,headers:{location}});}});
  await assert.rejects(fetch('https://example.com','html'),/blocked/);assert.equal(calls.length,1);
 }
 const calls=[];const fetch=transport.createSafeFetch({resolve:async host=>host==='next.example.com'?[{address:'127.0.0.1',family:4}]:[publicAddress],request:async(url,address)=>{calls.push({url:url.href,address});return result('',{status:302,headers:{location:'https://next.example.com/private'}});}});
 await assert.rejects(fetch('https://example.com','html'),/blocked/);assert.equal(calls.length,1);
});

test('DNS rebinding cannot replace the checked socket destination and TLS retains the real hostname',async()=>{
 let lookups=0;const connected=[];
 const fetch=transport.createSafeFetch({resolve:async()=>++lookups===1?[publicAddress]:[{address:'127.0.0.1',family:4}],request:async(url,address,kind,signal)=>{connected.push(transport.pinnedOptions(url,address,signal));return result();}});
 await fetch('https://example.com/path?item=1','html');assert.equal(lookups,1);
 const options=connected[0];assert.equal(options.hostname,publicAddress.address);assert.equal(options.servername,'example.com');assert.equal(options.headers.Host,'example.com');assert.equal(options.path,'/path?item=1');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);
 assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.apikey,undefined);
 const cert={subject:{CN:'unrelated.example.com'},subjectaltname:'DNS:unrelated.example.com'};assert.ok(options.checkServerIdentity(publicAddress.address,cert));
});

test('public relative redirects work, while loops, downgrade, excessive hops and slow DNS stop',async()=>{
 let calls=0;
 const fetch=transport.createSafeFetch({resolve:async()=>[publicAddress],request:async()=>++calls===1?result('',{status:301,headers:{location:'/landing'}}):result()});
 assert.equal((await fetch('https://example.com','html')).url,'https://example.com/landing');
 for(const location of ['https://example.com/','http://example.com/']) {
  const work=transport.createSafeFetch({resolve:async()=>[publicAddress],request:async()=>result('',{status:302,headers:{location}})});
  await assert.rejects(work('https://example.com','html'),/blocked|upstream/);
 }
 calls=0;const endless=transport.createSafeFetch({resolve:async()=>[publicAddress],request:async()=>result('',{status:302,headers:{location:`/next-${++calls}`}})});
 await assert.rejects(endless('https://example.com','html'),/upstream/);assert.equal(calls,5);
 let connected=0;const slow=transport.createSafeFetch({timeoutMs:15,resolve:()=>new Promise(()=>{}),request:async()=>{connected++;return result();}});
 await assert.rejects(slow('https://example.com','html'),/timeout/);assert.equal(connected,0);
});

function streamRequest({status=200,headers={'content-type':'text/html'},chunks=[],stall=false}={}) {
 let destroyed=0,written=0;const options=[];
 const request=(opts,callback)=>{
  options.push(opts);const req=new EventEmitter(),res=new PassThrough();res.statusCode=status;res.headers=headers;
  req.destroy=()=>{destroyed++;res.destroy();};
  req.end=()=>queueMicrotask(()=>{callback(res);if(stall)return;const pump=()=>{if(res.destroyed)return;const part=chunks[written++];if(part){res.write(part);queueMicrotask(pump);}else res.end();};pump();});
  return req;
 };
 return {request,options,destroyed:()=>destroyed,written:()=>written};
}
test('the actual stream reader bounds HTML bytes and closes the upstream early',async()=>{
 const stream=streamRequest({chunks:Array.from({length:100},()=>Buffer.alloc(10_000,65))});
 const fetch=transport.createPinnedRequest({http:stream.request,https:stream.request});
 const r=await fetch(new URL('https://example.com'),publicAddress,'html',new AbortController().signal);
 assert.equal(r.bytes.byteLength,300_000);assert.equal(stream.written(),30);assert.ok(stream.destroyed());
});
test('the actual stream reader rejects compression, non-HTML, large images and unfinished bodies',async()=>{
 for(const headers of [{'content-type':'application/json'},{'content-type':'text/html','content-encoding':'gzip'}]) {
  const stream=streamRequest({headers,chunks:[Buffer.from('secret')]});
  await assert.rejects(transport.createPinnedRequest({http:stream.request,https:stream.request})(new URL('https://example.com'),publicAddress,'html',new AbortController().signal),/upstream/);assert.ok(stream.destroyed());assert.equal(stream.written(),0);
 }
 const large=streamRequest({headers:{'content-type':'image/png'},chunks:[Buffer.alloc(2_000_001)]});
 await assert.rejects(transport.createPinnedRequest({http:large.request,https:large.request})(new URL('https://example.com'),publicAddress,'image',new AbortController().signal),/too_large/);
 const stalled=streamRequest({stall:true}),ctrl=new AbortController();
 const work=transport.createPinnedRequest({http:stalled.request,https:stalled.request})(new URL('https://example.com'),publicAddress,'html',ctrl.signal);ctrl.abort();await assert.rejects(work,/timeout/);assert.ok(stalled.destroyed());
});

function harness(extra={}) {
 const calls={auth:[],read:[],save:[],fetch:[],claim:[],image:[],claimImage:[]};
 const deps={base:'https://backend.supabase.co',now:()=>Date.parse('2026-10-30T00:00:00Z'),randomId:()=>token,
  authenticate:async auth=>{calls.auth.push(auth);return{id:actor};},
  read:async url=>{calls.read.push(url);return null;},save:async row=>{calls.save.push(row);return row;},claim:async id=>{calls.claim.push(id);return true;},claimImage:async id=>{calls.claimImage.push(id);return true;},
  image:async id=>{calls.image.push(id);return 'https://example.com/image.png';},fetch:async(url,kind,signal)=>{calls.fetch.push({url,kind,signal});return result('<meta property="og:title" content="Verified &amp; safe"><meta property="og:image" content="/image.png">');},...extra};
 const serve=handler.createLinkPreviewHandler(deps);
 const post=(url='https://example.com',headers={},body)=>serve(new Request('https://backend.supabase.co/functions/v1/link-preview',{method:'POST',headers:{Authorization:'Bearer caller-token','Content-Type':'application/json',...headers},body:body??JSON.stringify({url,title:'forged',image_url:'http://127.0.0.1/secret'})}));
 return {serve,post,calls};
}
test('CORS works and authentication, anonymous accounts, bad URLs and oversized bodies stop before fetch',async()=>{
 const h=harness();const options=await h.serve(new Request('https://backend.supabase.co/functions/v1/link-preview',{method:'OPTIONS'}));assert.equal(options.status,204);assert.match(options.headers.get('Access-Control-Allow-Headers'),/authorization/);
 assert.equal((await h.post('https://example.com',{Authorization:''})).status,401);assert.equal(h.calls.auth.length,0);
 assert.equal((await harness({authenticate:async()=>({id:actor,anonymous:true})}).post()).status,401);
 for(const url of ['http://localhost/','http://[::1]/','https://user:pass@example.com','file:///secret'])assert.equal((await h.post(url)).status,400);
 assert.equal((await h.post('https://example.com',{},'x'.repeat(9000))).status,400);assert.equal(h.calls.fetch.length,0);
});
test('fresh previews ignore all submitted metadata, preserve exact cache keys and expose only service thumbnail tokens',async()=>{
 const h=harness(),r=await h.post(),body=await r.json();assert.equal(r.status,200);assert.equal(body.url,'https://example.com');assert.equal(body.title,'Verified & safe');assert.equal(body.image_url,`https://backend.supabase.co/functions/v1/link-preview?image=${token}`);
 assert.equal(body.image_origin_url,undefined);assert.equal(body.verified_at,undefined);assert.equal(h.calls.save[0].image_origin_url,'https://example.com/image.png');assert.equal(h.calls.claim[0],actor);
 assert.match(r.headers.get('Cache-Control'),/no-store/);assert.equal(r.headers.get('Authorization'),null);
});
test('unverified or future-dated cache entries cannot bypass the verified fetch, while fresh cache hits avoid it',async()=>{
 const cached={url:'https://example.com',title:'Cached',description:null,image_url:'http://127.0.0.1',domain:'example.com',image_origin_url:'https://example.com/image.png',image_token:token,fetched_at:'2026-10-30T00:00:00Z',verified_at:'2026-10-30T00:00:00Z'};
 const hit=harness({read:async()=>cached});assert.equal((await (await hit.post()).json()).title,'Cached');assert.equal(hit.calls.fetch.length,0);assert.equal(hit.calls.claim.length,0);
 for(const verified_at of [null,'bad','2027-01-01T00:00:00Z','2026-10-01T00:00:00Z']){
  const h=harness({read:async()=>({...cached,verified_at})});assert.equal((await (await h.post()).json()).title,'Verified & safe');assert.equal(h.calls.fetch.length,1);
 }
});
test('unavailable cache writes still return a text preview and never create a broken thumbnail capability',async()=>{
 const h=harness({save:async()=>{throw new Error('postgres password secret');}}),r=await h.post(),body=await r.json();assert.equal(r.status,200);assert.equal(body.title,'Verified & safe');assert.equal(body.image_url,null);assert.doesNotMatch(JSON.stringify(body),/password|secret/);
 for(const extra of [{claim:async()=>false},{claim:async()=>{throw new Error('service-key');}},{fetch:async()=>{throw new Error('internal IP and provider-secret');}}]) {
  const r=await harness(extra).post();assert.ok(r.status>=400);assert.doesNotMatch(await r.text(),/service-key|internal IP|provider-secret/);
 }
});
test('concurrent requests coalesce one bounded authenticated fetch and one service budget claim',async()=>{
 let done;const h=harness({fetch:()=>new Promise(resolve=>done=resolve)});
 const first=h.post(),second=h.post();while(!done)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls.claim.length,1);done(result());await Promise.all([first,second]);assert.equal(h.calls.save.length,1);
});
test('thumbnail GET uses only a service cache token, revalidates every destination and rejects non-raster bytes',async()=>{
 const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 const h=harness({fetch:async(url,kind)=>{h.calls.fetch.push({url,kind});return result('',{bytes:png});}});
 const response=await h.serve(new Request(`https://backend.supabase.co/functions/v1/link-preview?image=${token}`));assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(h.calls.auth.length,0);assert.equal(h.calls.fetch[0].kind,'image');assert.equal(h.calls.fetch[0].url,'https://example.com/image.png');
 assert.equal((await h.serve(new Request('https://backend.supabase.co/functions/v1/link-preview?image=https://example.com/'))).status,400);
 assert.equal((await h.serve(new Request(`https://backend.supabase.co/functions/v1/link-preview?image=${token}&image=nonce`))).status,400);
 const bad=harness({fetch:async()=>result('<svg onload="alert(1)"></svg>')});assert.equal((await bad.serve(new Request(`https://backend.supabase.co/functions/v1/link-preview?image=${token}`))).status,422);
 const absent=harness({image:async()=>null});assert.equal((await absent.serve(new Request(`https://backend.supabase.co/functions/v1/link-preview?image=${token}`))).status,404);assert.equal(absent.calls.fetch.length,0);
});
test('repeated public thumbnail reads reuse bounded bytes and cold isolates still require the persistent budget',async()=>{
 const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);let claims=0,fetches=0,clock=0;
 const deps={now:()=>clock,claimImage:async()=>++claims<=1,fetch:async()=>{fetches++;return result('',{bytes:png});}};
 const first=harness(deps),url=`https://backend.supabase.co/functions/v1/link-preview?image=${token}`;
 for(let i=0;i<30;i++)assert.equal((await first.serve(new Request(url))).status,200);
 assert.equal(claims,1);assert.equal(fetches,1);
 assert.equal((await harness(deps).serve(new Request(url))).status,429);assert.equal(fetches,1);
 clock=300_001;assert.equal((await first.serve(new Request(url))).status,429);assert.equal(fetches,1);
});
test('independent first writers return the stable token from the atomic service store',async()=>{
 let stored;
 const save=async row=>{const stable=stored?.image_token||token;stored={...row,image_token:stable,image_url:`https://backend.supabase.co/functions/v1/link-preview?image=${stable}`};return stored;};
 const otherToken='10000000-0000-4000-8000-000000000002';
 const a=harness({save}),b=harness({save,randomId:()=>otherToken});
 const [first,second]=await Promise.all([a.post(),b.post()]);
 const [x,y]=await Promise.all([first.json(),second.json()]);assert.equal(first.status,200);assert.equal(second.status,200);
 assert.equal(x.image_url,y.image_url);assert.ok(x.image_url.endsWith(token));
});
test('metadata parser handles attribute order, entities and relative images, and discards private images',()=>{
 const p=handler.metadata("<meta content='Title &#x1F4A1;' property='og:title'><meta name=description content='Useful &amp; brief'><meta property=og:image content='../photo.png'>",'https://example.com/page/one');assert.equal(p.title,'Title 💡');assert.equal(p.description,'Useful & brief');assert.equal(p.image,'https://example.com/photo.png');
 assert.equal(handler.metadata('<meta property="og:image" content="http://127.0.0.1/secret">','https://example.com').image,null);
 assert.equal(handler.metadata('<title>Fallback &amp; title</title>','https://example.com').title,'Fallback & title');
});
test('native preview fetches through the server only and provider failures keep plain-link publishing available',async()=>{
 const sent=[];let failure=false;
 const api={functions:{invoke:async(name,options)=>{sent.push({name,options});if(failure)throw new Error('offline');return{data:{url:options.body.url,title:'Server title',description:null,image_url:null},error:null};}}};
 const native=loader({'./supabase':{supabase:api}})('src/services/linkPreview.ts');
 const preview=await native.fetchLinkPreview('example.com');assert.equal(preview.title,'Server title');assert.equal(preview.url,'https://example.com');
 await native.cacheLinkPreview({...preview,title:'untrusted',image_url:'http://127.0.0.1'});assert.deepEqual(sent[1],{name:'link-preview',options:{body:{url:'https://example.com'}}});
 failure=true;const fallback=await native.fetchLinkPreview('example.com');assert.equal(fallback.url,'https://example.com');assert.equal(fallback.domain,'example.com');assert.equal(fallback.title,null);
});
