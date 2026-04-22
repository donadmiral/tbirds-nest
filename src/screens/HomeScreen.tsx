import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

export default function HomeScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title}>TBirds Nest</Text>
      <View style={styles.card}>
        <Text>Welcome to your network</Text>
      </View>
      <View style={styles.card}>
        <Text>Post 1</Text>
      </View>
      <View style={styles.card}>
        <Text>Post 2</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  title: { fontSize: 24, marginBottom: 20 },
  card: {
    backgroundColor: '#eee',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },
});

