import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { avatarColor, initials } from '../../utils/helpers';

type Props = { name: string; url?: string | null; size?: number };

export default function Avatar({ name, url, size = 40 }: Props) {
  const r = size / 2;
  if (url) {
    return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: r }} />;
  }
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: r, backgroundColor: avatarColor(name) }]}>
      <Text style={[styles.text, { fontSize: size * 0.36 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontWeight: '700' },
});
