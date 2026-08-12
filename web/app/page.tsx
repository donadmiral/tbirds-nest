export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8">
      <div
        className="h-24 w-24 rounded-full border-2 border-pearl"
        style={{ boxShadow: "0 0 60px rgba(201, 191, 176, 0.25)" }}
        aria-hidden
      />
      <h1 className="font-display text-4xl tracking-wide text-porcelain">
        Platinum Circles
      </h1>
      <p className="text-sm text-white/50">The web app is being built.</p>
    </main>
  );
}