import { IVideoFrameMetaInfo, MetaInfoKey } from '../AgoraMediaBase';
import { IVideoFrameMetaInfoImpl } from '../impl/AgoraMediaBaseImpl';
export declare class VideoFrameMetaInfoInternal extends IVideoFrameMetaInfoImpl {
    private _videoFrameMetaInfo;
    constructor(videoFrameMetaInfo: IVideoFrameMetaInfo | undefined);
    getMetaInfoStr(key: MetaInfoKey): string;
}
//# sourceMappingURL=AgoraMediaBaseInternal.d.ts.map