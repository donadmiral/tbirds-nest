import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const filename = 'pc-live-clips-health.json';
export async function isHealthy(directory, now = Date.now()) {
  let handle;
  try {
    handle = await open(path.join(directory, filename), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024) return false;
    const bytes = Buffer.alloc(1025), read = await handle.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead > 1024) return false;
    const value = JSON.parse(bytes.subarray(0, read.bytesRead).toString());
    return value.version === 1 && value.stopping === false && Number.isSafeInteger(value.heartbeat_ms)
      && now >= value.heartbeat_ms && now - value.heartbeat_ms < 90000
      && (value.cycle_started_ms === null || (Number.isSafeInteger(value.cycle_started_ms)
        && now >= value.cycle_started_ms && now - value.cycle_started_ms < 290000));
  } catch { return false; } finally { await handle?.close().catch(() => {}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const healthy = await isHealthy(process.env.TMPDIR || os.tmpdir());
  process.stdout.write(healthy ? 'healthy\n' : 'unhealthy\n'); process.exitCode = healthy ? 0 : 1;
}
