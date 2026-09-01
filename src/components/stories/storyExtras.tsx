/**
 * storyExtras — the new sticker kinds of the creative engine plus the
 * entrance animator and the expanded text-style catalog. Everything
 * here stores plain JSON on the sticker so web renders identically.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet, TouchableOpacity } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { stickerTextStyle } from '../../utils/stickerStyles';
import type { StoryTextSticker } from '../../services/storiesService';

/* ── Expanded text catalog (doc 17): merges over the base 9 styles ── */
export const EXTRA_TEXT_STYLES = [
  'mono', 'serif2', 'condensed', 'marker', 'signature', 'poster', 'luxury', 'tech', 'bubble',
] as const;
const EXTRA_MAP: Record<string, { fontFamily?: string; fontWeight?: any; fontStyle?: any; letterSpacing?: number }> = {
  mono:      { fontFamily: 'Courier', fontWeight: '600' },
  serif2:    { fontFamily: 'Georgia', fontWeight: '400' },
  condensed: { fontFamily: 'AvenirNextCondensed-DemiBold', fontWeight: '600' },
  marker:    { fontFamily: 'Marker Felt', fontWeight: '400' },
  signature: { fontFamily: 'Snell Roundhand', fontWeight: '600' },
  poster:    { fontFamily: 'AvenirNextCondensed-Heavy', fontWeight: '900', letterSpacing: 0.5 },
  luxury:    { fontFamily: 'Didot', fontWeight: '400', letterSpacing: 1 },
  tech:      { fontFamily: 'Menlo', fontWeight: '600', letterSpacing: 0.5 },
  bubble:    { fontFamily: 'Chalkboard SE', fontWeight: '700' },
};
export const EXTRA_TEXT_LABELS: Record<string, string> = {
  mono: 'Mono', serif2: 'Serif+', condensed: 'Condensed', marker: 'Marker', signature: 'Signature',
  poster: 'Poster', luxury: 'Luxury', tech: 'Tech', bubble: 'Bubble',
};
/** Same contract as stickerTextStyle, extended styles overlay the classic base. */
export function composedTextStyle(style: any, color: string, bgEnabled?: boolean, fontSizeOverride?: number) {
  const extra = style && EXTRA_MAP[style] ? EXTRA_MAP[style] : null;
  const base = stickerTextStyle(extra ? 'classic' : style, color, bgEnabled, fontSizeOverride);
  if (!extra) return base;
  return { ...base, textStyle: { ...(base.textStyle as any), ...extra } };
}

/* ── Text animations (doc 22): entrance played when a sticker becomes visible ── */
export const TEXT_ANIMS = ['none', 'fade', 'pop', 'slide', 'rise', 'drop', 'zoom', 'bounce'] as const;
export type TextAnim = typeof TEXT_ANIMS[number];

export function StickerAnim({ anim, playKey, children }: { anim?: string | null; playKey: string | number; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(anim && anim !== 'none' ? 0 : 1)).current;
  useEffect(() => {
    if (!anim || anim === 'none') { v.setValue(1); return; }
    v.setValue(0);
    const spec = anim === 'bounce' || anim === 'pop'
      ? Animated.spring(v, { toValue: 1, useNativeDriver: true, damping: anim === 'bounce' ? 7 : 12, stiffness: 180, mass: 0.9 })
      : Animated.timing(v, { toValue: 1, duration: anim === 'fade' ? 420 : 340, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    spec.start();
  }, [anim, playKey, v]);
  if (!anim || anim === 'none') return <>{children}</>;
  const style: any = { opacity: v };
  if (anim === 'pop' || anim === 'zoom' || anim === 'bounce') style.transform = [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [anim === 'zoom' ? 1.6 : 0.3, 1] }) }];
  if (anim === 'slide') style.transform = [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) }];
  if (anim === 'rise') style.transform = [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }];
  if (anim === 'drop') style.transform = [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }];
  return <Animated.View style={style}>{children}</Animated.View>;
}

/* ── Time / Date stickers (docs 46-47): tap cycles display style ── */
export const TIME_STYLES = 3;
export function TimeStickerView({ sticker }: { sticker: StoryTextSticker }) {
  const now = new Date();
  const styleIdx = ((sticker as any).infoStyle || 0) % TIME_STYLES;
  const hh = now.getHours(); const mm = now.getMinutes().toString().padStart(2, '0');
  const h12 = hh % 12 === 0 ? 12 : hh % 12; const ap = hh >= 12 ? 'PM' : 'AM';
  if (styleIdx === 1) return (
    <View style={xs.pillDark}><Text style={xs.pillDarkTxt}>{`${h12}:${mm} ${ap}`}</Text></View>
  );
  if (styleIdx === 2) return (
    <View style={xs.clockCard}>
      <Text style={xs.clockBig}>{`${h12}:${mm}`}</Text>
      <Text style={xs.clockAp}>{ap}</Text>
    </View>
  );
  return <Text style={xs.timeHuge}>{`${h12}:${mm}`}</Text>;
}

export const DATE_STYLES = 3;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function DateStickerView({ sticker }: { sticker: StoryTextSticker }) {
  const now = new Date();
  const styleIdx = ((sticker as any).infoStyle || 0) % DATE_STYLES;
  const d = now.getDate(); const mo = MONTHS[now.getMonth()]; const yr = now.getFullYear();
  const wk = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][now.getDay()];
  if (styleIdx === 1) return (
    <View style={xs.calCard}>
      <View style={xs.calTop}><Text style={xs.calMonth}>{mo}</Text></View>
      <Text style={xs.calDay}>{d}</Text>
    </View>
  );
  if (styleIdx === 2) return <View style={xs.pillDark}><Text style={xs.pillDarkTxt}>{`${wk}`}</Text></View>;
  return <Text style={xs.dateHuge}>{`${mo} ${d}, ${yr}`}</Text>;
}

