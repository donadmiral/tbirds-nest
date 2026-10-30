import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { canPerform } from '@/lib/permissions';

/** Analytics access does not grant permission to read a moderation record. */
export default function ContentReviewLink({ role, id, children, className, style }: {
  role: string; id: string; children: ReactNode; className?: string; style?: CSSProperties;
}) {
  return canPerform(role, 'post_moderate')
    ? <Link href={`/content/${id}`} className={className} style={style}>{children}</Link>
    : <div className={className} style={style}>{children}</div>;
}
