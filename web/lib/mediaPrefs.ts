// Viewer-side media preferences, per device, doctrine points 12, 34, 35.
const AUTO = "pc_autoplay";
const SAVER = "pc_datasaver";

export function autoplayEnabled(): boolean {
  try { return localStorage.getItem(AUTO) !== "off"; } catch { return true; }
}
export function dataSaverEnabled(): boolean {
  try { return localStorage.getItem(SAVER) === "on"; } catch { return false; }
}
export function setAutoplay(on: boolean): void {
  try { localStorage.setItem(AUTO, on ? "on" : "off"); } catch { /* fine */ }
}
export function setDataSaver(on: boolean): void {
  try { localStorage.setItem(SAVER, on ? "on" : "off"); } catch { /* fine */ }
}