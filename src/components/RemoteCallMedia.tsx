import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { DailyMediaView, type DailyParticipant, type MediaStreamTrack } from '@daily-co/react-native-daily-js';

type TrackKind = 'video' | 'audio' | 'screenVideo' | 'screenAudio';

// A persistent track can outlive a stopped or blocked share. Only show a track
// that Daily currently marks playable, so stale frames cannot remain on screen.
export function playableCallTrack(participant: DailyParticipant, kind: TrackKind): MediaStreamTrack | null {
  const track = participant.tracks?.[kind];
  if (track) return track.state === 'playable' ? track.track ?? track.persistentTrack ?? null : null;
  const legacy = participant[`${kind}Track` as 'videoTrack'];
  return legacy || null;
}

export function hasRemoteScreenShare(participants: DailyParticipant[]): boolean {
  return participants.some(participant => !!playableCallTrack(participant, 'screenVideo'));
}

export function RemoteCallMedia({ participants }: { participants: DailyParticipant[] }) {
  const [selection, setSelection] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const shares = participants.filter(participant => !!playableCallTrack(participant, 'screenVideo'));
  const screen = selection === 'cameras' ? null
    : shares.find(participant => participant.session_id === selection) ?? shares[0] ?? null;
  const pageCount = Math.max(1, Math.ceil(participants.length / 4));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = participants.slice(currentPage * 4, currentPage * 4 + 4);

  return (
    <View style={s.root}>
      {/* Keep microphone playback independent of the selected screen/grid page. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.audio}>
        {participants.map(participant => (
          <DailyMediaView key={participant.session_id} videoTrack={null}
            audioTrack={playableCallTrack(participant, 'audio')} style={s.audio} />
        ))}
      </View>
      {shares.length > 0 && (
        <ScrollView horizontal style={s.tabs} contentContainerStyle={s.tabContent} showsHorizontalScrollIndicator={false}>
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
        <DailyMediaView key={`screen:${screen.session_id}`} videoTrack={playableCallTrack(screen, 'screenVideo')}
          audioTrack={playableCallTrack(screen, 'screenAudio')} mirror={false} zOrder={0}
          objectFit="contain" style={s.screen} />
      ) : (
        <>
          <View style={s.grid}>
            {visible.map(participant => (
              <View key={participant.session_id} style={[s.tile, {
                width: visible.length === 1 ? '100%' : '50%',
                height: visible.length <= 2 ? '100%' : '50%',
              }]}>
                <DailyMediaView videoTrack={playableCallTrack(participant, 'video')} audioTrack={null}
                  mirror={false} zOrder={0} objectFit="cover" style={s.camera} />
                <Text numberOfLines={1} style={s.name}>{participant.user_name || 'Participant'}</Text>
              </View>
            ))}
          </View>
          {pageCount > 1 && (
            <View style={s.pager}>
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
  root: { flex: 1, backgroundColor: '#000' },
  audio: { position: 'absolute', width: 1, height: 1 },
  tabs: { flexGrow: 0, flexShrink: 0, maxHeight: 60 },
  tabContent: { alignItems: 'center', gap: 8, padding: 8 },
  tab: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12, backgroundColor: '#1b1b1b' },
  selectedTab: { backgroundColor: '#35404f' },
  tabText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  screen: { flex: 1, width: '100%' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  tile: { backgroundColor: '#111' },
  camera: { flex: 1 },
  name: { position: 'absolute', bottom: 8, left: 8, right: 8, color: '#fff', fontSize: 13, backgroundColor: 'rgba(0,0,0,0.6)', padding: 4 },
  pager: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  disabled: { opacity: 0.4 },
});
