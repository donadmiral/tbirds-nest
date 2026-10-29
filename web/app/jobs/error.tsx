"use client";

import Link from "next/link";

export default function JobsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section role="alert" className="px-4 py-12 text-center">
      <h1 className="text-xl font-semibold text-ink">Jobs could not be loaded</h1>
      <p className="mt-2 text-sm text-muted">Check your connection and try again.</p>
      <button onClick={retry} className="mt-4 min-h-11 rounded-full bg-pearl px-5 font-semibold text-on-pearl">Try again</button>
      <Link href="/jobs" className="mx-auto mt-3 block w-fit py-3 text-sm text-accent">Back to jobs</Link>
    </section>
  );
}
