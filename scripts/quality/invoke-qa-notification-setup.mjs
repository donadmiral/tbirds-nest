#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const dir=process.argv[2];
if(process.argv.length!==3||!dir||!/^\/tmp\/platinum-qa-notification-setup-[a-f0-9]{16}$/.test(dir))throw new Error('Use the exact private preparation directory.');
const file=path.join(dir,'nonce.json');
if((fs.statSync(file).mode&0o077)!==0)throw new Error('Nonce file permissions are too broad');
const {nonce,armedAt,expiresAt}=JSON.parse(fs.readFileSync(file,'utf8'));
if(!/^[a-f0-9]{64}$/.test(nonce)||expiresAt-armedAt!==600_000)throw new Error('Invalid prepared nonce');
const origin='https://uaulhuelcfkjwojtymmw.supabase.co';
// Local container time can differ from provider time. This public HEAD carries
// no setup credential; the exact project TLS response supplies the clock.
const clock=await fetch(origin,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(8_000)});
const serverNow=Date.parse(clock.headers.get('date')??'');
await clock.body?.cancel();
if(!Number.isFinite(serverNow)||serverNow<armedAt||serverNow>=expiresAt)throw new Error('The provider time is outside the prepared setup window; inspect state before preparing again.');
const response=await fetch(origin+'/functions/v1/qa-notification-credential-setup',{
 method:'POST',headers:{Authorization:`Bearer ${nonce}`},redirect:'error',signal:AbortSignal.timeout(10_000),
});
const text=await response.text();
let result;try{result=JSON.parse(text);}catch{result={error:'Unexpected setup response; inspect database state'};}
console.log(JSON.stringify({status:response.status,providerTime:new Date(serverNow).toISOString(),result,automaticRetry:false,rawNoncePrinted:false},null,2));
if(response.status!==200||result.installed!==true)process.exitCode=1;
