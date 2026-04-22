export function processIAudioEncodedFrameObserver(handler, event, jsonParams) {
  switch (event) {
    case 'onRecordAudioEncodedFrame':
      if (handler.onRecordAudioEncodedFrame !== undefined) {
        handler.onRecordAudioEncodedFrame(jsonParams.frameBuffer, jsonParams.length, jsonParams.audioEncodedFrameInfo);
      }
      break;
    case 'onPlaybackAudioEncodedFrame':
      if (handler.onPlaybackAudioEncodedFrame !== undefined) {
        handler.onPlaybackAudioEncodedFrame(jsonParams.frameBuffer, jsonParams.length, jsonParams.audioEncodedFrameInfo);
      }
      break;
    case 'onMixedAudioEncodedFrame':
      if (handler.onMixedAudioEncodedFrame !== undefined) {
        handler.onMixedAudioEncodedFrame(jsonParams.frameBuffer, jsonParams.length, jsonParams.audioEncodedFrameInfo);
      }
      break;
  }
}
//# sourceMappingURL=AgoraBaseImpl.js.map