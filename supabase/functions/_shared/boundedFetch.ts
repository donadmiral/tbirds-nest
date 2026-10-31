// One bounded network operation, including response-body consumption. Preserve
// both the caller cancellation and any timeout/signal supplied by the SDK.
export function boundedFetch(fetcher: typeof fetch, parent?: AbortSignal, deadlineMs = 8000): typeof fetch {
  return (input, init) => {
    const signals: AbortSignal[] = [AbortSignal.timeout(deadlineMs)];
    if (parent) signals.push(parent);
    const initSignal = (init as { signal?: AbortSignal | null } | undefined)?.signal;
    if (initSignal) signals.push(initSignal);
    if (input instanceof Request) signals.push(input.signal);
    return fetcher(input, { ...init, signal: AbortSignal.any(signals) });
  };
}
