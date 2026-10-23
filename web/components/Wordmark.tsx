/**
 * The wordmark: "Platinum" in ink, "Circles" in grey, one heavy sans, no
 * space between them. This is the reference lockup; the phone and admin use
 * the same component so it cannot drift.
 */
export function Wordmark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={"select-none whitespace-nowrap font-extrabold leading-none tracking-[-0.03em] " + className}
      style={{ fontSize: size, fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif" }}
      aria-label="Platinum Circles"
    >
      <span style={{ color: "var(--wordmark-primary, #12213D)" }}>Platinum</span>
      <span style={{ color: "var(--wordmark-secondary, #667084)" }}>Circles</span>
    </span>
  );
}
