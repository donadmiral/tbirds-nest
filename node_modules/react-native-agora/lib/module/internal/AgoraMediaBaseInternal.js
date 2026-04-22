import { IVideoFrameMetaInfoImpl } from '../impl/AgoraMediaBaseImpl';
export class VideoFrameMetaInfoInternal extends IVideoFrameMetaInfoImpl {
  constructor(videoFrameMetaInfo) {
    super();
    this._videoFrameMetaInfo = videoFrameMetaInfo;
  }
  getMetaInfoStr(key) {
    var _this$_videoFrameMeta;
    // @ts-ignore
    return (_this$_videoFrameMeta = this._videoFrameMetaInfo) === null || _this$_videoFrameMeta === void 0 ? void 0 : _this$_videoFrameMeta[key];
  }
}
//# sourceMappingURL=AgoraMediaBaseInternal.js.map