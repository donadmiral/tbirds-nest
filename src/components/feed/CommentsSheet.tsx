/**
 * CommentsSheet - comments without leaving where you are. The sheet slides over
 * the feed or the expanded video viewer; the post stays put and its video keeps
 * playing above the sheet. Opens at half height, drags between half and full,
 * the keyboard lifts it, drag down or tap outside to close. Hosts report the
 * sheet's height through onSnap so they can shrink what sits above it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TouchableWithoutFeedback, StyleSheet, Animated,
  PanResponder, Modal, Keyboard, Platform, Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from '../SafeArea';
import { themedSheet } from '../../theme/useTheme';
import CommentsPanel from './CommentsPanel';

const H = Dimensions.get('window').height;
const HALF = Math.round(H * 0.54);
const FULL = Math.round(H * 0.9);

type Props = {
  visible: boolean;
  postId: string;
  postAuthorId?: string | null;
  /** The count shown in the header until the thread reports its own. */
  count?: number;
  onClose: () => void;
  onCount?: (n: number) => void;
  /** The sheet's height on each snap (0 when closing), so the host can shrink what sits above it. */
  onSnap?: (height: number) => void;
  /** Render inside the host's own full-screen view instead of a Modal (the expanded video viewer). */
  inline?: boolean;
  autoFocus?: boolean;
  /** Dim what lies behind the sheet. Off over the video viewer, where the picture is the point. */
  dim?: boolean;
};

export default function CommentsSheet({ visible, postId, postAuthorId, count, onClose, onCount, onSnap, inline, autoFocus, dim = true }: Props) {
  const insets = useSafeAreaInsets();
  const height = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const snapRef = useRef(HALF);
  const kbRef = useRef(0);
  const dragStart = useRef(HALF);
  const closingRef = useRef(false);
  const [mounted, setMounted] = useState(visible);
  const mountedRef = useRef(visible); mountedRef.current = mounted;
  const [kbUp, setKbUp] = useState(false);
  const [n, setN] = useState<number | null>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const onSnapRef = useRef(onSnap); onSnapRef.current = onSnap;
  const onCountRef = useRef(onCount); onCountRef.current = onCount;
  const topRef = useRef(insets.top); topRef.current = insets.top;

  // The tallest the sheet can be right now: never under the status bar, never behind the keyboard.
  const fit = useCallback((snap: number) => Math.max(200, Math.min(snap, H - kbRef.current - topRef.current - 6)), []);

  const animateTo = useCallback((snap: number, duration = 240) => {
    snapRef.current = snap;
    onSnapRef.current?.(snap);
    Animated.timing(height, { toValue: fit(snap), duration, useNativeDriver: false }).start();
  }, [height, fit]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    Keyboard.dismiss();
    onSnapRef.current?.(0);
    Animated.timing(height, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => {
      closingRef.current = false;
      setMounted(false);
      onCloseRef.current();
    });
  }, [height]);

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      setMounted(true);
      setN(null);
      height.setValue(0);
      // A Modal takes a moment to present; the slide starts once it is on screen.
      const t = setTimeout(() => animateTo(HALF), inline ? 16 : 40);
      return () => clearTimeout(t);
    } else if (!closingRef.current) {
      height.setValue(0);
      setMounted(false);
    }
  }, [visible, height, animateTo, inline]);

  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEv as any, (e: any) => {
      if (!mountedRef.current || closingRef.current) return;
      const h = e?.endCoordinates?.height ?? 0;
      const d = e?.duration || 250;
      kbRef.current = h;
      setKbUp(true);
      // iOS keeps the window size and the sheet rides up on the keyboard; Android resizes the window itself.
      Animated.timing(lift, { toValue: Platform.OS === 'ios' ? h : 0, duration: d, useNativeDriver: false }).start();
      animateTo(FULL, d);
    });
    const s2 = Keyboard.addListener(hideEv as any, (e: any) => {
      if (!mountedRef.current || closingRef.current) return;
      const d = e?.duration || 250;
      kbRef.current = 0;
      setKbUp(false);
      Animated.timing(lift, { toValue: 0, duration: d, useNativeDriver: false }).start();
      animateTo(snapRef.current, d);
    });
    return () => { s1.remove(); s2.remove(); };
  }, [animateTo, lift]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
    onPanResponderGrant: () => { height.stopAnimation((v: number) => { dragStart.current = v; }); },
    onPanResponderMove: (_e, g) => { height.setValue(Math.max(0, Math.min(fit(FULL), dragStart.current - g.dy))); },
    onPanResponderRelease: (_e, g) => {
      const v = dragStart.current - g.dy;
      if (g.vy > 0.9 || v < HALF * 0.55) { close(); return; }
      if (g.vy < -0.6 || v > (HALF + FULL) / 2) animateTo(FULL); else animateTo(HALF);
    },
    onPanResponderTerminate: () => animateTo(snapRef.current),
  })).current;

  if (!mounted) return null;

  const shown = n ?? count ?? 0;
  const body = (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <TouchableWithoutFeedback onPress={close} accessibilityRole="button" accessibilityLabel="Close comments">
        <Animated.View style={[StyleSheet.absoluteFill, dim ? { backgroundColor: 'rgba(0,0,0,0.32)' } : null, { opacity: height.interpolate({ inputRange: [0, HALF], outputRange: [0, 1], extrapolate: 'clamp' }) }]} />
      </TouchableWithoutFeedback>
      <Animated.View style={[st.sheet, { height, bottom: lift }]}>
        <View {...pan.panHandlers} style={st.grip}>
          <View style={st.handle} />
          <View style={st.titleRow}>
            <Text style={st.title}>Comments</Text>
            {shown > 0 ? <View style={st.badge}><Text style={st.badgeTxt}>{shown}</Text></View> : null}
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={st.closeBtn} accessibilityRole="button" accessibilityLabel="Close comments">
              <Feather name="x" size={18} color="#0B1E3D" />
            </TouchableOpacity>
          </View>
        </View>
        <CommentsPanel
          postId={postId}
          postAuthorId={postAuthorId}
          autoFocus={autoFocus}
          bottomInset={kbUp ? 6 : Math.max(insets.bottom, 8)}
          onCount={(k) => { setN(k); onCountRef.current?.(k); }}
        />
      </Animated.View>
    </View>
  );

  if (inline) return body;
  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={close}>
      {body}
    </Modal>
  );
}

const st = themedSheet((t) => ({
  sheet: {
    position: 'absolute', left: 0, right: 0,
    backgroundColor: t.surface.canvas,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: -6 }, elevation: 18,
  },
  grip: { paddingTop: 8, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.08)' },
  handle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(11,30,61,0.18)', marginBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 4 },
  title: { fontSize: 15.5, fontWeight: '800', color: t.ink.primary },
  badge: { backgroundColor: t.brand.tintBg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeTxt: { fontSize: 11.5, fontWeight: '800', color: t.ink.primary },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,30,61,0.06)' },
}));