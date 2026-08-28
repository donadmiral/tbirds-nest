"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Briefcase, ChevronDown, ChevronUp, Edit3, MessageCircle, Shield, ShoppingBag, TrendingUp, Zap } from "lucide-react";

const TOPICS: { icon: React.ElementType; q: string; a: string }[] = [
  { icon: Edit3, q: "Posting and who sees it", a: "Tap the pen to compose. The audience chip beside your name controls who can see the post: everyone, followers, people you mention, or verified accounts. The lightning bolt sends a post to the Innovation channel, where you can add a field and a stage to what you are building." },
  { icon: Zap, q: "Stories", a: "Stories live for 24 hours in the strip at the top of For You and Latest. You control who can view, reply, and react from the story audience settings. A platinum ring around an avatar means there is a story to watch." },
  { icon: TrendingUp, q: "How Trending works", a: "Trending is earned, never bought and never random. A post appears there only when several different real people engage it, and a story only when enough people outside the owner view and react. If the page is empty, nothing genuinely qualifies right now." },
  { icon: MessageCircle, q: "Messages and calls", a: "Chats support text, photos, documents, and voice notes, and you can make voice and video calls, including group calls. Message requests from people you do not follow wait in Settings until you accept them. Market and job conversations keep their own inboxes so deals never mix with personal chats." },
  { icon: ShoppingBag, q: "Buying and selling on Market", a: "Listings are direct between you and the other person — message the seller from the listing, agree terms, and mark the item sold when it is done. Platinum Circles does not hold money or ship goods, so meet safely and confirm before you pay." },
  { icon: Briefcase, q: "Jobs and applying", a: "Every job shows its full description, what it offers, the deadline, and the employer. Apply with a cover note, your phone number, your CV, and a portfolio link. Track everything under My Applications, and posters manage applicants from the job itself." },
  { icon: Shield, q: "Privacy and safety controls", a: "From Settings you can make your profile private, control story and post audiences, review message requests, and block accounts. Blocking hides you from each other everywhere. You can report any post from its menu." },
  { icon: AlertCircle, q: "Something looks wrong", a: "Most display issues clear with a refresh or by reopening the tab. If a problem stays, report the post or write to us from Contact support — include what you tapped and what you expected, and we will chase it." },
];

export default function HelpPage() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mx-auto max-w-[600px] px-1">
      <Link href="/settings" aria-label="Back to Settings" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></Link>
      <h1 className="pb-1 font-display text-xl text-porcelain">Help &amp; Support</h1>
      <p className="pb-5 text-[13px] text-ink/50">Short answers to how Platinum Circles works. Tap a topic.</p>

      {TOPICS.map((t, i) => {
        const Icon = t.icon;
        const isOpen = open === i;
        return (
          <button key={t.q} onClick={() => setOpen(isOpen ? null : i)} className="mb-2.5 block w-full rounded-2xl bg-ink/[0.035] px-3.5 py-3 text-left transition-colors duration-[140ms] hover:bg-ink/[0.07]">
            <span className="flex items-center gap-2.5">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-ink/[0.07] text-ink"><Icon size={15} /></span>
              <span className="flex-1 text-[14px] font-bold text-ink">{t.q}</span>
              {isOpen ? <ChevronUp size={16} className="text-ink/40" /> : <ChevronDown size={16} className="text-ink/40" />}
            </span>
            {isOpen ? <span className="mt-2.5 block pl-[40px] text-[13px] leading-relaxed text-ink/75">{t.a}</span> : null}
          </button>
        );
      })}
    </div>
  );
}