import { SkeletonList } from "@/components/ui";

export default function Loading() {
  return (
    <div>
      <div className="mb-4 animate-pulse">
        <div className="h-[26px] w-[170px] rounded-lg bg-surface" />
        <div className="mt-2 h-[14px] w-[260px] rounded bg-surface/70" />
      </div>
      <SkeletonList rows={4} />
    </div>
  );
}
