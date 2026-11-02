import { LiveSessionView } from '@/components/LiveSessionView';
export default async function LiveSessionPage({ params }: { params: Promise<{id:string}> }) {
  const { id } = await params;
  return <LiveSessionView id={id} />;
}
