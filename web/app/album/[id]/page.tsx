import { MemoryAlbumView } from "@/components/MemoryAlbum";

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="min-h-screen">
      <MemoryAlbumView ownerId={id} />
    </main>
  );
}