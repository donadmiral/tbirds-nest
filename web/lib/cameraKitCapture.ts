import { cameraKitCaptureData } from '../../src/screens/stories/cameraKitBridge';

export function browserCameraKitHtml(engine: string, origin: string) {
  const parsed = new URL(origin);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin || !engine.includes('</head>')) throw Error('The Lens camera could not start.');
  const destination = JSON.stringify(origin);
  // srcdoc has the app's effective origin. Accept commands only from its parent,
  // and send results to that exact origin, never to an arbitrary window.
  const bridge = `<script>window.ReactNativeWebView={postMessage:function(value){window.parent.postMessage({platinumCameraKit:value},${destination});}};window.addEventListener('message',function(event){if(event.source!==window.parent||event.origin!==${destination})event.stopImmediatePropagation();},true);</script>`;
  return engine.replace('</head>', bridge + '</head>');
}

export function cameraKitFile(dataUrl: unknown, kind: 'photo' | 'video'): File {
  const { base64, extension } = cameraKitCaptureData(dataUrl, kind);
  const decoded = atob(base64.replace(/\s/g, ''));
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < decoded.length; offset += 32768) {
    const part = decoded.slice(offset, offset + 32768), bytes = new Uint8Array(part.length);
    for (let index = 0; index < part.length; index++) bytes[index] = part.charCodeAt(index);
    parts.push(bytes);
  }
  const type = extension === 'jpg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : `video/${extension}`;
  return new File(parts as BlobPart[], `platinum-lens-${Date.now()}.${extension}`, { type });
}
