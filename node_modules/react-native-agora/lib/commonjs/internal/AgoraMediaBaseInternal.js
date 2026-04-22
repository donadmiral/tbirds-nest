"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.VideoFrameMetaInfoInternal = void 0;
var _AgoraMediaBaseImpl = require("../impl/AgoraMediaBaseImpl");
class VideoFrameMetaInfoInternal extends _AgoraMediaBaseImpl.IVideoFrameMetaInfoImpl {
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
exports.VideoFrameMetaInfoInternal = VideoFrameMetaInfoInternal;
//# sourceMappingURL=AgoraMediaBaseInternal.js.map