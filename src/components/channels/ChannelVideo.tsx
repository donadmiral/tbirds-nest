import React, { useEffect } from 'react';
import { AppState, type StyleProp, type ViewStyle } from 'react-native';
import { VideoView } from 'expo-video';
import { useAdaptiveVideoPlayer } from '../../lib/useAdaptiveVideoPlayer';

/** Channel attachments keep manual playback and their existing native controls. */
export function ChannelVideo({ source, style, active }: { source: string; style?: StyleProp<ViewStyle>; active: boolean }) {
  const player = useAdaptiveVideoPlayer(source);
  useEffect(() => {
    const pause = () => { try { player.pause(); } catch {} };
    if (!active) pause();
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') pause(); });
    const playing = player.addListener('playingChange', event => { if (event.isPlaying && (!active || AppState.currentState !== 'active')) pause(); });
    return () => { listener.remove(); playing.remove(); pause(); };
  }, [active, player]);
  return <VideoView player={player} style={style} contentFit="contain" nativeControls fullscreenOptions={{ enable: true }} />;
}
