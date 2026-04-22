import React, { Component } from 'react';
import { HostComponent } from 'react-native';
import { VideoCanvas } from '../AgoraBase';
import { RtcRendererViewProps } from '../AgoraRtcRenderView';
import { RtcConnection } from '../IAgoraRtcEngineEx';
import { IrisApiParam } from './IrisApiEngine';
export declare function getFuncName(canvas: VideoCanvas, connection?: RtcConnection): string;
export declare function getParams(props: RtcRendererViewProps): IrisApiParam;
export default abstract class IAgoraRtcRenderView<T extends RtcRendererViewProps> extends Component<T> {
    abstract get view(): HostComponent<any>;
    render(): React.ReactElement;
}
//# sourceMappingURL=IAgoraRtcRenderView.d.ts.map