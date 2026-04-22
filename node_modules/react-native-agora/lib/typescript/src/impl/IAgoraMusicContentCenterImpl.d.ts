import { IMusicContentCenter, IMusicContentCenterEventHandler, IMusicPlayer, Music, MusicCacheInfo, MusicChartCollection, MusicChartInfo, MusicCollection, MusicContentCenterConfiguration, MusicPlayMode } from '../IAgoraMusicContentCenter';
import { IMediaPlayerImpl } from './IAgoraMediaPlayerImpl';
export declare class MusicChartCollectionImpl implements MusicChartCollection {
    getCount(): number;
    protected getApiTypeFromGetCount(): string;
    get(index: number): MusicChartInfo;
    protected getApiTypeFromGet(index: number): string;
}
export declare class MusicCollectionImpl implements MusicCollection {
    getCount(): number;
    protected getApiTypeFromGetCount(): string;
    getTotal(): number;
    protected getApiTypeFromGetTotal(): string;
    getPage(): number;
    protected getApiTypeFromGetPage(): string;
    getPageSize(): number;
    protected getApiTypeFromGetPageSize(): string;
    getMusic(index: number): Music;
    protected getApiTypeFromGetMusic(index: number): string;
}
export declare function processIMusicContentCenterEventHandler(handler: IMusicContentCenterEventHandler, event: string, jsonParams: any): void;
export declare class IMusicPlayerImpl extends IMediaPlayerImpl implements IMusicPlayer {
    setPlayMode(mode: MusicPlayMode): number;
    protected getApiTypeFromSetPlayMode(mode: MusicPlayMode): string;
    openWithSongCode(songCode: number, startPos?: number): number;
    protected getApiTypeFromOpenWithSongCode(songCode: number, startPos?: number): string;
}
export declare class IMusicContentCenterImpl implements IMusicContentCenter {
    initialize(configuration: MusicContentCenterConfiguration): number;
    protected getApiTypeFromInitialize(configuration: MusicContentCenterConfiguration): string;
    renewToken(token: string): number;
    protected getApiTypeFromRenewToken(token: string): string;
    release(): void;
    protected getApiTypeFromRelease(): string;
    registerEventHandler(eventHandler: IMusicContentCenterEventHandler): number;
    protected getApiTypeFromRegisterEventHandler(eventHandler: IMusicContentCenterEventHandler): string;
    unregisterEventHandler(): number;
    protected getApiTypeFromUnregisterEventHandler(): string;
    createMusicPlayer(): IMusicPlayer;
    protected getApiTypeFromCreateMusicPlayer(): string;
    destroyMusicPlayer(musicPlayer: IMusicPlayer): number;
    protected getApiTypeFromDestroyMusicPlayer(musicPlayer: IMusicPlayer): string;
    getMusicCharts(): string;
    protected getApiTypeFromGetMusicCharts(): string;
    getMusicCollectionByMusicChartId(musicChartId: number, page: number, pageSize: number, jsonOption?: string): string;
    protected getApiTypeFromGetMusicCollectionByMusicChartId(musicChartId: number, page: number, pageSize: number, jsonOption?: string): string;
    searchMusic(keyWord: string, page: number, pageSize: number, jsonOption?: string): string;
    protected getApiTypeFromSearchMusic(keyWord: string, page: number, pageSize: number, jsonOption?: string): string;
    preload(songCode: number): string;
    protected getApiTypeFromPreload(songCode: number): string;
    removeCache(songCode: number): number;
    protected getApiTypeFromRemoveCache(songCode: number): string;
    getCaches(): {
        cacheInfo: MusicCacheInfo[];
        cacheInfoSize: number;
    };
    protected getApiTypeFromGetCaches(): string;
    isPreloaded(songCode: number): boolean;
    protected getApiTypeFromIsPreloaded(songCode: number): string;
    getLyric(songCode: number, lyricType?: number): string;
    protected getApiTypeFromGetLyric(songCode: number, lyricType?: number): string;
    getSongSimpleInfo(songCode: number): string;
    protected getApiTypeFromGetSongSimpleInfo(songCode: number): string;
    getInternalSongCode(songCode: number, jsonOption: string): number;
    protected getApiTypeFromGetInternalSongCode(songCode: number, jsonOption: string): string;
}
//# sourceMappingURL=IAgoraMusicContentCenterImpl.d.ts.map