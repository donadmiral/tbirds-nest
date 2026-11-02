import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
// Runtime Cache is shared across a Hobby team's projects. Never put plaintext
// tickets or internal Storage capabilities in that shared cache.
export function encryptedCache(cache,secret,scope){
 if(typeof secret!=='string'||secret.length<32)throw new Error('MEDIA_CAPABILITY_SECRET must have at least 32 characters');
 const key=createHash('sha256').update(secret).digest(),namespace=createHash('sha256').update(scope).digest('hex');
 const name=k=>`pc-media-v2:${namespace}:${createHash('sha256').update(k).digest('hex')}`;
 return {
  async get(k){try{const raw=await cache.get(name(k));if(typeof raw!=='string')return;const data=Buffer.from(raw,'base64url');if(data.length<29||data.length>131072)return;const decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));decipher.setAAD(Buffer.from(name(k)));decipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString());}catch{return;}},
  async set(k,value,ttl){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(name(k)));const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>100000)throw new Error('cache_item_budget');const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);await cache.set(name(k),Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url'),{ttl,name:'private-media-v2'});},
 };
}
export function memoryCache(maxEntries=2048,now=Date.now){
 const map=new Map();return {async get(key){const v=map.get(key);if(!v)return;if(v.until<=now()){map.delete(key);return;}map.delete(key);map.set(key,v);return v.value;},async set(key,value,{ttl}){map.delete(key);map.set(key,{value,until:now()+ttl*1000});while(map.size>maxEntries)map.delete(map.keys().next().value);},get size(){return map.size;}};
}
