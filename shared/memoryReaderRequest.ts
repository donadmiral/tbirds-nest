/** Local read ownership only. Cancelling this wait must never sign out or
 * cancel Supabase's shared auth/refresh operation. */
export function createMemoryReaderRequest() {
  const controller = new AbortController();
  let retired = false;
  let cancelWait: (() => void) | undefined;
  const cancelled = () => Object.assign(new Error('The reader request was cancelled.'), { name: 'AbortError' });
  return {
    signal: controller.signal,
    read<T>(start: () => PromiseLike<T>, milliseconds?: number): Promise<T> {
      if (retired) return Promise.reject(cancelled());
      if (cancelWait) return Promise.reject(new Error('Reader stages must run sequentially.'));
      return new Promise<T>((resolve, reject) => {
        let complete = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (accepted: boolean, value: T | unknown) => {
          if (complete) return;
          complete = true;
          if (timer !== undefined) clearTimeout(timer);
          cancelWait = undefined;
          if (accepted) resolve(value as T); else reject(value);
        };
        cancelWait = () => finish(false, cancelled());
        if (milliseconds !== undefined) timer = setTimeout(() => {
          retired = true;
          controller.abort();
          finish(false, Object.assign(new Error('Loading took too long. Please retry.'), { name: 'TimeoutError' }));
        }, milliseconds);
        void Promise.resolve().then(() => {
          if (retired) throw cancelled();
          return start();
        }).then(value => finish(true, value), error => finish(false, error));
      });
    },
    cancel() {
      if (retired) return;
      retired = true;
      controller.abort();
      cancelWait?.();
    },
  };
}
