import { IAudioFrameObserver, IAudioFrameObserverBase, IAudioPcmFrameSink, IAudioSpectrumObserver, IFaceInfoObserver, IMediaRecorderObserver, IVideoEncodedFrameObserver, IVideoFrameMetaInfo, IVideoFrameObserver, MetaInfoKey } from '../AgoraMediaBase';
export declare class IVideoFrameMetaInfoImpl implements IVideoFrameMetaInfo {
    getMetaInfoStr(key: MetaInfoKey): string;
    protected getApiTypeFromGetMetaInfoStr(key: MetaInfoKey): string;
}
export declare function processIAudioPcmFrameSink(handler: IAudioPcmFrameSink, event: string, jsonParams: any): void;
export declare function processIAudioFrameObserverBase(handler: IAudioFrameObserverBase, event: string, jsonParams: any): void;
export declare function processIAudioFrameObserver(handler: IAudioFrameObserver, event: string, jsonParams: any): void;
export declare function processIAudioSpectrumObserver(handler: IAudioSpectrumObserver, event: string, jsonParams: any): void;
export declare function processIVideoEncodedFrameObserver(handler: IVideoEncodedFrameObserver, event: string, jsonParams: any): void;
export declare function processIVideoFrameObserver(handler: IVideoFrameObserver, event: string, jsonParams: any): void;
export declare function processIFaceInfoObserver(handler: IFaceInfoObserver, event: string, jsonParams: any): void;
export declare function processIMediaRecorderObserver(handler: IMediaRecorderObserver, event: string, jsonParams: any): void;
//# sourceMappingURL=AgoraMediaBaseImpl.d.ts.map