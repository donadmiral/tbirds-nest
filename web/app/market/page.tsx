import Link from "next/link";

export default function MarketPage() {
  return (
    <div className="flex flex-col items-center gap-3 px-1 py-24 text-center">
      <h1 className="font-display text-2xl text-porcelain">Market</h1>
      <p className="max-w-sm text-sm text-white/50">The web marketplace is on the build order. Your market conversations already live here.</p>
      <Link href="/market/messages" className="mt-2 rounded-md bg-pearl px-5 py-2.5 text-sm font-semibold text-ink">Market messages</Link>
    </div>
  );
}