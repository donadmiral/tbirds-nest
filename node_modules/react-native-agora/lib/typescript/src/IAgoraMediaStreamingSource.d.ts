import './extension/IAgoraMediaStreamingSourceExtension';
export declare enum StreamingSrcErr {
    StreamingSrcErrNone = 0,
    StreamingSrcErrUnknown = 1,
    StreamingSrcErrInvalidParam = 2,
    StreamingSrcErrBadState = 3,
    StreamingSrcErrNoMem = 4,
    StreamingSrcErrBufferOverflow = 5,
    StreamingSrcErrBufferUnderflow = 6,
    StreamingSrcErrNotFound = 7,
    StreamingSrcErrTimeout = 8,
    StreamingSrcErrExpired = 9,
    StreamingSrcErrUnsupported = 10,
    StreamingSrcErrNotExist = 11,
    StreamingSrcErrExist = 12,
    StreamingSrcErrOpen = 13,
    StreamingSrcErrClose = 14,
    StreamingSrcErrRead = 15,
    StreamingSrcErrWrite = 16,
    StreamingSrcErrSeek = 17,
    StreamingSrcErrEof = 18,
    StreamingSrcErrCodecopen = 19,
    StreamingSrcErrCodecclose = 20,
    StreamingSrcErrCodecproc = 21
}
export declare enum StreamingSrcState {
    StreamingSrcStateClosed = 0,
    StreamingSrcStateOpening = 1,
    StreamingSrcStateIdle = 2,
    StreamingSrcStatePlaying = 3,
    StreamingSrcStateSeeking = 4,
    StreamingSrcStateEof = 5,
    StreamingSrcStateError = 6
}
export declare class InputSeiData {
    type?: number;
    timestamp?: number;
    frame_index?: number;
    private_data?: Uint8Array;
    data_size?: number;
}
//# sourceMappingURL=IAgoraMediaStreamingSource.d.ts.map