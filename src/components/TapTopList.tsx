/**
 * TapTopList - the Instagram gesture: tapping the tab you are already
 * on scrolls its list back to the top. Drop-in replacements that bind
 * react-navigation's useScrollToTop to the list ref.
 */
import React, { useRef } from 'react';
import { FlatList, SectionList } from 'react-native';
import { useScrollToTop } from '@react-navigation/native';

export function TapTopFlatList(props: any) {
  const r = useRef<FlatList>(null);
  useScrollToTop(r);
  return <FlatList ref={r} {...props} />;
}

export function TapTopSectionList(props: any) {
  const r = useRef<SectionList>(null);
  useScrollToTop(r);
  return <SectionList ref={r} {...props} />;
}