import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';

type ComposerTopBarProps = {
  draftCount: number;
  activeIndex: number;
  mediaType: 'image' | 'video';
  durationSec: number | null;
  undoCount: number;
  redoCount: number;
  publishing: boolean;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenTextEditor: () => void;
  opacityAnim: Animated.Value;
  translateYAnim: Animated.Value;
};

export default function ComposerTopBar({
  draftCount,
  activeIndex,
  mediaType,
  durationSec,
  undoCount,
  redoCount,
  publishing,
  onClose,
  onUndo,
  onRedo,
  onOpenTextEditor,
  opacityAnim,
  translateYAnim,
}: ComposerTopBarProps) {
  return (
    <Animated.View
      style={[s.topBar, { opacity: opacityAnim, transform: [{ translateY: translateYAnim }] }]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        onPress={onClose}
        style={s.topIconBtn}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather name="x" size={20} color="#FFF" />
      </TouchableOpacity>

      {draftCount > 1 && (
        <View style={s.countBadge}>
          <Text style={s.countBadgeTxt}>{activeIndex + 1} / {draftCount}</Text>
        </View>
      )}

      {mediaType === 'video' && (
        <View style={s.countBadge}>
          <Text style={s.countBadgeTxt}>{durationSec || 0}s</Text>
        </View>
      )}

      <View style={{ flex: 1 }} />

      <TouchableOpacity
        onPress={onUndo}
        style={[s.topIconBtn, undoCount === 0 && { opacity: 0.3 }]}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        disabled={publishing || undoCount === 0}
      >
        <Feather name="corner-up-left" size={18} color="#FFF" />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onRedo}
        style={[s.topIconBtn, redoCount === 0 && { opacity: 0.3 }]}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        disabled={publishing || redoCount === 0}
      >
        <Feather name="corner-up-right" size={18} color="#FFF" />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onOpenTextEditor}
        style={s.topIconBtn}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        disabled={publishing}
      >
        <Text style={s.textBtnLabel}>Aa</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10,
    gap: 10,
  },
  topIconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.26)',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  textBtnLabel: {
    color: '#FFF', fontSize: 16, fontWeight: '700',
  },
  countBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 14, paddingHorizontal: 11, paddingVertical: 5,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.26)',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  countBadgeTxt: { color: '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
});