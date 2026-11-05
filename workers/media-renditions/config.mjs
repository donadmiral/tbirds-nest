export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ASSET = /^(master\.m3u8|fallback\.mp4|r[0-3]\/(index\.m3u8|seg[0-9]{5}\.ts))$/;
export const safePath = p => typeof p === 'string' && p.length <= 1024 && !/[%\\\u0000-\u001f]/.test(p) && p.split('/').every(x=>x && x!=='.' && x!=='..');
export const liveClipPath = p => typeof p === 'string' && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/){4}(?:horizontal|vertical)\.mp4$/.test(p);
export function validateJob(j) {
  if (!j || !['job_id','lease_id','source_id','source_owner'].every(k=>UUID.test(j[k])) || !Number.isInteger(j.attempt) || j.attempt<1 || j.attempt>100
    // Clip paths identify the session owner; SQL provenance binds source_owner
    // to the actual clip creator, who can be an approved guest of that session.
    || !(j.source_bucket==='live-clips' ? liveClipPath(j.source_path) : ['post-media','story-media','chat-media','chat-files'].includes(j.source_bucket)&&safePath(j.source_path)&&j.source_path.startsWith(j.source_owner+'/'))
    || !Number.isSafeInteger(j.source_bytes) || j.source_bytes<1 || j.source_bytes>536870912 || typeof j.source_version!=='string' || !j.source_version || j.source_version.length>128
    || typeof j.source_etag!=='string' || !j.source_etag || j.source_etag.length>256 || /^W\//.test(j.source_etag)
    || j.output_bucket!=='adaptive-media' || j.output_prefix!==`${j.source_owner}/_renditions_v2/${j.job_id}/${j.lease_id}/`
    || !Number.isSafeInteger(j.output_max_bytes) || j.output_max_bytes<1 || j.output_max_bytes>805306368
    || !Number.isInteger(j.duration_max_seconds) || j.duration_max_seconds<1 || j.duration_max_seconds>600
    || !Number.isFinite(Date.parse(j.lease_until)) || Date.parse(j.lease_until)<=Date.now()+10000) throw Object.assign(new Error('invalid_job'),{permanent:true});
  return j;
}
export const objectPath = (bucket,path) => `${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
export function workerConfig(env=process.env) {
  const url=new URL(env.SUPABASE_URL || '');
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/')throw new Error('Invalid SUPABASE_URL');
  if(!env.SUPABASE_SERVICE_ROLE_KEY&&(!env.MEDIA_BROKER_URL||!env.MEDIA_BROKER_KEY))throw new Error('Server credentials are missing');
  return {base:url.origin,key:env.SUPABASE_SERVICE_ROLE_KEY,brokerUrl:env.MEDIA_BROKER_URL,brokerKey:env.MEDIA_BROKER_KEY,
    deadlineMs:Math.min(720000,Math.max(30000,Number(env.MEDIA_WORKER_DEADLINE_MS)||240000)),
    diskBudgetBytes:Math.min(2147483648,Math.max(67108864,Number(env.MEDIA_WORKER_DISK_BYTES)||(env.VERCEL?471859200:2147483648))),
    maxInputBytes:Math.min(536870912,Math.max(1,Number(env.MEDIA_WORKER_MAX_INPUT_BYTES)||(env.VERCEL?134217728:536870912))),
    threads:Math.min(4,Math.max(1,Number(env.MEDIA_WORKER_THREADS)||2))};
}
export function serviceConfig(env=process.env) {
  const config=workerConfig(env);
  if((env.CRON_SECRET||'').length<32)throw new Error('Server credentials are missing');
  return {...config,cronSecret:env.CRON_SECRET};
}
