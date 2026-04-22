import { IMediaRecorderObserver, MediaRecorderConfiguration } from '../AgoraMediaBase';
import { IMediaRecorder } from '../IAgoraMediaRecorder';
export declare class IMediaRecorderImpl implements IMediaRecorder {
    setMediaRecorderObserver(callback: IMediaRecorderObserver): number;
    protected getApiTypeFromSetMediaRecorderObserver(callback: IMediaRecorderObserver): string;
    startRecording(config: MediaRecorderConfiguration): number;
    protected getApiTypeFromStartRecording(config: MediaRecorderConfiguration): string;
    stopRecording(): number;
    protected getApiTypeFromStopRecording(): string;
}
//# sourceMappingURL=IAgoraMediaRecorderImpl.d.ts.map