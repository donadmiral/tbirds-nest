/**
 * Support: a cause or a business worth a tap, with a link that opens it.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
const ROSE = '#FF7A90';
export default function SupportStickerCard({ title, url, interactive }: { title: string; url?: string; interactive?: boolean }) {
  const open = () => { if (interactive && url) Linking.openURL(url.startsWith('http') ? url : 'https://' + url).catch(() => {}); };
  return (
    <TouchableOpacity onPress={open} activeOpacity={0.85} disabled={!interactive || !url} style={cs.card}>
      <View style={cs.heart}><Feather name="heart" size={14} color="#FFFFFF" /></View>
      <View style={{ flexShrink: 1 }}>
        <Text style={cs.kicker}>SUPPORT</Text>
        <Text style={cs.title} numberOfLines={2}>{title || 'Support'}</Text>
        {url ? <Text style={cs.url} numberOfLines={1}>{url.replace(/^https?:\/\//, '')}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}
const cs = StyleSheet.create({
  card: { width: 236, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
  heart: { width: 34, height: 34, borderRadius: 17, backgroundColor: ROSE, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: ROSE, fontSize: 9.5, fontWeight: '800', letterSpacing: 1 },
  title: { color: '#0B1E3D', fontSize: 14.5, fontWeight: '800' },
  url: { color: 'rgba(11,30,61,0.55)', fontSize: 11.5, fontWeight: '600', marginTop: 1 },
});