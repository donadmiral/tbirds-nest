import { LiveClipView } from '@/components/LiveClipView';
export const metadata = { title: 'Live clip' };
export default async function LiveClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveClipView id={id}/>;
}
