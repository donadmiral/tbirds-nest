import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export async function healthy(directory, now = Date.now()) {
  let handle;
  try {
    handle = await open(path.join(directory, 'pc-live-transcription-health.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat(); if (!stat.isFile() || stat.size < 1 || stat.size > 1024) return false;
    const bytes = Buffer.alloc(1025), read = await handle.read(bytes, 0, bytes.length, 0); if (read.bytesRead > 1024) return false;
    const value = JSON.parse(bytes.subarray(0, read.bytesRead).toString('utf8'));
    return value.version === 1 && value.stopping === false && Number.isSafeInteger(value.heartbeat_ms) && now >= value.heartbeat_ms && now - value.heartbeat_ms < 90000
      && (value.cycle_started_ms === null || Number.isSafeInteger(value.cycle_started_ms) && now >= value.cycle_started_ms && now - value.cycle_started_ms < 100000);
  } catch { return false; } finally { await handle?.close().catch(() => {}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = await healthy(process.env.TMPDIR || '/scratch'); process.stdout.write(ok ? 'healthy\n' : 'unhealthy\n'); process.exitCode = ok ? 0 : 1;
}
