import { ImageResponse } from "next/og";

/**
 * The default share card. Post, profile and job pages set their own image
 * when they have one; everything else gets this, so no link ever previews
 * as a blank rectangle.
 */
export const runtime = "edge";
export const alt = "Platinum Circles";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #FBF8F1 0%, #F1ECE0 100%)",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 92, fontWeight: 800, letterSpacing: "-0.03em" }}>
          <span style={{ color: "#12213D" }}>Platinum</span>
          <span style={{ color: "#8F97A8" }}>Circles</span>
        </div>
        <div style={{ marginTop: 24, fontSize: 36, color: "#4B5563" }}>Work, market and community in one place.</div>
        <div style={{ position: "absolute", right: 80, bottom: 70, width: 18, height: 18, borderRadius: 9, background: "#C8A951" }} />
      </div>
    ),
    { ...size },
  );
}
