import { AgoraPip, AgoraPipOptions, AgoraPipStateChangedObserver } from '../IAgoraPip';
import { IAgoraPipEvent } from '../extension/IAgoraPipExtension';
export declare function processAgoraPipObserver(handler: AgoraPipStateChangedObserver, event: string, jsonParams: any): void;
export declare class AgoraPipInternal implements AgoraPip {
    static _agora_pip_observers: AgoraPipStateChangedObserver[];
    pipIsSupported(): boolean;
    pipIsAutoEnterSupported(): boolean;
    isPipActivated(): boolean;
    pipSetup(options: AgoraPipOptions): boolean;
    pipStart(): boolean;
    pipStop(): void;
    pipDispose(): void;
    release(): void;
    _addListenerPreCheck<EventType extends keyof IAgoraPipEvent>(eventType: EventType): boolean;
    addListener<EventType extends keyof IAgoraPipEvent>(eventType: EventType, listener: IAgoraPipEvent[EventType]): void;
    removeListener<EventType extends keyof IAgoraPipEvent>(eventType: EventType, listener?: IAgoraPipEvent[EventType]): void;
    removeAllListeners<EventType extends keyof IAgoraPipEvent>(eventType?: EventType): void;
    registerPipStateChangedObserver(observer: AgoraPipStateChangedObserver): void;
    unregisterPipStateChangedObserver(observer: AgoraPipStateChangedObserver): void;
}
//# sourceMappingURL=AgoraPipInternal.d.ts.map