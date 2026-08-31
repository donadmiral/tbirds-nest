/**
 * StoryCreationMenuScreen — Creative space entry
 *
 * Atmospheric continuity: matched to viewer void (#020408)
 * and platinum environmental palette.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
  Alert, Animated, Pressable, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const BG_TOP = '#060410';
const BG_BOTTOM = '#020408';
const TEXT_PRIMARY = 'rgba(245,240,235,0.92)';
const TEXT_SECONDARY = 'rgba(245,240,235,0.55)';
const TEXT_FAINT = 'rgba(245,240,235,0.25)';
const SURFACE_PRESS = 'rgba(245,240,235,0.05)';

function MenuOption({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  const bgAnim = useRef(new Animated.Value(0)).current;

  const handlePressIn = useCallback(() => {
    Animated.timing(bgAnim, { toValue: 1, duration: 100, useNativeDriver: false }).start();
  }, [bgAnim]);

  const handlePressOut = useCallback(() => {
    Animated.timing(bgAnim, { toValue: 0, duration: 180, useNativeDriver: false }).start();
  }, [bgAnim]);

  const bgColor = bgAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(245,240,235,0)', SURFACE_PRESS],
  });

  return (
    <Pressable
      onPress={() => {
        
        onPress();
      }}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View style={[ms.row, { backgroundColor: bgColor }]}>
        <View style={ms.iconWrap}>
          <Feather name={icon as any} size={20} color={TEXT_SECONDARY} />
        </View>
        <Text style={ms.label}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const ms = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 28,
    gap: 16,
    borderRadius: 14,
    marginHorizontal: 8,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(245,240,235,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 18,
    fontWeight: '500',
    color: TEXT_PRIMARY,
    letterSpacing: -0.2,
  },
});

export default function StoryCreationMenuScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  const { mode: _m, assets: _a, ...extraParams } = route.params || {};

  const bgOpacity = useRef(new Animated.Value(0)).current;
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const row1Opacity = useRef(new Animated.Value(0)).current;
  const row2Opacity = useRef(new Animated.Value(0)).current;
  const row3Opacity = useRef(new Animated.Value(0)).current;
  const row4Opacity = useRef(new Animated.Value(0)).current;
  const row5Opacity = useRef(new Animated.Value(0)).current;
  const footerOpacity = useRef(new Animated.Value(0)).current;

  const row1TransY = useRef(new Animated.Value(8)).current;
  const row2TransY = useRef(new Animated.Value(8)).current;
  const row3TransY = useRef(new Animated.Value(8)).current;
  const row4TransY = useRef(new Animated.Value(8)).current;
  const row5TransY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.timing(bgOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    Animated.timing(headerOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();

    const stagger = 80;
    const optionDuration = 220;
    const baseDelay = 100;

    [
      { opacity: row1Opacity, transY: row1TransY, delay: baseDelay },
      { opacity: row2Opacity, transY: row2TransY, delay: baseDelay + stagger },
      { opacity: row3Opacity, transY: row3TransY, delay: baseDelay + stagger * 2 },
      { opacity: row4Opacity, transY: row4TransY, delay: baseDelay + stagger * 3 },
      { opacity: row5Opacity, transY: row5TransY, delay: baseDelay + stagger * 4 },
    ].forEach(({ opacity, transY, delay }) => {
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: optionDuration, useNativeDriver: true }),
          Animated.timing(transY, { toValue: 0, duration: optionDuration, useNativeDriver: true }),
        ]),
      ]).start();
    });

    Animated.sequence([
      Animated.delay(baseDelay + stagger * 5),
      Animated.timing(footerOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const openTextStory = () => {
    navigation.navigate('StoryComposer', { mode: 'text', assets: [], ...extraParams });
  };

  const openPhotoGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Allow photo library access in Settings.');
      return;
    }
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        preferredAssetRepresentationMode: "compatible" as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
        mediaTypes: ['images'] as ImagePicker.MediaType[],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 0.9,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        const assets = res.assets.map(a => ({
          localUri: a.uri,
          mediaType: 'image' as const,
          width: a.width,
          height: a.height,
        }));
        navigation.navigate('StoryComposer', { mode: 'image', assets, ...extraParams });
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('cancelled') || msg.includes('canceled')) return;
      Alert.alert('Could not pick photos', msg || 'Please try again.');
    }
  };

  const openVideoGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Allow photo library access in Settings.');
      return;
    }
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        preferredAssetRepresentationMode: "compatible" as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
        mediaTypes: ['videos'] as ImagePicker.MediaType[],
        allowsMultipleSelection: false,
        quality: 0.8,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        const asset = res.assets[0];
        const durationSec = asset.duration ? Math.round(asset.duration / 1000) : null;
        if (durationSec && durationSec > 60) {
          Alert.alert('Video too long', 'Please select a video under 60 seconds.');
          return;
        }
        const fileSize = (asset as any).fileSize;
        if (fileSize && fileSize > 100 * 1024 * 1024) {
          Alert.alert('File too large', 'Please select a video under 100 MB.');
          return;
        }
        const localUri = asset.uri;
        if (!localUri) {
          Alert.alert('Video not available', 'Could not access this video. Please try another.');
          return;
        }
        // Accept both file:// and ph:// URIs. expo-image-picker resolves
        // iCloud assets before returning. If it returned a URI, the asset
        // is available. The old check rejected ph:// URIs unnecessarily.
        navigation.navigate('StoryComposer', {
          mode: 'video',
          assets: [{ localUri, mediaType: 'video', width: asset.width, height: asset.height, durationSec }],
          ...extraParams,
        });
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('cancelled') || msg.includes('canceled')) return;
      // PHPhotosErrorDomain 3164 = asset not fully available (iCloud)
      if (msg.includes('3164') || msg.includes('PHPhotos')) {
        Alert.alert('Video downloading', 'This video is still downloading from iCloud. Open the Photos app, wait for it to finish, then try again.');
      } else {
        Alert.alert('Could not pick video', msg || 'Please try again.');
      }
    }
  };

  return (
    <Animated.View style={[s.root, { opacity: bgOpacity }]}>
      <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={BG_TOP} />

        <Animated.View style={[s.header, { opacity: headerOpacity }]}>
          <Text style={s.headerTitle}>Create</Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={s.closeBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.6}
          >
            <Feather name="x" size={20} color={TEXT_PRIMARY} />
          </TouchableOpacity>
        </Animated.View>

        <View style={s.body}>
          <Animated.View style={{ opacity: row1Opacity, transform: [{ translateY: row1TransY }] }}>
            <MenuOption icon="type" label="Text" onPress={openTextStory} />
          </Animated.View>
          <Animated.View style={{ opacity: row2Opacity, transform: [{ translateY: row2TransY }] }}>
            <MenuOption icon="image" label="Photo" onPress={openPhotoGallery} />
          </Animated.View>
          <Animated.View style={{ opacity: row3Opacity, transform: [{ translateY: row3TransY }] }}>
            <MenuOption icon="film" label="Video" onPress={openVideoGallery} />
          </Animated.View>
          <Animated.View style={{ opacity: row4Opacity, transform: [{ translateY: row4TransY }] }}>
            <MenuOption icon="camera" label="Camera" onPress={() => navigation.navigate('StoryCamera')} />
          </Animated.View>
          <Animated.View style={{ opacity: row5Opacity, transform: [{ translateY: row5TransY }] }}>
            <MenuOption icon="aperture" label="Dual" onPress={() => navigation.navigate('StoryDualCapture', extraParams)} />
          </Animated.View>
          <Animated.View style={{ opacity: row5Opacity, transform: [{ translateY: row5TransY }] }}>
            <MenuOption icon="grid" label="Layout" onPress={() => navigation.navigate('StoryLayout')} />
          </Animated.View>
        </View>

        <Animated.View style={[s.footer, { opacity: footerOpacity, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={s.footerLine} />
          <Text style={s.footerTxt}>Moments live for 24 hours</Text>
        </Animated.View>
      </SafeAreaView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG_BOTTOM,
  },
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245,240,235,0.06)',
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 40,
    gap: 4,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
  },
  footerLine: {
    width: 32,
    height: 1.5,
    backgroundColor: 'rgba(245,240,235,0.08)',
    borderRadius: 1,
    marginBottom: 14,
  },
  footerTxt: {
    fontSize: 13,
    color: TEXT_FAINT,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
});