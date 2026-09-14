/**
 * CommentsSheet - comments without leaving where you are. Over the feed a post
 * with media gets a stage: the media lifts out of its card into a black stage
 * above the sheet, at a size that keeps the whole frame in view, and the sheet
 * slides up beneath it (Instagram's reel comments). Closing runs the same move
 * in reverse: the sheet slides down, the stage fades and the media settles back
 * onto its card, which then takes the player over without a restart. The stage
 * keeps a strip for the media even with the sheet fully open or the keyboard
 * up, so the video is always in view while you read and while you type. Text
 * posts keep the plain sheet. Inside the expanded video viewer the sheet is
 * inline and reports how much of the screen it covers, so the viewer shrinks
 * the reel into the space above.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TouchableWithoutFeedback, StyleSheet, Animated,
  PanResponder, Modal, Keyboard, Platform, Dimensions, StatusBar, Easing,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
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
// The action row under the stage media; hidden when the stage is only a strip.
const ACTIONS_H = 44;
const KB_EASE = Easing.bezier(0.25, 0.1, 0.25, 1);
const OPEN_MS = 300;
const CLOSE_MS = 260;

export type MediaFrame = { x: number; y: number; width: number; height: number };

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
  /** The post's own actions, drawn under the media in the stage so you can like, save, repost and share without leaving. */
  actions?: { liked: boolean; saved: boolean; reposted: boolean; likes: number; onLike: () => void; onSave: () => void; onRepost: () => void; onShare: () => void } | null;
  /** Where the post's media sits on screen right now, so the stage can lift out of the card and settle back onto it. */
  measureFrame?: (postId: string) => Promise<MediaFrame | null>;
  /** Fires when the close move has landed the media on its card, a few frames before the sheet unmounts: the host gives the player back to the card here. */
  onHandoff?: () => void;
};

