import type { HostComponent, ViewProps } from 'react-native';
export interface NativeProps extends ViewProps {
    callApi: {
        funcName: string;
        params: string;
        buffers?: string[];
    };
}
declare const _default: HostComponent<NativeProps>;
export default _default;
//# sourceMappingURL=AgoraRtcTextureViewNativeComponent.d.ts.map