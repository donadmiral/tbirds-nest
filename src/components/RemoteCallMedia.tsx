import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { DailyMediaView, type DailyParticipant, type MediaStreamTrack } from '@daily-co/react-native-daily-js';

type TrackKind = 'video' | 'audio' | 'screenVideo' | 'screenAudio';

// A persistent track can outlive a stopped or blocked share. Only show a track
// that Daily currently marks playable, so stale frames cannot remain on screen.
export function playableCallTrack(participant: DailyParticipant, kind: TrackKind): MediaStreamTrack | null {
  const track = participant.tracks?.[kind];
  const current = track ? track.state === 'playable' ? track.track ?? track.persistentTrack ?? null : null
    : participant[`${kind}Track` as 'videoTrack'] || null;
  return current && current.readyState !== 'ended' && current.enabled !== false ? current : null;
}

// The preview includes the local camera, but must never play its own microphone
// or captured screen audio back into the local speakers.
export function audibleCallTrack(participant: DailyParticipant, kind: 'audio' | 'screenAudio'): MediaStreamTrack | null {
  return participant.local ? null : playableCallTrack(participant, kind);
}

export function hasRemoteScreenShare(participants: DailyParticipant[]): boolean {
  return participants.some(participant => !!playableCallTrack(participant, 'screenVideo'));
}

type Props = {
  participants: DailyParticipant[];
  presentation?: 'call' | 'immersive';
  /** Position labels and shared-screen content clear of the Live chrome. */
  contentInsets?: { top?: number; bottom?: number };
};

