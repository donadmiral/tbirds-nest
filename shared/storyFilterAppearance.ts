// Shared persisted filter catalogue for native and web story renderers.
export type StoryFilterFamily = "platinum" | "classic" | "modern" | "film";
export type StoryFilterDef = { id: string; label: string; family: StoryFilterFamily; layers: { color: string; opacity: number }[]; css?: string };
// Photo renderers combine `css` and `layers` into the same sRGB color matrix.
// Legacy video/text rendering still uses the stored overlay definitions.
// Ids are stored on stories.filter_id; never rename one.
export const STORY_FILTERS: StoryFilterDef[] = [
  { id: "platinum_glow", label: "Pearl glow", family: "platinum", layers: [{ color: "#FFF1DB", opacity: 0.10 }, { color: "#FFC0AA", opacity: 0.035 }] },
  { id: "platinum_golden_hour", label: "Golden hour", family: "platinum", layers: [{ color: "#FFB866", opacity: 0.13 }, { color: "#6B2C14", opacity: 0.035 }] },
  { id: "platinum_violet", label: "Violet light", family: "platinum", layers: [{ color: "#9F7AFF", opacity: 0.12 }, { color: "#F9A5D4", opacity: 0.04 }] },
  { id: "platinum_daydream", label: "Daydream", family: "platinum", layers: [{ color: "#F8EDF9", opacity: 0.12 }, { color: "#AFCFDE", opacity: 0.045 }] },
  { id: "platinum_blue_hour", label: "Blue hour", family: "platinum", layers: [{ color: "#7DAAFF", opacity: 0.10 }, { color: "#142443", opacity: 0.06 }] },
  { id: "platinum_rose_film", label: "Rose film", family: "platinum", layers: [{ color: "#F4AEAC", opacity: 0.11 }, { color: "#F1E1CB", opacity: 0.07 }] },
  { id: "warm", label: "Warm", family: "classic", layers: [{ color: "#FF9A3C", opacity: 0.14 }, { color: "#3B2000", opacity: 0.08 }], css: "saturate(1.05)" },
  { id: "golden", label: "Golden", family: "classic", layers: [{ color: "#FFC94D", opacity: 0.18 }], css: "contrast(1.04)" },
  { id: "cool", label: "Cool", family: "classic", layers: [{ color: "#3C7DFF", opacity: 0.12 }, { color: "#001A3B", opacity: 0.08 }], css: "saturate(0.95)" },
  { id: "rose", label: "Rose", family: "classic", layers: [{ color: "#FF5E8A", opacity: 0.12 }] },
  { id: "fade", label: "Fade", family: "modern", layers: [{ color: "#FFFFFF", opacity: 0.16 }, { color: "#000000", opacity: 0.05 }], css: "contrast(0.9) saturate(0.85)" },
  { id: "dusk", label: "Dusk", family: "classic", layers: [{ color: "#5B3B8F", opacity: 0.14 }, { color: "#000000", opacity: 0.10 }], css: "contrast(1.05)" },
  { id: "sepia", label: "Sepia", family: "classic", layers: [{ color: "#8A6A3B", opacity: 0.2 }, { color: "#2B1D07", opacity: 0.1 }] },
  { id: "mint", label: "Mint", family: "modern", layers: [{ color: "#3ECF8E", opacity: 0.1 }, { color: "#02291A", opacity: 0.07 }] },
  { id: "berry", label: "Berry", family: "modern", layers: [{ color: "#B33771", opacity: 0.13 }, { color: "#1B0210", opacity: 0.09 }] },
  { id: "noir", label: "Noir", family: "classic", layers: [{ color: "#000000", opacity: 0.22 }, { color: "#1C2B4A", opacity: 0.12 }] },
  { id: "fade_warm", label: "Fade warm", family: "modern", layers: [{ color: "#FFE0B8", opacity: 0.18 }, { color: "#000000", opacity: 0.04 }], css: "contrast(0.9) saturate(0.85)" },
  { id: "fade_cool", label: "Fade cool", family: "modern", layers: [{ color: "#C8DBFF", opacity: 0.18 }, { color: "#000000", opacity: 0.04 }], css: "contrast(0.9) saturate(0.85)" },
  { id: "simple", label: "Simple", family: "modern", layers: [{ color: "#FFFFFF", opacity: 0.06 }], css: "contrast(1.06) saturate(0.95)" },
  { id: "boost", label: "Boost", family: "modern", layers: [{ color: "#FFF3D6", opacity: 0.06 }], css: "contrast(1.18) saturate(1.28)" },
  { id: "boost_warm", label: "Boost warm", family: "modern", layers: [{ color: "#FFB86B", opacity: 0.12 }], css: "contrast(1.15) saturate(1.25)" },
  { id: "boost_cool", label: "Boost cool", family: "modern", layers: [{ color: "#7FA8FF", opacity: 0.12 }], css: "contrast(1.15) saturate(1.2)" },
  { id: "graphite", label: "Graphite", family: "modern", layers: [{ color: "#2A2E36", opacity: 0.22 }, { color: "#FFFFFF", opacity: 0.04 }], css: "grayscale(1) contrast(1.15)" },
  { id: "hyper", label: "Hyper", family: "modern", layers: [{ color: "#FF3D9A", opacity: 0.08 }, { color: "#2AF0FF", opacity: 0.06 }], css: "contrast(1.25) saturate(1.5)" },
  { id: "rosy", label: "Rosy", family: "modern", layers: [{ color: "#FF8FB3", opacity: 0.16 }], css: "saturate(1.1)" },
  { id: "emerald", label: "Emerald", family: "modern", layers: [{ color: "#1DB47A", opacity: 0.14 }, { color: "#003322", opacity: 0.06 }], css: "contrast(1.05)" },
  { id: "midnight", label: "Midnight", family: "modern", layers: [{ color: "#0B1E3D", opacity: 0.22 }, { color: "#000000", opacity: 0.14 }], css: "contrast(1.1) saturate(0.9)" },
  { id: "soft_light", label: "Soft light", family: "modern", layers: [{ color: "#FFFFFF", opacity: 0.12 }, { color: "#FFE9C9", opacity: 0.08 }], css: "contrast(0.95) brightness(1.05)" },
  { id: "clarendon", label: "Clarendon", family: "film", layers: [{ color: "#7FBFFF", opacity: 0.10 }], css: "contrast(1.2) saturate(1.35)" },
  { id: "gingham", label: "Gingham", family: "film", layers: [{ color: "#FFFFFF", opacity: 0.14 }, { color: "#E6E1D6", opacity: 0.08 }], css: "brightness(1.05) contrast(0.9)" },
  { id: "moon", label: "Moon", family: "film", layers: [{ color: "#DDE3EA", opacity: 0.10 }], css: "grayscale(1) brightness(1.1) contrast(1.1)" },
  { id: "lark", label: "Lark", family: "film", layers: [{ color: "#E8F4FF", opacity: 0.10 }], css: "brightness(1.08) saturate(1.1)" },
  { id: "reyes", label: "Reyes", family: "film", layers: [{ color: "#EFE3CF", opacity: 0.20 }, { color: "#000000", opacity: 0.03 }], css: "contrast(0.85) saturate(0.75) brightness(1.1)" },
  { id: "juno", label: "Juno", family: "film", layers: [{ color: "#FFD8B0", opacity: 0.10 }, { color: "#FF7A3C", opacity: 0.05 }], css: "contrast(1.15) saturate(1.3)" },
  { id: "slumber", label: "Slumber", family: "film", layers: [{ color: "#5D4A2A", opacity: 0.16 }, { color: "#000000", opacity: 0.06 }], css: "saturate(0.66) brightness(1.05)" },
  { id: "crema", label: "Crema", family: "film", layers: [{ color: "#F3E4CE", opacity: 0.16 }], css: "contrast(0.95) saturate(0.85)" },
  { id: "ludwig", label: "Ludwig", family: "film", layers: [{ color: "#FFF1DE", opacity: 0.08 }], css: "contrast(1.05) saturate(1.1) brightness(1.03)" },
  { id: "aden", label: "Aden", family: "film", layers: [{ color: "#FFB07A", opacity: 0.14 }, { color: "#66271E", opacity: 0.06 }], css: "contrast(0.9) saturate(0.85) brightness(1.15)" },
  { id: "perpetua", label: "Perpetua", family: "film", layers: [{ color: "#7FC4B3", opacity: 0.14 }, { color: "#0F3A2E", opacity: 0.06 }], css: "contrast(1.05)" },
  { id: "amaro", label: "Amaro", family: "film", layers: [{ color: "#FFFFFF", opacity: 0.10 }, { color: "#FFD9A8", opacity: 0.08 }], css: "contrast(0.9) brightness(1.1) saturate(1.5)" },
  { id: "mayfair", label: "Mayfair", family: "film", layers: [{ color: "#FFD0E8", opacity: 0.10 }, { color: "#000000", opacity: 0.06 }], css: "contrast(1.1) saturate(1.1)" },
  { id: "rise", label: "Rise", family: "film", layers: [{ color: "#FFE0B0", opacity: 0.16 }, { color: "#000000", opacity: 0.04 }], css: "brightness(1.05) saturate(0.9) contrast(0.95)" },
  { id: "hudson", label: "Hudson", family: "film", layers: [{ color: "#7AA6FF", opacity: 0.14 }, { color: "#002050", opacity: 0.06 }], css: "brightness(1.2) contrast(0.9) saturate(1.1)" },
  { id: "valencia", label: "Valencia", family: "film", layers: [{ color: "#FFD9A0", opacity: 0.14 }, { color: "#3A2A10", opacity: 0.04 }], css: "contrast(1.08) brightness(1.08) sepia(0.08)" },
  { id: "xpro", label: "X-Pro II", family: "film", layers: [{ color: "#FFC46B", opacity: 0.10 }, { color: "#000000", opacity: 0.16 }], css: "contrast(1.3) saturate(1.4) sepia(0.1)" },
  { id: "sierra", label: "Sierra", family: "film", layers: [{ color: "#F5E6C8", opacity: 0.16 }, { color: "#000000", opacity: 0.08 }], css: "contrast(0.85) saturate(0.85)" },
  { id: "willow", label: "Willow", family: "film", layers: [{ color: "#E9DFD0", opacity: 0.12 }], css: "grayscale(0.85) contrast(0.95) brightness(1.05)" },
  { id: "lofi", label: "Lo-Fi", family: "film", layers: [{ color: "#000000", opacity: 0.10 }], css: "contrast(1.4) saturate(1.3)" },
  { id: "inkwell", label: "Inkwell", family: "film", layers: [{ color: "#000000", opacity: 0.04 }], css: "grayscale(1) contrast(1.25) brightness(1.05)" },
  { id: "hefe", label: "Hefe", family: "film", layers: [{ color: "#FFC97A", opacity: 0.12 }, { color: "#000000", opacity: 0.12 }], css: "contrast(1.2) saturate(1.3)" },
  { id: "nashville", label: "Nashville", family: "film", layers: [{ color: "#FFD1B8", opacity: 0.18 }, { color: "#3C5A99", opacity: 0.10 }], css: "sepia(0.2) contrast(1.15) brightness(1.05)" },
];
export const STORY_FILTER_FAMILIES: { key: StoryFilterFamily; label: string }[] = [
  { key: "platinum", label: "Platinum originals" },
  { key: "classic", label: "Classic" }, { key: "modern", label: "Modern" }, { key: "film", label: "Film" },
];
export function filterCss(filterId: string | null | undefined, intensity = 1): string | undefined {
  const f = filterId ? STORY_FILTERS.find((x) => x.id === filterId) : null;
  if (!f?.css) return undefined;
  if (intensity >= 1) return f.css;
  // Scale each function toward its neutral value by the intensity.
  return f.css.replace(/([a-z-]+)\(([\d.]+)\)/g, (_, fn, v) => {
    const n = parseFloat(v); const neutral = fn === "grayscale" || fn === "sepia" ? 0 : 1;
    return fn + "(" + (neutral + (n - neutral) * intensity).toFixed(3) + ")";
  });
}

