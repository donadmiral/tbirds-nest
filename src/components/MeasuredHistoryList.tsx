import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, type FlatListProps } from 'react-native';
import { TapTopFlatList } from './TapTopList';
import type { HistoryPage, HistorySnapshot, SessionHistory } from '../../shared/sessionHistory';

/** The native scroller owns touch, mouse and momentum. Complete page layouts
 * are measured before eviction and replaced by exactly those pixel heights. */
export function MeasuredHistoryList<T>({ history, snapshot, rowGap = 0, ...props }: FlatListProps<T> & {
  history: SessionHistory<T> | null; snapshot: HistorySnapshot<T> | null; rowGap?: number;
}) {
  const header = useRef(0);
  const content = StyleSheet.flatten(props.contentContainerStyle) ?? {};
  const leading = Number(content.paddingTop ?? content.paddingVertical ?? content.padding ?? 0) || 0;
  const node = (value: React.ComponentType<unknown> | React.ReactElement | null | undefined) => typeof value === 'function' ? React.createElement(value) : value;
  const render = useCallback(({ item: page }: { item: HistoryPage<T> }) => <View style={{ minHeight: page.height || undefined }}>
    <View onLayout={event => history?.measure(page.index, event.nativeEvent.layout.height)}>
      {page.rows.map((item, index) => <React.Fragment key={props.keyExtractor?.(item, page.first + index) ?? String(page.first + index)}>
        {props.renderItem?.({ item, index: page.first + index, separators: { highlight() {}, unhighlight() {}, updateProps() {} } })}
        {page.first + index + 1 < (snapshot?.total ?? 0)
          ? props.ItemSeparatorComponent ? React.createElement(props.ItemSeparatorComponent, { highlighted: false, leadingItem: item }) : rowGap ? <View style={{ height: rowGap }} /> : null
          : null}
      </React.Fragment>)}
    </View>
  </View>, [history, props.keyExtractor, props.renderItem, props.ItemSeparatorComponent, rowGap, snapshot?.total]);
  if (!history || !snapshot) return <TapTopFlatList {...props} />;
  return <TapTopFlatList {...props} data={snapshot.pages} renderItem={render} keyExtractor={(page: HistoryPage<T>) => `page:${page.index}`}
    ItemSeparatorComponent={undefined} contentContainerStyle={[props.contentContainerStyle, { gap: 0 }]}
    initialNumToRender={24} maxToRenderPerBatch={24} windowSize={101}
    ListHeaderComponent={<>
      <View onLayout={event => { header.current = event.nativeEvent.layout.height; }} style={props.ListHeaderComponentStyle}>{node(props.ListHeaderComponent)}</View>
      {snapshot.before ? <View pointerEvents="none" style={{ height: snapshot.before }} /> : null}
    </>} ListHeaderComponentStyle={undefined}
    ListFooterComponent={<>{snapshot.after ? <View pointerEvents="none" style={{ height: snapshot.after }} /> : null}{node(props.ListFooterComponent)}</>}
    onScroll={(event: Parameters<NonNullable<FlatListProps<T>['onScroll']>>[0]) => {
      props.onScroll?.(event);
      void history.near(Math.max(0, event.nativeEvent.contentOffset.y - header.current - leading), event.nativeEvent.layoutMeasurement.height).catch(() => {});
    }} scrollEventThrottle={props.scrollEventThrottle ?? 16} />;
}
