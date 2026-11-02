"use client";
import { useEffect, useState } from 'react';
import { readPostPollFlag, subscribePostMetadataSession } from './postMetadata';

/** Results belong to the mounted card; the shared reader only retains active I/O. */
export function usePollFlag(postId: string, hint?: boolean): boolean {
  const [known, setKnown] = useState<{ postId: string; value: boolean } | null>(null);
  useEffect(() => {
    let live = true, version = 0, resolved = false, pending = false;
    const load = async () => {
      if (hint !== undefined || pending || resolved) return;
      pending = true;
      const run = ++version;
      try {
        const value = await readPostPollFlag(postId);
        if (!live || run !== version) return;
        resolved = true;
        setKnown({ postId, value });
      } catch { /* A failed read remains retryable when connectivity returns. */ }
      finally { if (live && run === version) pending = false; }
    };
    const unsubscribe = subscribePostMetadataSession(() => {
      version++; resolved = false; pending = false; setKnown(null); void load();
    });
    void load();
    window.addEventListener('online', load);
    return () => { live = false; version++; unsubscribe(); window.removeEventListener('online', load); };
  }, [postId, hint]);
  return hint ?? (known?.postId === postId ? known.value : false);
}
