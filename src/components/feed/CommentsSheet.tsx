/**
 * CommentsSheet - comments without leaving where you are. Over the feed a post
 * with media gets a stage: the media sits in a black stage above the sheet, at a
 * size that keeps the whole frame in view, and the sheet slides up beneath it
 * (Instagram's reel comments). The stage keeps a strip for the media even with
 * the sheet fully open or the keyboard up, so the video is always in view while
 * you read and while you type. Text posts keep the plain sheet over the feed.
 * Inside the expanded video viewer the sheet is inline and reports how much of
 * the screen it covers, so the viewer shrinks the reel into the space above.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TouchableWithoutFeedback, StyleSheet, Animated,
  PanResponder, Modal, Keyboard, Platform, Dimensions, StatusBar,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from '../SafeArea';
import { themedSheet } from '../../theme/useTheme';
import PostCarousel, { CarouselMedia } from '../PostCarousel';
import CommentsPanel from './CommentsPanel';

const H = Dimensions.get('window').height;
const W = Dimensions.get('window').width;
const HALF = Math.round(H * 0.54);
const FULL = Math.round(H * 0.9);
// The strip the media keeps above a fully open sheet or above the keyboard.
const MIN_STAGE = 150;

type Props = {
  visible: boolean;
  postId: string;
  postAuthorId?: string | null;
  /** The count shown in the header until the thread reports its own. */
  count?: number;
  onClose: () => void;
  onCount?: (n: number) => void;
  /** How much of the screen the sheet covers from the bottom (sheet plus keyboard, 0 when closing). */
  onSnap?: (covered: number) => void;
  /** Render inside the host's own full-screen view instead of a Modal (the expanded video viewer). */
  inline?: boolean;
  autoFocus?: boolean;
  /** Dim what lies behind the plain sheet. Off over the video viewer, where the picture is the point. */
  dim?: boolean;
  /** The post's media: when given, it plays in a stage above the sheet and stays in view. */
  media?: CarouselMedia[] | null;
};

export default function CommentsSheet({ visible, postId, postAuthorId, count, onClose, onCount, onSnap, inline, autoFocus, dim = true, media }: Props) {
  const insets = useSafeAreaInsets();
  const stage = !inline && !!(media && media.length > 0);
  const height = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const total = useRef(new Animated.Value(H)).current;
  const snapRef = useRef(HALF);
  const kbRef = useRef(0);
  const dragStart = useRef(HALF);
  const closingRef = useRef(false);
  const stageRef = useRef(stage); stageRef.current = stage;
  const [mounted, setMounted] = useState(visible);
  const mountedRef = useRef(visible); mountedRef.current = mounted;
  const [kbUp, setKbUp] = useState(false);
  const [n, setN] = useState<number | null>(null);
  const [stageH, setStageH] = useState(0);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const onSnapRef = useRef(onSnap); onSnapRef.current = onSnap;
  const onCountRef = useRef(onCount); onCountRef.current = onCount;
  const topRef = useRef(insets.top); topRef.current = insets.top;

  // The open snap: a plain sheet goes to 90%; a stage keeps its media strip.
  const fullSnap = useCallback(() => (stageRef.current ? H - topRef.current - MIN_STAGE : FULL), []);
  // The tallest the sheet can be right now: never under the status bar, never behind the keyboard, never over the media strip.
  const fit = useCallback((snap: number) => Math.max(200, Math.min(snap, H - kbRef.current - topRef.current - (stageRef.current ? MIN_STAGE : 6))), []);
  // Tell the host how much is covered and size the stage to what is left.
  const settle = useCallback((sheetH: number) => {
    onSnapRef.current?.(sheetH + kbRef.current);
    setStageH(Math.max(0, H - kbRef.current - sheetH - topRef.current));
  }, []);

  const animateTo = useCallback((snap: number, duration = 240) => {
    snapRef.current = snap;
    const h = fit(snap);
    settle(h);
    Animated.timing(height, { toValue: h, duration, useNativeDriver: false }).start();
  }, [height, fit, settle]);

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
      settle(fit(HALF));
      // A Modal takes a moment to present; the slide starts once it is on screen.
      const t = setTimeout(() => animateTo(HALF), inline ? 16 : 40);
      return () => clearTimeout(t);
    } else if (!closingRef.current) {
      height.setValue(0);
      setMounted(false);
    }
  }, [visible, height, animateTo, inline, fit, settle]);

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
      animateTo(fullSnap(), d);
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
  }, [animateTo, lift, fullSnap]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
    onPanResponderGrant: () => { height.stopAnimation((v: number) => { dragStart.current = v; }); },
    onPanResponderMove: (_e, g) => { height.setValue(Math.max(0, Math.min(fit(fullSnap()), dragStart.current - g.dy))); },
    onPanResponderRelease: (_e, g) => {
      const v = dragStart.current - g.dy;
      const full = fullSnap();
      if (g.vy > 0.9 || v < HALF * 0.55) { close(); return; }
      if (g.vy < -0.6 || v > (HALF + full) / 2) animateTo(full); else animateTo(HALF);
    },
    onPanResponderTerminate: () => animateTo(snapRef.current),
  })).current;

  if (!mounted) return null;

  const shown = n ?? count ?? 0;
  const aspect = (media?.[0]?.edit as any)?.aspect as string | undefined;
  const ratio = aspect === 'square' ? 1 : aspect === 'landscape' ? 1 / 1.91 : 1.25;
  const boxW = Math.max(60, Math.min(W, Math.floor(stageH / ratio)));

  const body = (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {stage ? (
        <Animated.View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: Animated.subtract(total, Animated.add(height, lift)), backgroundColor: '#000', overflow: 'hidden' }}>
          <StatusBar barStyle="light-content" />
          <TouchableWithoutFeedback onPress={close} accessibilityRole="button" accessibilityLabel="Close comments">
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            {stageH > 40 ? <PostCarousel media={media as CarouselMedia[]} containerWidth={boxW} isActive postId={postId} flush /> : null}
          </View>
        </Animated.View>
      ) : (
        <TouchableWithoutFeedback onPress={close} accessibilityRole="button" accessibilityLabel="Close comments">
          <Animated.View style={[StyleSheet.absoluteFill, dim ? { backgroundColor: 'rgba(0,0,0,0.32)' } : null, { opacity: height.interpolate({ inputRange: [0, HALF], outputRange: [0, 1], extrapolate: 'clamp' }) }]} />
        </TouchableWithoutFeedback>
      )}
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