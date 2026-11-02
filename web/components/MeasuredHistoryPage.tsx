"use client";
import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** A real layout measurement, never an estimated card/row height. */
export function MeasuredHistoryPage({ index, height, measure, children }: {
  index: number; height: number; measure: (index: number, height: number) => void; children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = content.current; if (!node) return;
    const update = () => measure(index, node.getBoundingClientRect().height);
    update(); const observer = new ResizeObserver(update); observer.observe(node);
    return () => observer.disconnect();
  }, [index, measure]);
  return <div data-history-page={index} style={{ minHeight: height || undefined }}><div ref={content}>{children}</div></div>;
}
