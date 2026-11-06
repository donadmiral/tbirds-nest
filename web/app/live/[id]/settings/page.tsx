import { LiveClipSettings } from '@/components/LiveClipSettings';
export const metadata = { title: 'Live clip settings' };
export default async function LiveClipSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveClipSettings sessionId={id}/>;
}
