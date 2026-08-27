"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const VERSION = "1.0.0";
const BUILD = "100";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[600px] px-1">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>

      <div className="flex flex-col items-center py-8 text-center">
        <div className="relative mb-3.5 flex h-[84px] w-[84px] items-center justify-center">
          <span className="absolute h-[84px] w-[84px] rounded-full border-[5px] border-pearl" />
          <span className="h-[34px] w-[34px] rounded-full border border-ink/10 bg-[#F3EFE7]" />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-porcelain">Platinum Circles</h1>
        <p className="mt-1 text-[13.5px] text-ink/55">Zimbabwe&apos;s professional network</p>
        <span className="mt-3 rounded-full bg-ink/[0.06] px-3 py-1.5 text-[12px] font-semibold text-ink/60">Version {VERSION} ({BUILD})</span>
      </div>

      <div className="mb-3 rounded-2xl bg-ink/[0.035] p-4">
        <p className="mb-2 text-[14.5px] font-bold text-ink">Our mission</p>
        <p className="text-[13.5px] leading-relaxed text-ink/80">Platinum Circles exists so that Zimbabweans can find work, trade, build, and stay connected in one place made for us. The talent has always been here. We are building the network it deserves — where a job application, a sale, a story, and a call all happen with the people who matter to you.</p>
      </div>

      <div className="mb-3 rounded-2xl bg-ink/[0.035] p-4">
        <p className="mb-2 text-[14.5px] font-bold text-ink">What lives here</p>
        <p className="text-[13.5px] leading-relaxed text-ink/80">A feed for your circles, with stories that disappear in a day and a Trending page that only shows what real people have genuinely lifted up. Messages with voice notes and voice and video calls. A Market where you deal directly with the seller. A Jobs board built for how hiring works here — apply with your CV, your phone number, and your portfolio. And the Innovation channel: a registry of what Zimbabwe is building in science, engineering, and enterprise, and the people building it.</p>
      </div>

      <div className="mb-3 rounded-2xl bg-ink/[0.035] p-4">
        <p className="mb-2 text-[14.5px] font-bold text-ink">The mark</p>
        <p className="text-[13.5px] leading-relaxed text-ink/80">Our symbol is a pearl set in a platinum ring. Platinum for the standard we hold ourselves to. The pearl at the center honors Pearl — the founder&apos;s mother — because everything built here is built on what she gave.</p>
      </div>

      <p className="mt-4 text-center text-[12.5px] text-ink/45">Made with pride, for Zimbabwe.</p>
    </div>
  );
}