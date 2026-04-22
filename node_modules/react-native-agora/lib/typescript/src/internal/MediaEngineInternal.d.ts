import { IAudioFrameObserver, IFaceInfoObserver, IVideoEncodedFrameObserver, IVideoFrameObserver } from '../AgoraMediaBase';
import { IMediaEngineEvent } from '../extension/IAgoraMediaEngineExtension';
import { IMediaEngineImpl } from '../impl/IAgoraMediaEngineImpl';
export declare class MediaEngineInternal extends IMediaEngineImpl {
    static _audio_frame_observers: IAudioFrameObserver[];
    static _video_frame_observers: IVideoFrameObserver[];
    static _video_encoded_frame_observers: IVideoEncodedFrameObserver[];
    static _face_info_observers: IFaceInfoObserver[];
    registerAudioFrameObserver(observer: IAudioFrameObserver): number;
    unregisterAudioFrameObserver(observer: IAudioFrameObserver): number;
    registerVideoFrameObserver(observer: IVideoFrameObserver): number;
    unregisterVideoFrameObserver(observer: IVideoFrameObserver): number;
    registerVideoEncodedFrameObserver(observer: IVideoEncodedFrameObserver): number;
    unregisterVideoEncodedFrameObserver(observer: IVideoEncodedFrameObserver): number;
    registerFaceInfoObserver(observer: IFaceInfoObserver): number;
    unregisterFaceInfoObserver(observer: IFaceInfoObserver): number;
    release(): void;
    _addListenerPreCheck<EventType extends keyof IMediaEngineEvent>(eventType: EventType): boolean;
    addListener<EventType extends keyof IMediaEngineEvent>(eventType: EventType, listener: IMediaEngineEvent[EventType]): void;
    removeListener<EventType extends keyof IMediaEngineEvent>(eventType: EventType, listener?: IMediaEngineEvent[EventType]): void;
    removeAllListeners<EventType extends keyof IMediaEngineEvent>(eventType?: EventType): void;
}
//# sourceMappingURL=MediaEngineInternal.d.ts.map