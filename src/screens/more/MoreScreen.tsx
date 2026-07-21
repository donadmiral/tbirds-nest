import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { colors, spacing, radius } from '../../utils/theme';

export default function MoreScreen({ navigation }: any) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>More</Text>
      <Text style={styles.subtitle}>Extra tools and community spaces</Text>

      <View style={styles.card}>
        <TouchableOpacity
          style={styles.item}
          onPress={() => navigation.navigate('Events')}
        >
          <Text style={styles.itemTitle}>Events</Text>
          <Text style={styles.itemText}>
            Explore school events and upcoming activities
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.item}
          onPress={() => navigation.navigate('Mentorship')}
        >
          <Text style={styles.itemTitle}>Mentorship</Text>
          <Text style={styles.itemText}>
            Connect with mentors and guidance opportunities
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.item}
          onPress={() => navigation.navigate('StartupHub')}
        >
          <Text style={styles.itemTitle}>Startup Hub</Text>
          <Text style={styles.itemText}>
            Browse startup and venture related opportunities
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.item, styles.lastItem]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.itemTitle}>Back</Text>
          <Text style={styles.itemText}>Return to your profile</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  item: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastItem: {
    borderBottomWidth: 0,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  itemText: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
});