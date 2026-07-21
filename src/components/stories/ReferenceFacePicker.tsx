/**
 * ReferenceFacePicker.tsx
 *
 * Horizontal scrollable grid of the user's uploaded reference photos.
 * User taps one to select it as the face source for enhancement.
 * "Use this face."
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  FlatList,
  Image,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../services/supabase';

const TRAINING_BUCKET = 'identity-training-photos';

interface ReferencePhoto {
  storagePath: string;
  signedUrl: string;
  qualityScore: number;
}

interface Props {
  userId: string;
  onSelect: (signedUrl: string) => void;
  selectedUrl?: string | null;
}

export function ReferenceFacePicker({ userId, onSelect, selectedUrl }: Props) {
  const [photos, setPhotos] = useState<ReferencePhoto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPhotos();
  }, [userId]);

  async function loadPhotos() {
    try {
      // Fetch reference photos ordered by quality
      const { data, error } = await supabase
        .from('identity_training_photos')
        .select('storage_path, quality_score')
        .eq('user_id', userId)
        .order('quality_score', { ascending: false });

      if (error || !data || data.length === 0) {
        setLoading(false);
        return;
      }

      // Generate signed URLs for thumbnails
      const withUrls: ReferencePhoto[] = [];
      for (const row of data) {
        const { data: urlData } = await supabase.storage
          .from(TRAINING_BUCKET)
          .createSignedUrl(row.storage_path, 3600);
        if (urlData?.signedUrl) {
          withUrls.push({
            storagePath: row.storage_path,
            signedUrl: urlData.signedUrl,
            qualityScore: row.quality_score || 0,
          });
        }
      }
      setPhotos(withUrls);

      // Auto-select the highest quality photo if none selected
      if (!selectedUrl && withUrls.length > 0) {
        onSelect(withUrls[0].signedUrl);
      }
    } catch (err) {
      console.warn('[ReferencePicker] Failed to load photos:', err);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color="#C4A96C" />
        <Text style={styles.label}>Loading your best faces...</Text>
      </View>
    );
  }

  if (photos.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>No reference photos found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose your best face</Text>
      <Text style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, paddingHorizontal: 16, marginTop: 2, marginBottom: 4 }}>Saved for future enhancements</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={photos}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const isSelected = selectedUrl === item.signedUrl;
          return (
            <TouchableOpacity
              style={[styles.thumb, isSelected && styles.selected]}
              onPress={() => { console.log('[RefPicker] Selected:', item.storagePath); onSelect(item.signedUrl); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <Image source={{ uri: item.signedUrl }} style={styles.image} />
              {isSelected && <View style={styles.checkmark}><Text style={styles.check}>✓</Text></View>}
            </TouchableOpacity>
          );
        }}
        keyExtractor={(item) => item.storagePath}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
  },
  title: {
    color: '#C4A96C',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
    paddingHorizontal: 16,
    letterSpacing: 0.5,
  },
  label: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    paddingHorizontal: 16,
  },
  list: {
    paddingHorizontal: 16,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  selected: {
    borderColor: '#C4A96C',
    borderWidth: 3,
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
  },
  checkmark: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#C4A96C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    color: '#000',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
