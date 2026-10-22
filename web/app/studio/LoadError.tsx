"use client";

export function StudioLoadError({ message, retry, busy = false }: { message: string | null; retry: () => void; busy?: boolean }) {
  if (!message) return null;
  return <p role="alert" className="my-3 text-[13px] text-danger">
    {message}{" "}
    <button type="button" onClick={retry} disabled={busy} className="font-semibold underline disabled:opacity-40">{busy ? "Retrying…" : "Try again"}</button>
  </p>;
}
