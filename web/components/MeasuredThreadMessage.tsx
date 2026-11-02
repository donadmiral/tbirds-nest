"use client";
import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function MeasuredThreadMessage({ id, height, measure, children }: {
  id: string; height: number; measure: (id: string, height: number) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    const update = () => measure(id, node.getBoundingClientRect().height);
    update(); const observer = new ResizeObserver(update); observer.observe(node);
    return () => observer.disconnect();
  }, [id, measure]);
  return <div data-thread-message={id} style={{ minHeight: height || undefined }}><div ref={ref} className="pb-2">{children}</div></div>;
}
