/** Pure layer data: each independently deployed app owns its React renderer. */
export type StoryAdjust = {
  bri?: number; warm?: number; tint?: number; sat?: number; fade?: number; vig?: number;
  con?: number; hi?: number; sh?: number; grain?: number;
};
export type StoryAdjustmentLayer = Record<string, string | number>;

const signed = (value: unknown) => Math.max(-100, Math.min(100, Number(value) || 0));
const positive = (value: unknown) => Math.max(0, Math.min(100, Number(value) || 0));

export function storyAdjustmentLayers(adjust: StoryAdjust | null | undefined): StoryAdjustmentLayer[] {
  if (!adjust || typeof adjust !== 'object') return [];
  const bri = signed(adjust.bri), warm = signed(adjust.warm), tint = signed(adjust.tint), sat = signed(adjust.sat);
  const fade = positive(adjust.fade), vig = positive(adjust.vig), con = signed(adjust.con);
  const hi = signed(adjust.hi), sh = signed(adjust.sh), grain = positive(adjust.grain);
  const layers: StoryAdjustmentLayer[] = [];
  const plane = (backgroundColor: string, opacity: number) => layers.push({ position: 'absolute', inset: 0, backgroundColor, opacity });
  if (bri > 0) plane('#FFFFFF', bri / 100 * .35);
  if (bri < 0) plane('#000000', -bri / 100 * .4);
  if (warm > 0) plane('#FF9E45', warm / 100 * .22);
  if (warm < 0) plane('#3D7DFF', -warm / 100 * .2);
  if (tint > 0) plane('#E14CCB', tint / 100 * .16);
  if (tint < 0) plane('#3DBB6A', -tint / 100 * .16);
  if (sat < 0) plane('#808080', -sat / 100 * .5);
  if (sat > 0) plane('#FF3D6E', sat / 100 * .06);
  if (fade > 0) plane('#D8D2C8', fade / 100 * .28);
  if (con > 0) plane('#000000', con / 100 * .1);
  if (con < 0) plane('#8A8A8A', -con / 100 * .22);
  if (hi) layers.push({ position: 'absolute', inset: 0, background: hi > 0
    ? `linear-gradient(to bottom, rgba(255,255,255,${hi / 100 * .22}), rgba(255,255,255,0))`
    : `linear-gradient(to bottom, rgba(0,0,0,${-hi / 100 * .18}), rgba(0,0,0,0))` });
  if (sh) layers.push({ position: 'absolute', inset: 0, background: sh > 0
    ? `linear-gradient(to top, rgba(255,255,255,${sh / 100 * .18}), rgba(255,255,255,0))`
    : `linear-gradient(to top, rgba(0,0,0,${-sh / 100 * .24}), rgba(0,0,0,0))` });
  // The same deterministic grain lattice used by the phone renderer.
  if (grain) {
    let seed = 9301;
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 220; i++) {
      const top = (random() * 100).toFixed(2) + '%', left = (random() * 100).toFixed(2) + '%';
      const opacity = .25 + random() * .75, size = random() > .5 ? 2 : 1;
      layers.push({ position: 'absolute', borderRadius: '50%', top, left, width: size, height: size,
        backgroundColor: i % 2 ? '#FFFFFF' : '#000000', opacity: opacity * grain / 100 * .35 });
    }
  }
  if (vig) {
    const vertical = vig / 100 * .55, horizontal = vig / 100 * .4;
    layers.push(
      { position: 'absolute', left: 0, right: 0, top: 0, height: '32%', background: `linear-gradient(to bottom, rgba(0,0,0,${vertical}), rgba(0,0,0,0))` },
      { position: 'absolute', left: 0, right: 0, bottom: 0, height: '32%', background: `linear-gradient(to top, rgba(0,0,0,${vertical}), rgba(0,0,0,0))` },
      { position: 'absolute', top: 0, bottom: 0, left: 0, width: '22%', background: `linear-gradient(to right, rgba(0,0,0,${horizontal}), rgba(0,0,0,0))` },
      { position: 'absolute', top: 0, bottom: 0, right: 0, width: '22%', background: `linear-gradient(to left, rgba(0,0,0,${horizontal}), rgba(0,0,0,0))` },
    );
  }
  return layers;
}
