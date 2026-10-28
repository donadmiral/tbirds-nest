import { StoryLink } from '@/components/StoryLink';
export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StoryLink storyId={id} />;
}
