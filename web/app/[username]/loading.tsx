/**
 * The profile skeleton mirrors the real header exactly: 164px banner, the
 * avatar straddling its edge, then centred name, handle and the stats capsule.
 * Matching the shape is the point, otherwise the page jumps when data lands.
 */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading profile">
      <div className="-mx-4">
        <div className="h-[164px] w-full border-b-2 border-pearl/40 bg-surface" />
        <div className="px-4">
          <div className="-mt-[55px] mb-1 flex justify-center">
            <div className="h-[106px] w-[106px] rounded-full border-[3px] border-white bg-surface" />
          </div>
          <div className="mx-auto h-[22px] w-[180px] rounded-lg bg-surface" />
          <div className="mx-auto mt-2 h-[13px] w-[110px] rounded bg-surface/70" />
          <div className="mx-auto mt-4 h-[52px] w-[280px] rounded-full bg-surface/70" />
        </div>
      </div>
    </div>
  );
}
