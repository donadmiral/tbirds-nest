// src/components/stories/PollDragWrap.tsx
// Drag and pinch wrapper for the poll card in the composer. The poll is not a
// sticker (own table, own RPCs, own placement in the viewer), so this gives it
// the same feel as one: one finger moves it, two fingers scale it, a tap opens
// the editor. Position is stored on the draft as nx/ny (card centre, fractions
// of the canvas) and scale, and story_polls carries the same three columns.
import React, { useEffect, useRef, useState } from 'react';
import { View, PanResponder } from 'react-native';

type Props = {
  containerW: number;
  containerH: number;
  nx: number;
  ny: number;
  scale: number;
  onChange: (nx: number, ny: number, scale: number) => void;
  onTap?: () => void;
  children: React.ReactNode;
};

// The viewer clamps the card into a band it can always show. Keep the composer
// inside the same band so what you place is what plays.
const NX_MIN = 0.4, NX_MAX = 0.6, NY_MIN = 0.3, NY_MAX = 0.68, S_MIN = 0.6, S_MAX = 1.6;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function PollDragWrap({ containerW, containerH, nx, ny, scale, onChange, onTap, children }: Props) {
  const [live, setLive] = useState({ nx, ny, scale });
  const liveRef = useRef({ nx, ny, scale });
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const pinchRef = useRef<{ d0: number; s0: number } | null>(null);
  const propsRef = useRef({ containerW, containerH, onChange, onTap });
  propsRef.current = { containerW, containerH, onChange, onTap };

  useEffect(() => {
    if (!draggingRef.current) { liveRef.current = { nx, ny, scale }; setLive({ nx, ny, scale }); }
  }, [nx, ny, scale]);

  const commit = () => {
    const l = liveRef.current;
    propsRef.current.onChange(Math.round(l.nx * 1000) / 1000, Math.round(l.ny * 1000) / 1000, Math.round(l.scale * 100) / 100);
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      draggingRef.current = true; movedRef.current = false; pinchRef.current = null;
      lastRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    },
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      if (t && t.length >= 2) {
        const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
        if (!pinchRef.current) pinchRef.current = { d0: Math.max(1, d), s0: liveRef.current.scale };
        const s = clamp(pinchRef.current.s0 * (d / pinchRef.current.d0), S_MIN, S_MAX);
        liveRef.current = { ...liveRef.current, scale: s }; setLive({ ...liveRef.current }); movedRef.current = true;
        return;
      }
      const x = e.nativeEvent.pageX, y = e.nativeEvent.pageY;
      if (pinchRef.current) { pinchRef.current = null; lastRef.current = { x, y }; return; }
      const dx = x - lastRef.current.x, dy = y - lastRef.current.y;
      lastRef.current = { x, y };
      if (Math.abs(dx) + Math.abs(dy) > 1) movedRef.current = true;
      const { containerW: W, containerH: H } = propsRef.current;
      liveRef.current = {
        ...liveRef.current,
        nx: clamp(liveRef.current.nx + dx / Math.max(1, W), NX_MIN, NX_MAX),
        ny: clamp(liveRef.current.ny + dy / Math.max(1, H), NY_MIN, NY_MAX),
      };
      setLive({ ...liveRef.current });
    },
    onPanResponderRelease: () => {
      draggingRef.current = false; pinchRef.current = null;
      if (!movedRef.current) { propsRef.current.onTap?.(); return; }
      commit();
    },
    onPanResponderTerminate: () => { draggingRef.current = false; pinchRef.current = null; if (movedRef.current) commit(); },
  })).current;

  const cardW = containerW * 0.8;
  const left = live.nx * containerW - cardW / 2;
  const top = live.ny * containerH - 100;
  return (
    <View {...pan.panHandlers} style={{ position: 'absolute', left, top, width: cardW, zIndex: 12, transform: [{ scale: live.scale }] }}>
      <View pointerEvents="none">{children}</View>
    </View>
  );
}