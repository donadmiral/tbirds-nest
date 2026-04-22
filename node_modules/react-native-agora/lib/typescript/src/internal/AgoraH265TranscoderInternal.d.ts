import { IH265TranscoderObserver } from '../IAgoraH265Transcoder';
import { IH265TranscoderEvent } from '../extension/IAgoraH265TranscoderExtension';
import { IH265TranscoderImpl } from '../impl/IAgoraH265TranscoderImpl';
export declare class H265TranscoderInternal extends IH265TranscoderImpl {
    static _h265_transcoder_observers: IH265TranscoderObserver[];
    release(): void;
    _addListenerPreCheck<EventType extends keyof IH265TranscoderEvent>(eventType: EventType): boolean;
    addListener<EventType extends keyof IH265TranscoderEvent>(eventType: EventType, listener: IH265TranscoderEvent[EventType]): void;
    removeListener<EventType extends keyof IH265TranscoderEvent>(eventType: EventType, listener?: IH265TranscoderEvent[EventType]): void;
    removeAllListeners<EventType extends keyof IH265TranscoderEvent>(eventType?: EventType): void;
    registerTranscoderObserver(observer: IH265TranscoderObserver): number;
    unregisterTranscoderObserver(observer: IH265TranscoderObserver): number;
}
//# sourceMappingURL=AgoraH265TranscoderInternal.d.ts.map