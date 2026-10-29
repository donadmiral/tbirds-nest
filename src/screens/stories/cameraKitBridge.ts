/** One capture at a time, with request identity carried across the WebView boundary. */
export function createCameraKitCaptureBridge(timeoutMs = 20000) {
  type Pending = { id: string; kind: 'photo' | 'video'; resolve: (uri: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  let pending: Pending | null = null;
  let sequence = 0;
  const fail = (message: string, id?: string) => {
    if (!pending || (id && pending.id !== id)) return;
    const current = pending; pending = null; clearTimeout(current.timer); current.reject(new Error(message));
  };
  return {
    request(kind: Pending['kind'], send: (id: string) => void) {
      if (pending) return Promise.reject(new Error('A capture is already being saved. Please wait.'));
      return new Promise<string>((resolve, reject) => {
        const id = `${Date.now()}-${++sequence}`;
        const timer = setTimeout(() => fail('The camera did not finish saving. Please try again.', id), timeoutMs);
        pending = { id, kind, resolve, reject, timer };
        try { send(id); } catch (error) { fail(error instanceof Error ? error.message : 'The camera is unavailable.', id); }
      });
    },
    async complete(id: string, kind: Pending['kind'], save: () => Promise<string>, discard?: (uri: string) => void) {
      const current = pending;
      if (!current || current.id !== id || current.kind !== kind) return;
      try {
        const uri = await save();
        if (pending !== current) { discard?.(uri); return; }
        pending = null; clearTimeout(current.timer); current.resolve(uri);
      } catch (error) { if (pending === current) fail(error instanceof Error ? error.message : 'The captured file could not be saved.', id); }
    },
    fail,
  };
}

export function cameraKitCaptureData(dataUrl: unknown, kind: 'photo' | 'video') {
  if (typeof dataUrl !== 'string' || dataUrl.length > 130 * 1024 * 1024) throw new Error('The captured file is invalid or too large. Try a shorter clip.');
  const match = /^data:((?:image\/(?:jpeg|png))|(?:video\/(?:mp4|webm)))(?:;codecs=[^;]+)?;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match || (kind === 'photo') !== match[1].startsWith('image/') || match[2].length < 8) throw new Error('The camera returned an empty or unsupported capture. Please try again.');
  return { base64: match[2], extension: match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1] };
}