/* ── Weather sticker (doc 48): keyless Open-Meteo, value frozen at compose time ── */
export async function fetchWeatherNow(lat: number, lon: number): Promise<{ temp: number; code: number } | null> {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
    const j = await r.json();
    const c = j?.current;
    if (typeof c?.temperature_2m !== 'number') return null;
    return { temp: Math.round(c.temperature_2m), code: Number(c.weather_code) || 0 };
  } catch { return null; }
}
export function weatherGlyph(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}
export const WEATHER_STYLES = 2;
export function WeatherStickerView({ sticker }: { sticker: StoryTextSticker }) {
  const s: any = sticker;
  const styleIdx = (s.infoStyle || 0) % WEATHER_STYLES;
  const t = typeof s.weatherTemp === 'number' ? `${s.weatherTemp}°` : '--°';
  const g = weatherGlyph(Number(s.weatherCode) || 0);
  if (styleIdx === 1) return (
    <View style={xs.pillDark}><Text style={xs.pillDarkTxt}>{`${g} ${t}`}</Text></View>
  );
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 42 }}>{g}</Text>
      <Text style={xs.weatherTemp}>{t}</Text>
    </View>
  );
}

/* ── Photo sticker (doc 44): shape cycles square → rounded → circle ── */
export const PHOTO_SHAPES = ['square', 'rounded', 'circle'] as const;
export function PhotoStickerView({ sticker }: { sticker: StoryTextSticker }) {
  const s: any = sticker;
  const uri = s.photoUrl || s.photoUri;
  if (!uri) return null;
  const shape = s.photoShape || 'rounded';
  const size = 200;
  const radius = shape === 'circle' ? size / 2 : shape === 'rounded' ? 22 : 2;
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: '#111' }}>
      <ExpoImage source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={0} />
    </View>
  );
}

/* ── GIF sticker (doc 28) ── */
export function GifStickerView({ sticker }: { sticker: StoryTextSticker }) {
  const s: any = sticker;
  if (!s.gifUrl) return null;
  return <ExpoImage source={{ uri: s.gifUrl }} style={{ width: 180, height: 180 }} contentFit="contain" transition={0} />;
}

/* ── Entity sticker (doc 49): listing / job / person / article card ── */
export function EntityStickerCard({ sticker, onPress }: { sticker: StoryTextSticker; onPress?: () => void }) {
  const s: any = sticker;
  const label = s.entityType === 'listing' ? 'Marketplace' : s.entityType === 'job' ? 'Job' : s.entityType === 'article' ? 'Article' : 'Profile';
  const icon = s.entityType === 'listing' ? 'shopping-bag' : s.entityType === 'job' ? 'briefcase' : s.entityType === 'article' ? 'file-text' : 'user';
  const Card = (
    <View style={xs.entityCard}>
      {s.entityImage ? (
        <ExpoImage source={{ uri: s.entityImage }} style={xs.entityImg} contentFit="cover" transition={0} />
      ) : (
        <View style={[xs.entityImg, xs.entityImgEmpty]}><Feather name={icon as any} size={22} color="#0B1E3D" /></View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={xs.entityTagRow}>
          <Feather name={icon as any} size={11} color="#8A93A6" />
          <Text style={xs.entityTag}>{label}</Text>
        </View>
        <Text style={xs.entityTitle} numberOfLines={2}>{s.entityTitle || sticker.text}</Text>
        {!!s.entitySub && <Text style={xs.entitySub} numberOfLines={1}>{s.entitySub}</Text>}
      </View>
      <Feather name="chevron-right" size={18} color="#8A93A6" />
    </View>
  );
  if (!onPress) return Card;
  return <TouchableOpacity activeOpacity={0.85} onPress={onPress}>{Card}</TouchableOpacity>;
}

const xs = StyleSheet.create({
  timeHuge: { fontSize: 54, fontWeight: '800', color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  dateHuge: { fontSize: 30, fontWeight: '800', color: '#FFFFFF', letterSpacing: 1, textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  weatherTemp: { fontSize: 34, fontWeight: '800', color: '#FFFFFF', marginTop: 2, textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  pillDark: { backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 9 },
  pillDarkTxt: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', letterSpacing: 0.4 },
  clockCard: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 18, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center' },
  clockBig: { fontSize: 34, fontWeight: '800', color: '#0B1E3D' },
  clockAp: { fontSize: 12, fontWeight: '800', color: '#8A93A6', letterSpacing: 2 },
  calCard: { width: 96, borderRadius: 16, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  calTop: { backgroundColor: '#E24C4B', alignItems: 'center', paddingVertical: 5 },
  calMonth: { color: '#FFF', fontWeight: '800', fontSize: 13, letterSpacing: 2 },
  calDay: { textAlign: 'center', fontSize: 42, fontWeight: '800', color: '#0B1E3D', paddingVertical: 6 },
  entityCard: { width: 260, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 18, padding: 10, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  entityImg: { width: 52, height: 52, borderRadius: 12 },
  entityImgEmpty: { backgroundColor: '#EDE9E1', alignItems: 'center', justifyContent: 'center' },
  entityTagRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  entityTag: { fontSize: 10.5, fontWeight: '800', color: '#8A93A6', letterSpacing: 0.6, textTransform: 'uppercase' },
  entityTitle: { fontSize: 14, fontWeight: '700', color: '#0B1E3D', lineHeight: 18 },
  entitySub: { fontSize: 12, color: '#5A6478', marginTop: 1 },
});
