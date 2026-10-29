/* Readable application code for the bundled Camera Kit 1.20.0 engine.
 * Regenerate the HTML with: node tools/camera-kit/sync-runtime.cjs
 * SDK contract: https://developers.snap.com/camera-kit/integrate-sdk/web/web-configuration
 */
function installPlatinumCameraKit(bootstrapCameraKit, createMediaStreamSource) {
  const live = document.getElementById('live');
  let kit = null, session = null, stream = null, facing = 'user', generation = 0;
  let recording = null, captureBusy = false, cameraBusy = false;
  let lensRevision = 0, lensChanging = false, lensApplication = Promise.resolve();
  const send = message => window.ReactNativeWebView?.postMessage(JSON.stringify(message));
  const error = (operation, failure, requestId) => send({ type: 'error', operation, requestId, message: failure?.message || String(failure) });
  const stopTracks = media => media?.getTracks().forEach(track => track.stop());
  const waitFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const requireSession = () => { if (!session || !stream) throw new Error('The Lens camera is not ready.'); return session; };
  async function changeCamera(nextFacing, current) {
    if (cameraBusy) throw new Error('The camera is already switching.');
    cameraBusy = true;
    const previous = stream; stream = null; stopTracks(previous);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacing, width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
      if (current !== generation) { stopTracks(media); throw new Error('The Lens camera was closed.'); }
      stream = media;
      await session.setSource(createMediaStreamSource(media, { cameraType: nextFacing === 'user' ? 'front' : 'back' }));
      await session.play('live'); facing = nextFacing;
    } catch (failure) { stopTracks(stream); stream = null; throw failure; }
    finally { cameraBusy = false; }
  }
  async function loadGroup(groupId) {
    if (!kit) throw new Error('The Lens camera is not ready.');
    const current = generation, { lenses } = await kit.lensRepository.loadLensGroups([groupId]);
    if (current === generation) send({ type: 'lenses', groupId, lenses: (lenses || []).map(lens => ({ id: lens.id, groupId: lens.groupId, name: lens.name, iconUrl: lens.iconUrl || null })) });
  }
  async function init(message) {
    dispose(); const current = generation;
    const createdKit = await bootstrapCameraKit({ apiToken: message.apiToken });
    if (current !== generation) return;
    kit = createdKit;
    const created = await kit.createSession({ liveRenderTarget: live });
    if (current !== generation) { await created.destroy?.(); return; }
    session = created;
    session.events.addEventListener('error', event => { if (current === generation) error('render', event?.detail?.error || new Error('The Lens stopped rendering.')); });
    await changeCamera(message.facing || 'user', current);
    if (current !== generation) return;
    send({ type: 'ready' });
    if (message.lensGroupId) { try { await loadGroup(message.lensGroupId); } catch (failure) { error('loadGroup', failure); } }
  }
  async function photo(requestId) {
    if (captureBusy || recording || cameraBusy || lensChanging) throw new Error('Wait for the camera to finish updating before capturing.');
    const currentSession = requireSession(), current = generation; captureBusy = true;
    try {
      await currentSession.play('capture'); await waitFrame();
      if (current !== generation) return;
      // Use the SDK's actual capture output. A separate DOM canvas is not rendered by Camera Kit.
      const output = currentSession.output.capture;
      if (!output?.width || !output?.height) throw new Error('The Lens has not produced a frame. Try again.');
      const snapshot = document.createElement('canvas'); snapshot.width = output.width; snapshot.height = output.height;
      const context = snapshot.getContext('2d'); if (!context) throw new Error('The device could not save this photo.');
      context.drawImage(output, 0, 0);
      const dataUrl = snapshot.toDataURL('image/jpeg', .96);
      if (!dataUrl.startsWith('data:image/jpeg;base64,') || dataUrl.length < 100) throw new Error('The Lens returned an empty photo.');
      send({ type: 'photo', requestId, dataUrl });
    } finally { captureBusy = false; try { await currentSession.pause('capture'); } catch {} }
  }
  async function startVideo() {
    if (captureBusy || recording || cameraBusy || lensChanging) throw new Error('Wait for the camera to finish updating before capturing.');
    if (typeof MediaRecorder === 'undefined') throw new Error('Lens video recording is unavailable on this device. You can still take a photo.');
    const currentSession = requireSession(), current = generation;
    const state = { recorder: null, captureStream: null, microphone: null, chunks: [], stopId: null, stopRequested: false, timer: null, discard: false, current };
    recording = state;
    try {
      state.microphone = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      if (current !== generation || state.discard) { stopTracks(state.microphone); return; }
      await currentSession.play('capture'); await waitFrame();
      if (current !== generation || state.discard) return;
      const output = currentSession.output.capture;
      if (!output?.width || !output?.height || !output.captureStream) throw new Error('The device cannot record this Lens.');
      const captured = output.captureStream(30); state.captureStream = captured;
      const microphone = state.microphone.getAudioTracks()[0]; if (microphone) captured.addTrack(microphone);
      const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('This device has no supported Lens video format.');
      const recorder = new MediaRecorder(captured, { mimeType: mime, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 }); state.recorder = recorder;
      recorder.ondataavailable = event => { if (event.data?.size) state.chunks.push(event.data); };
      recorder.onerror = event => { error('record', event.error || new Error('Recording failed.'), state.stopId); state.discard = true; cleanupRecording(state, currentSession); };
      recorder.onstop = async () => {
        try {
          if (state.discard || current !== generation) return;
          if (!state.stopId) throw new Error('Recording ended before it could be saved. Please try again.');
          const blob = new Blob(state.chunks, { type: recorder.mimeType || mime });
          if (!blob.size) throw new Error('No video was captured. Please try again.');
          if (blob.size > 95 * 1024 * 1024) throw new Error('This recording is too large. Please try a shorter clip.');
          const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('The recording could not be saved.')); reader.onabort = reader.onerror; reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
          if (!state.discard && current === generation) send({ type: 'video', requestId: state.stopId, dataUrl, mime: blob.type });
        } catch (failure) { error('stopVideo', failure, state.stopId); }
        finally { cleanupRecording(state, currentSession); }
      };
      recorder.start(500); send({ type: 'recording', state: 'started' });
      // Native UI normally stops at 60s; this is a final cleanup guard, not another saved clip.
      state.timer = setTimeout(() => { if (recording === state) { error('record', new Error('Recording reached its time limit. Please capture again.'), state.stopId); state.discard = true; cleanupRecording(state, currentSession); } }, 65000);
      if (state.stopRequested) recorder.stop();
    } catch (failure) { cleanupRecording(state, currentSession); error('startVideo', failure, state.stopId); }
  }
  function cleanupRecording(state, currentSession) {
    clearTimeout(state.timer); const recorder = state.recorder;
    if (state.discard && recorder) { recorder.onstop = null; recorder.onerror = null; recorder.ondataavailable = null; if (recorder.state !== 'inactive') { try { recorder.stop(); } catch {} } }
    stopTracks(state.captureStream); stopTracks(state.microphone); state.chunks = [];
    if (recording === state) recording = null;
    Promise.resolve(currentSession?.pause('capture')).catch(() => {});
  }
  function stopVideo(requestId) {
    if (!recording) throw new Error('No Lens video is recording. Please try again.');
    if (recording.stopId) throw new Error('The recording is already being saved.');
    recording.stopId = requestId; recording.stopRequested = true;
    if (recording.recorder?.state === 'recording') recording.recorder.stop();
  }
  function dispose() {
    generation++; captureBusy = false;
    lensRevision++; lensChanging = false; lensApplication = Promise.resolve();
    if (recording) { recording.discard = true; cleanupRecording(recording, session); }
    stopTracks(stream); stream = null;
    if (session) { Promise.resolve(session.destroy?.()).catch(() => {}); session = null; }
    kit = null;
  }
  async function changeLens(message) {
    const currentSession = requireSession(), current = generation;
    if (recording || captureBusy || cameraBusy) throw new Error('Finish the current capture or camera update before changing Lenses.');
    const revision = ++lensRevision;
    lensChanging = true;
    let release;
    const active = () => current === generation && revision === lensRevision && session === currentSession;
    try {
      const lens = message.lensId ? await kit.lensRepository.loadLens(message.lensId, message.groupId) : null;
      if (!active()) return;
      // Loads may finish out of order. Serialize SDK mutations so an older
      // in-flight apply cannot finish after the newest selection.
      const previous = lensApplication;
      lensApplication = new Promise(resolve => { release = resolve; });
      await previous;
      if (!active()) return;
      const applied = lens ? await currentSession.applyLens(lens) : (await currentSession.removeLens(), false);
      if (active()) send({ type: 'lensApplied', lensId: applied ? message.lensId : null });
    } catch (failure) { if (active()) throw failure; }
    finally { release?.(); if (active()) lensChanging = false; }
  }
  async function receive(event) {
    let message; try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
    if (!message || typeof message.type !== 'string') return;
    try {
      if (message.type === 'init') await init(message);
      else if (message.type === 'dispose') dispose();
      else if (message.type === 'loadGroup') await loadGroup(message.groupId);
      else if (message.type === 'flip') { if (recording || captureBusy || lensChanging) throw new Error('Finish the current capture or Lens update before switching cameras.'); requireSession(); const current = generation; await changeCamera(facing === 'user' ? 'environment' : 'user', current); if (current === generation) send({ type: 'flipped', facing }); }
      else if (message.type === 'applyLens') await changeLens(message);
      else if (message.type === 'capturePhoto') await photo(message.requestId);
      else if (message.type === 'startVideo') await startVideo();
      else if (message.type === 'stopVideo') stopVideo(message.requestId);
    } catch (failure) { error(message.type, failure, message.requestId); }
  }
  window.addEventListener('message', receive);
  document.addEventListener('message', receive);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { error('dispose', new Error('The Lens camera was interrupted. Reopen it to continue.')); dispose(); } });
  window.addEventListener('pagehide', dispose);
}
installPlatinumCameraKit(qc, si);
