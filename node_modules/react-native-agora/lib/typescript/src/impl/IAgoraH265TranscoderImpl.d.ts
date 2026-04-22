import { IH265Transcoder, IH265TranscoderObserver } from '../IAgoraH265Transcoder';
export declare function processIH265TranscoderObserver(handler: IH265TranscoderObserver, event: string, jsonParams: any): void;
export declare class IH265TranscoderImpl implements IH265Transcoder {
    enableTranscode(token: string, channel: string, uid: number): number;
    protected getApiTypeFromEnableTranscode(token: string, channel: string, uid: number): string;
    queryChannel(token: string, channel: string, uid: number): number;
    protected getApiTypeFromQueryChannel(token: string, channel: string, uid: number): string;
    triggerTranscode(token: string, channel: string, uid: number): number;
    protected getApiTypeFromTriggerTranscode(token: string, channel: string, uid: number): string;
    registerTranscoderObserver(observer: IH265TranscoderObserver): number;
    protected getApiTypeFromRegisterTranscoderObserver(observer: IH265TranscoderObserver): string;
    unregisterTranscoderObserver(observer: IH265TranscoderObserver): number;
    protected getApiTypeFromUnregisterTranscoderObserver(observer: IH265TranscoderObserver): string;
}
//# sourceMappingURL=IAgoraH265TranscoderImpl.d.ts.map