export function RemoteCallMedia({ participants, presentation = 'call', contentInsets }: Props) {
  const [selection, setSelection] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [fittedCameras, setFittedCameras] = useState<Record<string, boolean>>({});
  const immersive = presentation === 'immersive';
  const landscape = stageSize.width > stageSize.height;
  const topInset = Math.max(0, contentInsets?.top ?? 0);
  const bottomInset = Math.max(0, contentInsets?.bottom ?? 0);
  const shares = participants.filter(participant => !!playableCallTrack(participant, 'screenVideo'));
  const screen = selection === 'cameras' ? null
    : shares.find(participant => participant.session_id === selection) ?? shares[0] ?? null;
  const pageCount = Math.max(1, Math.ceil(participants.length / 4));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = participants.slice(currentPage * 4, currentPage * 4 + 4);

  return (
    <View testID={immersive ? 'live-native-stage' : undefined} style={s.root}
      onLayout={event => { const { width, height } = event.nativeEvent.layout;
        setStageSize(current => current.width === width && current.height === height ? current : { width, height }); }}>
      {/* Keep microphone playback independent of the selected screen/grid page. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.audio}>
        {participants.map(participant => (
          <DailyMediaView key={participant.session_id} videoTrack={null}
            audioTrack={audibleCallTrack(participant, 'audio')} style={s.audio} />
        ))}
      </View>
      {shares.length > 0 && (
        <ScrollView horizontal style={[s.tabs, immersive && s.floatingTabs, immersive && { top: topInset }]}
          contentContainerStyle={s.tabContent} showsHorizontalScrollIndicator={false}>
          {shares.map(participant => (
            <TouchableOpacity key={participant.session_id} accessibilityRole="button"
              accessibilityLabel={`View ${participant.user_name || 'Participant'}'s screen`}
              accessibilityState={{ selected: screen?.session_id === participant.session_id }}
              style={[s.tab, screen?.session_id === participant.session_id && s.selectedTab]}
              onPress={() => setSelection(participant.session_id)}>
              <Text style={s.tabText}>{participant.user_name || 'Participant'}'s screen</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="View cameras"
            accessibilityState={{ selected: !screen }} style={[s.tab, !screen && s.selectedTab]}
            onPress={() => setSelection('cameras')}>
            <Text style={s.tabText}>Cameras</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
      {screen ? (
        <View style={[s.screen, immersive && { paddingTop: topInset + 60, paddingBottom: bottomInset }]}>
          <DailyMediaView key={`screen:${screen.session_id}:${playableCallTrack(screen, 'screenVideo')?.id}`}
            videoTrack={playableCallTrack(screen, 'screenVideo')}
            audioTrack={audibleCallTrack(screen, 'screenAudio')} mirror={false} zOrder={0}
            objectFit="contain" style={s.screen} />
        </View>
      ) : (
        <>
          <View testID={immersive ? 'live-native-camera-grid' : undefined} style={s.grid}>
            {visible.length === 0 ? <View style={s.empty}><Text style={s.tabText}>Waiting for participants</Text></View> : null}
            {visible.map((participant, index) => {
              const video = playableCallTrack(participant, 'video');
              const name = participant.user_name || (participant.local ? 'You' : 'Participant');
              const splitPortrait = immersive && !landscape && visible.length === 2;
              const labelBottom = immersive && visible.length === 1
                ? Math.min(Math.max(8, bottomInset), stageSize.height ? Math.max(8, stageSize.height - topInset - 52) : Infinity) : 8;
              const rowCount = splitPortrait || visible.length > 2 ? 2 : 1;
              const firstRow = rowCount === 1 || index < (splitPortrait ? 1 : 2);
              // Every camera fills its share of the whole viewport. Move badges
              // within their tiles instead of cutting the grid down to a card.
              const labelTop = firstRow ? topInset + (shares.length ? 60 : 0) + (pageCount > 1 ? 60 : 0) + 8 : 8;
              const identityPosition = immersive && visible.length > 1
                ? { top: Math.min(labelTop, stageSize.height ? Math.max(8, stageSize.height / rowCount - 52) : Infinity) }
                : { bottom: labelBottom };
              let mirror = false;
              // Respect the native track orientation. Only the local front camera
              // is mirrored, never a guest camera or a shared screen.
              try { mirror = immersive && !!participant.local && video?.getSettings?.().facingMode === 'user'; } catch {}
              const fitted = fittedCameras[participant.session_id] === true;
              return <View key={participant.session_id} testID={`live-camera-${participant.session_id}`} style={[s.tile, {
                width: visible.length === 1 || splitPortrait || (immersive && visible.length === 3 && index === 2) ? '100%' : '50%',
                height: splitPortrait || visible.length > 2 ? '50%' : '100%',
              }]}>
                {video ? <DailyMediaView key={`camera:${participant.session_id}:${video.id}`} videoTrack={video} audioTrack={null}
                  mirror={mirror} zOrder={0} objectFit={fitted ? 'contain' : 'cover'} style={s.camera} />
                  : <View style={s.empty}><Text style={s.initial}>{name.slice(0, 1).toUpperCase()}</Text>
                    <Text style={s.tabText}>{participant.tracks?.video?.state === 'loading' ? 'Connecting camera…' : 'Camera off'}</Text></View>}
                <View pointerEvents="box-none" style={[s.identity, identityPosition]}>
                  <Text numberOfLines={1} style={s.name}>{name}{!playableCallTrack(participant, 'audio') ? ' · Muted' : ''}</Text>
                  {immersive && video ? <TouchableOpacity accessibilityRole="button"
                    accessibilityLabel={`${fitted ? 'Fill' : 'Fit'} ${name}'s camera`}
                    accessibilityHint={fitted ? 'Fill the tile with the camera image' : 'Show the entire camera image without cropping'}
                    onPress={() => setFittedCameras(current => ({ ...current, [participant.session_id]: !fitted }))} style={s.fitButton}>
                    <Text style={s.tabText}>{fitted ? 'Fill' : 'Fit'}</Text>
                  </TouchableOpacity> : null}
                </View>
              </View>;
            })}
          </View>
          {pageCount > 1 && (
            <View style={[s.pager, immersive && s.floatingPager, immersive && { top: topInset + (shares.length ? 60 : 0) }]}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous participants"
                accessibilityState={{ disabled: currentPage === 0 }} disabled={currentPage === 0}
                style={[s.tab, currentPage === 0 && s.disabled]} onPress={() => setPage(currentPage - 1)}>
                <Text style={s.tabText}>Previous</Text>
              </TouchableOpacity>
              <Text accessibilityLiveRegion="polite" style={s.tabText}>{currentPage + 1} / {pageCount}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next participants"
                accessibilityState={{ disabled: currentPage === pageCount - 1 }} disabled={currentPage === pageCount - 1}
                style={[s.tab, currentPage === pageCount - 1 && s.disabled]} onPress={() => setPage(currentPage + 1)}>
                <Text style={s.tabText}>Next</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: '#000', overflow: 'hidden' },
  audio: { position: 'absolute', width: 1, height: 1 },
  tabs: { flexGrow: 0, flexShrink: 0, maxHeight: 60 },
  floatingTabs: { position: 'absolute', left: 0, right: 0, zIndex: 2 },
  tabContent: { alignItems: 'center', gap: 8, padding: 8 },
  tab: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12, backgroundColor: '#1b1b1b' },
  selectedTab: { backgroundColor: '#35404f' },
  tabText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  screen: { flex: 1, width: '100%' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  tile: { backgroundColor: '#111', overflow: 'hidden' },
  camera: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%' },
  initial: { color: '#fff', fontSize: 44, fontWeight: '600' },
  identity: { position: 'absolute', left: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flex: 1, color: '#fff', fontSize: 13, backgroundColor: 'rgba(0,0,0,0.72)', padding: 6, borderRadius: 5 },
  fitButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.72)' },
  pager: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  floatingPager: { position: 'absolute', left: 0, right: 0, zIndex: 2 },
  disabled: { opacity: 0.4 },
});
