import './extension/IAgoraH265TranscoderExtension';
export declare enum H265TranscodeResult {
    H265TranscodeResultUnknown = -1,
    H265TranscodeResultSuccess = 0,
    H265TranscodeResultRequestInvalid = 1,
    H265TranscodeResultUnauthorized = 2,
    H265TranscodeResultTokenExpired = 3,
    H265TranscodeResultForbidden = 4,
    H265TranscodeResultNotFound = 5,
    H265TranscodeResultConflicted = 6,
    H265TranscodeResultNotSupported = 7,
    H265TranscodeResultTooOften = 8,
    H265TranscodeResultServerInternalError = 9,
    H265TranscodeResultServiceUnavailable = 10
}
export interface IH265TranscoderObserver {
    onEnableTranscode?(result: H265TranscodeResult): void;
    onQueryChannel?(result: H265TranscodeResult, originChannel: string, transcodeChannel: string): void;
    onTriggerTranscode?(result: H265TranscodeResult): void;
}
export declare abstract class IH265Transcoder {
    abstract enableTranscode(token: string, channel: string, uid: number): number;
    abstract queryChannel(token: string, channel: string, uid: number): number;
    abstract triggerTranscode(token: string, channel: string, uid: number): number;
    abstract registerTranscoderObserver(observer: IH265TranscoderObserver): number;
    abstract unregisterTranscoderObserver(observer: IH265TranscoderObserver): number;
}
//# sourceMappingURL=IAgoraH265Transcoder.d.ts.map