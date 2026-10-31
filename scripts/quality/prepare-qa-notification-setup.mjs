#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--server-time')throw new Error('Usage: node scripts/quality/prepare-qa-notification-setup.mjs --server-time FRESH_PROVIDER_UTC_ISO_TIME');
const armedAt=Date.parse(args[1].replace(' UTC','Z').replace(' ','T'));
if(!Number.isFinite(armedAt))throw new Error('A fresh explicit provider/clock UTC timestamp is required; local container time is not used.');
const expiresAt=armedAt+600_000;
const sha=value=>createHash('sha256').update(value).digest('hex');
const receiptPath='docs/quality/notification-acceptance-20261031/edge-deployment.json';
const receipt=JSON.parse(fs.readFileSync(path.join(root,receiptPath),'utf8'));
if(receipt.projectRef!=='uaulhuelcfkjwojtymmw')throw new Error('Wrong deployment receipt project');
const bundleHashes={};
for(const name of ['send-push-notification','send-voip-push']){
 const entry=receipt.deployments.find(row=>row.name===name);
 if(!entry||entry.status!=='ACTIVE'||!entry.readbackEveryFileIdentical||entry.gatewayVerifyJwt!==false
  ||entry.liveDenials.length<2||entry.liveDenials.some(row=>row.status!==401))throw new Error(`Unverified handler: ${name}`);
 for(const[file,digest]of Object.entries(entry.files)){
  const target=path.resolve(root,file);
  if(!target.startsWith(root+path.sep)||sha(fs.readFileSync(target))!==digest)throw new Error(`Handler changed after readback: ${file}`);
 }
 bundleHashes[name]=sha(JSON.stringify(Object.entries(entry.files).sort(([a],[b])=>a.localeCompare(b))));
}
const dir=path.join('/tmp',`platinum-qa-notification-setup-${randomBytes(8).toString('hex')}`);
fs.mkdirSync(dir,{mode:0o700});
const nonce=randomBytes(32).toString('hex'),nonceHash=sha(nonce);
const sourceDir=path.join(root,'supabase/ops/qa/notification-dispatch-setup');
let entry=fs.readFileSync(path.join(sourceDir,'index.ts.template'),'utf8');
for(const[marker,value]of Object.entries({__NONCE_SHA256__:nonceHash,__ARMED_AT_MS__:String(armedAt),__EXPIRES_AT_MS__:String(expiresAt)})){
 if(entry.split(marker).length!==2)throw new Error(`Invalid unique template marker: ${marker}`);
 entry=entry.replace(marker,value);
}
fs.writeFileSync(path.join(dir,'index.ts'),entry,{mode:0o600});
fs.copyFileSync(path.join(sourceDir,'handler.ts'),path.join(dir,'handler.ts'));
fs.chmodSync(path.join(dir,'handler.ts'),0o600);
fs.writeFileSync(path.join(dir,'nonce.json'),JSON.stringify({nonce,armedAt,expiresAt})+'\n',{mode:0o600});
const arm=`update notification_delivery.settings set project_origin='https://uaulhuelcfkjwojtymmw.supabase.co',
 ordinary_handler_sha256='${bundleHashes['send-push-notification']}',call_handler_sha256='${bundleHashes['send-voip-push']}',
 setup_nonce_digest=decode('${nonceHash}','hex'),setup_armed_at=to_timestamp(${armedAt}/1000.0),setup_expires_at=to_timestamp(${expiresAt}/1000.0)
 where singleton and not enabled and setup_used_at is null
 and not exists(select 1 from vault.secrets where name='notification_dispatch_service_key')
 returning singleton,enabled,project_origin,setup_armed_at,setup_expires_at;\n`;
fs.writeFileSync(path.join(dir,'arm.sql'),arm,{mode:0o600});
const metadata={directory:dir,functionName:'qa-notification-credential-setup',projectRef:'uaulhuelcfkjwojtymmw',armedAt:new Date(armedAt).toISOString(),expiresAt:new Date(expiresAt).toISOString(),nonceHash,bundleHashes,
 files:['index.ts','handler.ts'].map(name=>({name,sha256:sha(fs.readFileSync(path.join(dir,name)))})),deploymentReceipt:{path:receiptPath,sha256:sha(fs.readFileSync(path.join(root,receiptPath)))},rawNoncePrinted:false};
fs.writeFileSync(path.join(dir,'preparation.json'),JSON.stringify(metadata,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(metadata,null,2));
