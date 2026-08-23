"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { autoplayEnabled, dataSaverEnabled, setAutoplay, setDataSaver } from "@/lib/mediaPrefs";

export default function SettingsPage() {
  const [auto, setAuto] = useState(true);
  const [saver, setSaver] = useState(false);

  useEffect(() => {
    setAuto(autoplayEnabled());
    setSaver(dataSaverEnabled());
  }, []);

  const row = "flex items-center justify-between rounded-xl border border-white/10 p-4";
  const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
    <button onClick={() => onChange(!on)} role="switch" aria-checked={on}
      className={"relative h-6 w-11 rounded-full transition-colors " + (on ? "bg-pearl" : "bg-white/20")}
    >
      <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform " + (on ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );

  return (
    <div className="px-1">
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><SettingsIcon size={19} className="text-pearl" /> Settings</h1>
      <p className="pb-5 text-[13px] text-white/50">Media preferences for this device.</p>
      <div className="flex flex-col gap-3">
        <div className={row}>
          <span>
            <span className="block text-[14px] font-semibold text-white">Autoplay videos</span>
            <span className="block text-[12px] text-white/50">Videos start on their own as you scroll. Off shows a poster with a play button.</span>
          </span>
          <Toggle on={auto} onChange={(v) => { setAuto(v); setAutoplay(v); }} />
        </div>
        <div className={row}>
          <span>
            <span className="block text-[14px] font-semibold text-white">Data saver</span>
            <span className="block text-[12px] text-white/50">Lower-size images and no video autoplay, for slow or metered connections.</span>
          </span>
          <Toggle on={saver} onChange={(v) => { setSaver(v); setDataSaver(v); }} />
        </div>
      </div>
    </div>
  );
}