/**
 * InAppBrowser
 *
 * The sheet a product card opens into. Shops stay inside Platinum Circles the
 * way they do on Instagram and X: the page loads in a sheet with the site's
 * name at the top, one tap closes it and the feed is exactly where it was.
 * Anything a web page cannot hold (WhatsApp, Mail, Phone, app links) is handed
 * to the system, and the whole page can be sent to Safari from the sheet.
 */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from './SafeArea';
import { getTheme } from '../theme/useTheme';

type Props = { url: string; onClose: () => void };

function hostOf(url: string) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].replace(/^www\./i, '') : url;
}

export default function InAppBrowser({ url, onClose }: Props) {
  const t = getTheme();
  const insets = useSafeAreaInsets();
  const web = useRef<WebView>(null);
  const [title, setTitle] = useState('');
  const [current, setCurrent] = useState(url);
  const [progress, setProgress] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [failed, setFailed] = useState(false);

  const leaveToSystem = () => { Linking.openURL(current).catch(() => {}); };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onClose}
    >
      <View style={[s.root, { backgroundColor: t.surface.canvas, paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
        <View style={[s.bar, { borderBottomColor: t.surface.hairline }]}>
          <TouchableOpacity
            onPress={() => { if (canGoBack) web.current?.goBack(); else onClose(); }}
            style={s.barBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={canGoBack ? 'Back' : 'Close'}
          >
            <Feather name={canGoBack ? 'arrow-left' : 'x'} size={22} color={t.ink.primary} />
          </TouchableOpacity>
          <View style={s.barMid}>
            <Text style={[s.barTitle, { color: t.ink.primary }]} numberOfLines={1}>{title || hostOf(current)}</Text>
            <View style={s.barHostRow}>
              <Feather name="lock" size={10} color={t.ink.muted} />
              <Text style={[s.barHost, { color: t.ink.muted }]} numberOfLines={1}>{hostOf(current)}</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={leaveToSystem}
            style={s.barBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Open in browser"
          >
            <Feather name="external-link" size={20} color={t.ink.primary} />
          </TouchableOpacity>
        </View>
        {progress > 0 && progress < 1 ? (
          <View style={[s.track, { backgroundColor: t.surface.sunken }]}>
            <View style={[s.fill, { width: `${Math.max(8, Math.round(progress * 100))}%`, backgroundColor: t.ink.primary }]} />
          </View>
        ) : null}
        {failed ? (
          <View style={s.failed}>
            <Feather name="wifi-off" size={28} color={t.ink.faint} />
            <Text style={[s.failedTitle, { color: t.ink.primary }]}>This page did not load</Text>
            <Text style={[s.failedBody, { color: t.ink.muted }]}>Check your connection, or open it in your browser.</Text>
            <TouchableOpacity onPress={leaveToSystem} style={[s.failedBtn, { backgroundColor: t.ink.primary }]} activeOpacity={0.85}>
              <Text style={[s.failedBtnText, { color: t.ink.inverse }]}>Open in browser</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <WebView
            ref={web}
            source={{ uri: url }}
            style={{ flex: 1, backgroundColor: t.surface.canvas }}
            originWhitelist={['*']}
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures
            allowsInlineMediaPlayback
            decelerationRate="normal"
            startInLoadingState
            renderLoading={() => (
              <View style={[StyleSheet.absoluteFill, s.loading, { backgroundColor: t.surface.canvas }]}>
                <ActivityIndicator color={t.ink.muted} />
              </View>
            )}
            onShouldStartLoadWithRequest={(req) => {
              const u = req.url || '';
              if (/^https?:\/\//i.test(u) || u.startsWith('about:')) return true;
              Linking.openURL(u).catch(() => {});
              return false;
            }}
            onLoadProgress={(e) => setProgress(e.nativeEvent.progress)}
            onNavigationStateChange={(nav) => {
              if (nav.url) setCurrent(nav.url);
              setTitle(nav.title || '');
              setCanGoBack(!!nav.canGoBack);
            }}
            onError={() => setFailed(true)}
            onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
          />
        )}
        {Platform.OS === 'android' && insets.bottom > 0 ? <View style={{ height: insets.bottom, backgroundColor: t.surface.canvas }} /> : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  bar: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  barBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  barMid: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  barTitle: { fontSize: 15, fontWeight: '700', maxWidth: '100%' },
  barHostRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  barHost: { fontSize: 11, fontWeight: '500' },
  track: { height: 2, width: '100%' },
  fill: { height: 2 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  failed: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  failedTitle: { fontSize: 16, fontWeight: '700', marginTop: 6 },
  failedBody: { fontSize: 13, textAlign: 'center' },
  failedBtn: { marginTop: 10, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  failedBtnText: { fontSize: 14, fontWeight: '700' },
});