export default function CommentsSheet({ visible, postId, postAuthorId, count, onClose, onCount, onSnap, inline, autoFocus, dim = true, media, actions, measureFrame, onHandoff }: Props) {
  const insets = useSafeAreaInsets();
  const stage = !inline && !!(media && media.length > 0);
  const height = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  // 0 = closed (sheet below the screen, stage clear, media on its card); 1 = open. Native-driven.
  const progress = useRef(new Animated.Value(0)).current;
  // The media box's fit for the current sheet state, relative to its base frame. Native-driven.
  const fitScale = useRef(new Animated.Value(1)).current;
  const fitTy = useRef(new Animated.Value(0)).current;
  // The card's frame, relative to the base frame, so progress can blend between the two.
  const cardScale = useRef(new Animated.Value(1)).current;
  const cardTy = useRef(new Animated.Value(0)).current;
  // Blend from the card's frame (progress 0) to the fitted stage frame (progress 1), all on the native thread. Built once.
  const boxScale = useRef(Animated.add(cardScale, Animated.multiply(progress, Animated.subtract(fitScale, cardScale)))).current;
  const boxTy = useRef(Animated.add(cardTy, Animated.multiply(progress, Animated.subtract(fitTy, cardTy)))).current;
  const sheetSlide = useRef(progress.interpolate({ inputRange: [0, 1], outputRange: [H, 0] })).current;
  const snapRef = useRef(HALF);
  const kbRef = useRef(0);
  const dragStart = useRef(HALF);
  const closingRef = useRef(false);
  const stageRef = useRef(stage); stageRef.current = stage;
  const baseRef = useRef({ w: 1, h: 1, x: 0, y: 0 });
  const [mounted, setMounted] = useState(visible);
  const mountedRef = useRef(visible); mountedRef.current = mounted;
  const [ready, setReady] = useState(false);
  const [kbUp, setKbUp] = useState(false);
  const [n, setN] = useState<number | null>(null);
  const [stageH, setStageH] = useState(0);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const onSnapRef = useRef(onSnap); onSnapRef.current = onSnap;
  const onCountRef = useRef(onCount); onCountRef.current = onCount;
  const measureRef = useRef(measureFrame); measureRef.current = measureFrame;
  const handoffRef = useRef(onHandoff); handoffRef.current = onHandoff;
  const actionsRef = useRef(!!actions); actionsRef.current = !!actions;
  const topRef = useRef(insets.top); topRef.current = insets.top;

  const aspect = (media?.[0]?.edit as any)?.aspect as string | undefined;
  const ratio = aspect === 'square' ? 1 : aspect === 'landscape' ? 1 / 1.91 : 1.25;
  const ratioRef = useRef(ratio); ratioRef.current = ratio;

  // The media box for a given stage height: the feed frame, scaled to the room left, centred.
  const boxFor = useCallback((sH: number) => {
    const acts = actionsRef.current && sH >= 260;
    const vH = acts ? sH - ACTIONS_H : sH;
    const w = Math.max(60, Math.min(W, Math.floor(vH / ratioRef.current)));
    const h = Math.round(w * ratioRef.current);
    return { w, h, x: Math.round((W - w) / 2), y: topRef.current + Math.round((vH - h) / 2), acts, vH };
  }, []);

  // The open snap: a plain sheet goes to 90%; a stage keeps its media strip.
  const fullSnap = useCallback(() => (stageRef.current ? H - topRef.current - MIN_STAGE : FULL), []);
  // The tallest the sheet can be right now: never under the status bar, never behind the keyboard, never over the media strip.
  const fit = useCallback((snap: number) => Math.max(200, Math.min(snap, H - kbRef.current - topRef.current - (stageRef.current ? MIN_STAGE : 6))), []);
  // Tell the host how much is covered, and move the media box to fit what is left.
  const settle = useCallback((sheetH: number, duration: number) => {
    onSnapRef.current?.(sheetH + kbRef.current);
    const sH = Math.max(0, H - kbRef.current - sheetH - topRef.current);
    setStageH(sH);
    if (!stageRef.current) return;
    const b = baseRef.current;
    const t = boxFor(sH);
    const scale = t.w / b.w;
    const ty = (t.y + t.h / 2) - (b.y + b.h / 2);
    Animated.parallel([
      Animated.timing(fitScale, { toValue: scale, duration, easing: KB_EASE, useNativeDriver: true }),
      Animated.timing(fitTy, { toValue: ty, duration, easing: KB_EASE, useNativeDriver: true }),
    ]).start();
  }, [boxFor, fitScale, fitTy]);

  const animateTo = useCallback((snap: number, duration = 240) => {
    snapRef.current = snap;
    const h = fit(snap);
    settle(h, duration);
    Animated.timing(height, { toValue: h, duration, easing: KB_EASE, useNativeDriver: false }).start();
  }, [height, fit, settle]);

  // One path for every keyboard signal: the same height applied twice is a no-op, so
  // will/did/change-frame events and the input's own blur can all report freely.
  const applyKeyboard = useCallback((kb: number, duration = 250) => {
    const h = Math.max(0, Math.round(kb));
    if (kbRef.current === h) return;
    kbRef.current = h;
    setKbUp(h > 0);
    // iOS keeps the window size and the sheet rides up on the keyboard; Android resizes the window itself, so only the fit changes.
    Animated.timing(lift, { toValue: Platform.OS === 'ios' ? h : 0, duration, easing: KB_EASE, useNativeDriver: false }).start();
    animateTo(h > 0 ? fullSnap() : snapRef.current, duration);
  }, [lift, animateTo, fullSnap]);

  // Point the card values at the card's frame (or, without one, at a gentle scale-in on the spot).
  const aimAtCard = useCallback((frame: MediaFrame | null) => {
    const b = baseRef.current;
    if (frame && frame.width > 0) {
      cardScale.setValue(frame.width / b.w);
      cardTy.setValue((frame.y + frame.height / 2) - (b.y + b.h / 2));
    } else {
      cardScale.setValue(0.94);
      cardTy.setValue(0);
    }
  }, [cardScale, cardTy]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    Keyboard.dismiss();
    onSnapRef.current?.(0);
    kbRef.current = 0;
    const finish = () => {
      Animated.parallel([
        Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(lift, { toValue: 0, duration: CLOSE_MS, easing: KB_EASE, useNativeDriver: false }),
      ]).start(() => {
        // The card takes the player back while the stage view still covers it (both views show the same player),
        // then the stage leaves a few frames later, so the video never blinks.
        handoffRef.current?.();
        setTimeout(() => { closingRef.current = false; setKbUp(false); setMounted(false); onCloseRef.current(); }, 48);
      });
    };
    if (stageRef.current && measureRef.current) {
      // Fresh measurement: the card is wherever the feed left it.
      Promise.resolve(measureRef.current(postId)).then((f) => { aimAtCard(f); finish(); }, () => { aimAtCard(null); finish(); });
    } else finish();
  }, [progress, lift, postId, aimAtCard]);

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      setMounted(true);
      setReady(false);
      setN(null);
      // Every opening starts from a clean keyboard state; a close while typing must not leave the next sheet lifted.
      kbRef.current = 0;
      lift.setValue(0);
      setKbUp(false);
      progress.setValue(0);
      snapRef.current = HALF;
      const h0 = fit(HALF);
      height.setValue(h0);
      // The base frame is the half-open box; every other state is a transform of it.
      const sH0 = Math.max(0, H - topRef.current - h0);
      const b = boxFor(sH0);
      baseRef.current = { w: b.w, h: b.h, x: b.x, y: b.y };
      fitScale.setValue(1); fitTy.setValue(0);
      settle(h0, 0);
      let alive = true;
      const start = () => {
        if (!alive) return;
        setReady(true);
        Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      };
      if (stageRef.current && measureRef.current) {
        Promise.resolve(measureRef.current(postId)).then((f) => { aimAtCard(f); start(); }, () => { aimAtCard(null); start(); });
      } else {
        aimAtCard(null);
        // A Modal takes a moment to present; the slide starts once it is on screen.
        setTimeout(start, inline ? 16 : 40);
      }
      return () => { alive = false; };
    } else if (!closingRef.current) {
      progress.setValue(0);
      setMounted(false);
    }
  }, [visible, postId, height, lift, progress, fitScale, fitTy, inline, fit, settle, boxFor, aimAtCard]);

  useEffect(() => {
    const subs: { remove: () => void }[] = [];
    const guard = (fn: (e: any) => void) => (e: any) => { if (mountedRef.current && !closingRef.current) fn(e); };
    if (Platform.OS === 'ios') {
      // The frame event also covers an interactive swipe-down dismiss, which will-hide alone can miss.
      subs.push(Keyboard.addListener('keyboardWillChangeFrame', guard((e: any) => { const y = e?.endCoordinates?.screenY; const kb = typeof y === 'number' ? Math.max(0, H - y) : (e?.endCoordinates?.height ?? 0); applyKeyboard(kb, e?.duration || 250); })));
      subs.push(Keyboard.addListener('keyboardWillShow', guard((e: any) => applyKeyboard(e?.endCoordinates?.height ?? 0, e?.duration || 250))));
      subs.push(Keyboard.addListener('keyboardWillHide', guard((e: any) => applyKeyboard(0, e?.duration || 250))));
      subs.push(Keyboard.addListener('keyboardDidHide', guard(() => applyKeyboard(0, 180))));
    } else {
      subs.push(Keyboard.addListener('keyboardDidShow', guard((e: any) => applyKeyboard(e?.endCoordinates?.height ?? 0, 200))));
      subs.push(Keyboard.addListener('keyboardDidHide', guard(() => applyKeyboard(0, 200))));
    }
    return () => { subs.forEach((s) => s.remove()); };
  }, [applyKeyboard]);

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
  const box = boxFor(stageH);
  const showActions = !!actions && box.acts;
  const base = baseRef.current;

  const body = (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {stage ? (
        <>
          <StatusBar barStyle="light-content" />
          <TouchableWithoutFeedback onPress={close} accessibilityRole="button" accessibilityLabel="Close comments">
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: progress }]} />
          </TouchableWithoutFeedback>
          {ready ? (
            <Animated.View pointerEvents="box-none" style={{ position: 'absolute', left: base.x, top: base.y, width: base.w, height: base.h, transform: [{ translateY: boxTy }, { scale: boxScale }] }}>
              <PostCarousel media={media as CarouselMedia[]} containerWidth={base.w} isActive postId={postId} flush holdView />
            </Animated.View>
          ) : null}
          {showActions && actions ? (
            <Animated.View pointerEvents="box-none" style={[st.actionRow, { top: insets.top + box.vH, opacity: progress }]}>
              <TouchableOpacity onPress={actions.onLike} style={st.actionBtn} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={actions.liked ? 'Unlike' : 'Like'}>
                <Ionicons name={actions.liked ? 'heart' : 'heart-outline'} size={22} color={actions.liked ? '#FF3040' : '#FFFFFF'} />
                {actions.likes > 0 ? <Text style={[st.actionTxt, actions.liked && { color: '#FF3040' }]}>{actions.likes}</Text> : null}
              </TouchableOpacity>
              <TouchableOpacity onPress={actions.onRepost} style={st.actionBtn} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={actions.reposted ? 'Undo repost' : 'Repost'}>
                <Feather name="repeat" size={20} color={actions.reposted ? '#C9BFB0' : '#FFFFFF'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={actions.onSave} style={st.actionBtn} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={actions.saved ? 'Remove from saved' : 'Save'}>
                <Ionicons name={actions.saved ? 'bookmark' : 'bookmark-outline'} size={20} color={actions.saved ? '#C9BFB0' : '#FFFFFF'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={actions.onShare} style={st.actionBtn} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Share">
                <Feather name="send" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </Animated.View>
          ) : null}
        </>
      ) : (
        <TouchableWithoutFeedback onPress={close} accessibilityRole="button" accessibilityLabel="Close comments">
          <Animated.View style={[StyleSheet.absoluteFill, dim ? { backgroundColor: 'rgba(0,0,0,0.32)' } : null, { opacity: progress }]} />
        </TouchableWithoutFeedback>
      )}
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { transform: [{ translateY: sheetSlide }] }]}>
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
            onFocusChange={(focused) => { if (!focused) setTimeout(() => { if (mountedRef.current && !closingRef.current) applyKeyboard(0, 200); }, 60); }}
          />
        </Animated.View>
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
  actionRow: { position: 'absolute', left: 0, right: 0, height: ACTIONS_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, paddingVertical: 6 },
  actionTxt: { color: t.ink.inverse, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
}));