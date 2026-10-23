/** Serializes one action per key and rejects results after an account or route reset. */
export function createScopedMutation() {
  let epoch = 0;
  const pending = new Set<string>();
  return {
    reset() { epoch++; pending.clear(); },
    async run<T extends { data?: unknown; error?: unknown }>(key: string, work: () => PromiseLike<T>): Promise<{data: T['data']; error: T['error'] | {message:string} | null; stale: boolean}> {
      const stale = {data: undefined, error: null, stale: true};
      if (pending.has(key)) return stale;
      const scope = epoch; pending.add(key);
      try { const result = await work(); return scope === epoch ? {...result,data:result.data,error:result.error??null,stale:false} : stale; }
      catch (error) { return scope === epoch ? {data:undefined,error:{message:error instanceof Error ? error.message : 'The action could not be confirmed. Refresh before trying again.'},stale:false} : stale; }
      finally { if(scope===epoch)pending.delete(key); }
    },
  };
}
