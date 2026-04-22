import { IAudioPcmFrameSink, IAudioSpectrumObserver, RawAudioFrameOpModeType } from '../AgoraMediaBase';
import { IMediaPlayerVideoFrameObserver } from '../IAgoraMediaPlayer';
import { IMediaPlayerSourceObserver } from '../IAgoraMediaPlayerSource';
import { IMediaPlayerEvent } from '../extension/IAgoraMediaPlayerExtension';
import { IMediaPlayerImpl } from '../impl/IAgoraMediaPlayerImpl';
export declare class MediaPlayerInternal extends IMediaPlayerImpl {
    static _source_observers: Map<number, IMediaPlayerSourceObserver[]>;
    static _audio_frame_observers: Map<number, IAudioPcmFrameSink[]>;
    static _video_frame_observers: Map<number, IMediaPlayerVideoFrameObserver[]>;
    static _audio_spectrum_observers: Map<number, IAudioSpectrumObserver[]>;
    private readonly _mediaPlayerId;
    constructor(mediaPlayerId: number);
    release(): void;
    _addListenerPreCheck<EventType extends keyof IMediaPlayerEvent>(eventType: EventType): boolean;
    addListener<EventType extends keyof IMediaPlayerEvent>(eventType: EventType, listener: IMediaPlayerEvent[EventType]): void;
    removeListener<EventType extends keyof IMediaPlayerEvent>(eventType: EventType, listener?: IMediaPlayerEvent[EventType]): void;
    removeAllListeners<EventType extends keyof IMediaPlayerEvent>(eventType?: EventType): void;
    getMediaPlayerId(): number;
    registerPlayerSourceObserver(observer: IMediaPlayerSourceObserver): number;
    unregisterPlayerSourceObserver(observer: IMediaPlayerSourceObserver): number;
    registerAudioFrameObserver(observer: IAudioPcmFrameSink, mode?: RawAudioFrameOpModeType): number;
    unregisterAudioFrameObserver(observer: IAudioPcmFrameSink): number;
    registerVideoFrameObserver(observer: IMediaPlayerVideoFrameObserver): number;
    unregisterVideoFrameObserver(observer: IMediaPlayerVideoFrameObserver): number;
    registerMediaPlayerAudioSpectrumObserver(observer: IAudioSpectrumObserver, intervalInMS: number): number;
    unregisterMediaPlayerAudioSpectrumObserver(observer: IAudioSpectrumObserver): number;
}
//# sourceMappingURL=MediaPlayerInternal.d.ts.map