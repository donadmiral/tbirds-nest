import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { STORY_CATEGORIES, type StoryCategory } from '../../services/storiesService';

const NAVY = '#0B1E3D';

type CategoryPickerProps = {
  selected: StoryCategory | null;
  onChange: (category: StoryCategory | null) => void;
  disabled?: boolean;
};

export default function CategoryPicker({ selected, onChange, disabled }: CategoryPickerProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
    >
      {selected && (
        <TouchableOpacity
          style={s.clearBtn}
          onPress={() => onChange(null)}
          activeOpacity={0.7}
          disabled={disabled}
        >
          <Feather name="x" size={14} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      )}
      {STORY_CATEGORIES.map(cat => {
        const active = selected === cat;
        return (
          <TouchableOpacity
            key={cat}
            style={[s.pill, active && s.pillActive]}
            onPress={() => onChange(active ? null : cat)}
            activeOpacity={0.75}
            disabled={disabled}
          >
            <Text style={[s.pillTxt, active && s.pillTxtActive]}>{cat}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 2,
    gap: 6,
  },
  clearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  pillActive: {
    backgroundColor: 'rgba(59,130,246,0.3)',
    borderColor: 'rgba(59,130,246,0.5)',
  },
  pillTxt: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
  pillTxtActive: {
    color: '#FFF',
  },
});