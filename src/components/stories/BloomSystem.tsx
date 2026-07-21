/**
 * BloomSystem.tsx
 * Radial Bloom creative grid.
 * 
 * Right-hand: + at bottom-right, tools bloom LEFT and UP (angles 240, 210, 180)
 * Left-hand: + at bottom-left, tools bloom RIGHT and UP (angles 300, 330, 0)
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  surface, text as textColor, accent, border as borderToken,
  easing, duration, feedback,
} from '../../constants/tokens';
import {
  BLOOM_TOOLS_RIGHT, BLOOM_TOOLS_LEFT, BLOOM_RADIUS,
  BLOOM_OPEN_SPRINGS, BLOOM_CLOSE_SPRING, BLOOM_STAGGERS,
  INVOKE_SIZE, BLOOM_TOOL_SIZE, type BloomToolId,
} from './composerTheme';

interface Props {
  bloomOpen: boolean;
  publishing: boolean;
  reduceMotion: boolean;
  leftHanded?: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToolTap: (toolId: BloomToolId) => void;
  invokeBottomOffset: number;
}

export default function BloomSystem({
  bloomOpen, publishing, reduceMotion, leftHanded = false,
  onOpen, onClose, onToolTap, invokeBottomOffset,
}: Props) {
  const tools = leftHanded ? BLOOM_TOOLS_LEFT : BLOOM_TOOLS_RIGHT;
  const toolAnims = useRef(tools.map(() => ({ progress: new Animated.Value(0) }))).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;
  const invokeRotation = useRef(new Animated.Value(0)).current;

  const animateOpen = useCallback(() => {
    if (reduceMotion) {
      toolAnims.forEach(a => a.progress.setValue(1));
      labelOpacity.setValue(1); invokeRotation.setValue(1);
      return;
    }
    Animated.timing(invokeRotation, { toValue: 1, duration: duration.small, easing: easing.softSettle, useNativeDriver: true }).start();
    toolAnims.forEach((anim, i) => {
      const sp = BLOOM_OPEN_SPRINGS[i] || BLOOM_OPEN_SPRINGS[0];
      Animated.spring(anim.progress, { toValue: 1, ...sp, useNativeDriver: true, delay: BLOOM_STAGGERS[i] || 50 }).start();
    });
    Animated.timing(labelOpacity, { toValue: 1, duration: duration.micro, delay: 200, useNativeDriver: true }).start();
  }, [reduceMotion]);

  const animateClose = useCallback((done?: () => void) => {
    if (reduceMotion) {
      toolAnims.forEach(a => a.progress.setValue(0));
      labelOpacity.setValue(0); invokeRotation.setValue(0);
      done?.(); return;
    }
    Animated.timing(labelOpacity, { toValue: 0, duration: duration.micro, useNativeDriver: true }).start();
    Animated.timing(invokeRotation, { toValue: 0, duration: duration.small, easing: easing.softSettle, useNativeDriver: true }).start();
    Animated.parallel(toolAnims.map(a =>
      Animated.spring(a.progress, { toValue: 0, ...BLOOM_CLOSE_SPRING, useNativeDriver: true })
    )).start(() => done?.());
  }, [reduceMotion]);

  const handleToggle = useCallback(() => {
    if (publishing) return;
    feedback.addSticker();
    if (bloomOpen) { animateClose(onClose); } else { animateOpen(); onOpen(); }
  }, [bloomOpen, publishing, animateOpen, animateClose, onOpen, onClose]);

  const handleToolPress = useCallback((id: BloomToolId) => {
    feedback.addSticker();
    animateClose(() => onToolTap(id));
  }, [animateClose, onToolTap]);

  const rotate = invokeRotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  // Anchor position: right side for right-hand, left side for left-hand
  const anchorSide = leftHanded ? 'left' : 'right';
  const anchorH = 14; // horizontal offset from edge

  return (
    <>
      {/* + invoke button */}
      <Animated.View style={[bs.invoke, {
        bottom: invokeBottomOffset, [anchorSide]: anchorH,
        backgroundColor: bloomOpen ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.35)',
      }]}>
        <TouchableOpacity style={bs.invokeTouch} onPress={handleToggle} activeOpacity={0.8}
          disabled={publishing} accessibilityLabel={bloomOpen ? 'Close creative tools' : 'Add creative element'}
          accessibilityRole="button" hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Feather name="plus" size={18} color={bloomOpen ? accent.warm : textColor.secondary} />
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>

      {/* Radial bloom tools */}
      {bloomOpen && tools.map((tool, i) => {
        const rad = (tool.angle * Math.PI) / 180;
        const dx = Math.cos(rad) * BLOOM_RADIUS;
        const dy = Math.sin(rad) * BLOOM_RADIUS;
        const progress = toolAnims[i].progress;
        const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });

        // Position relative to invoke button center
        const invokeCenter = anchorH + INVOKE_SIZE / 2;
        const toolHalf = BLOOM_TOOL_SIZE / 2;

        return (
          <Animated.View key={tool.id} style={[bs.tool, {
            [anchorSide]: invokeCenter - toolHalf - dx,
            bottom: invokeBottomOffset + (INVOKE_SIZE / 2) - toolHalf - dy,
            opacity: progress, transform: [{ scale }],
          }]}>
            <TouchableOpacity style={bs.toolTouch} onPress={() => handleToolPress(tool.id)}
              activeOpacity={0.7} accessibilityLabel={`Add ${tool.label.toLowerCase()}`}
              accessibilityRole="button" hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
              <Feather name={tool.icon} size={18} color={textColor.secondary} />
            </TouchableOpacity>
            <Animated.Text style={[bs.toolLabel, { opacity: labelOpacity }]}>{tool.label}</Animated.Text>
          </Animated.View>
        );
      })}
    </>
  );
}

const bs = StyleSheet.create({
  invoke: {
    position: 'absolute',
    width: INVOKE_SIZE, height: INVOKE_SIZE, borderRadius: INVOKE_SIZE / 2,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  invokeTouch: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tool: {
    position: 'absolute',
    width: BLOOM_TOOL_SIZE, height: BLOOM_TOOL_SIZE, borderRadius: BLOOM_TOOL_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  toolTouch: {
    width: BLOOM_TOOL_SIZE, height: BLOOM_TOOL_SIZE, borderRadius: BLOOM_TOOL_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  toolLabel: {
    position: 'absolute', bottom: -16, fontSize: 11,
    color: textColor.muted, textAlign: 'center', width: 60,
  },
});