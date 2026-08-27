"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[14.5px] font-bold text-ink">{title}</p>
      <p className="text-[13.5px] leading-relaxed text-ink/80">{children}</p>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[640px] px-1">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="pb-1 font-display text-xl text-porcelain">Privacy Policy</h1>
      <p className="mb-4 text-[12px] text-ink/45">Effective 28 July 2026</p>

      <Sec title="1. What we collect">Your account and profile details — name, username, photo, headline, and anything you add. The content you create: posts, stories, comments, messages, media, listings, job posts, and applications including a CV, phone number, or portfolio you choose to attach. Usage signals such as which posts appear on your screen, and technical basics like device type and a push notification token.</Sec>
      <Sec title="2. How it is used">To run the service: delivering your messages and calls, showing your posts to the audiences you chose, and sending the notifications you enable. To rank honestly: signals like unique real engagement decide feeds and Trending — never paid placement disguised as ranking. Your Reached number counts distinct people who saw your posts and is shown only to you. And to keep people safe: enforcing the rules and acting on reports and blocks.</Sec>
      <Sec title="3. What we never do">We do not sell your personal information. We do not read your private messages for advertising. We do not show your private performance data to anyone but you.</Sec>
      <Sec title="4. Sharing">Content is shared exactly as widely as your audience settings say. Behind the scenes, trusted infrastructure providers process data on our behalf — hosting, storage, media handling, and push delivery — bound to use it only for running the service. Information may be disclosed if the law genuinely requires it.</Sec>
      <Sec title="5. Your controls">Edit your profile anytime. Set your profile private, choose per-post and per-story audiences, review message requests, and block accounts — blocking hides you from each other across the app. Deleting your account from Settings removes your profile and content from the service.</Sec>
      <Sec title="6. Security and retention">Data travels encrypted and lives in access-controlled cloud storage. We keep information while your account is active and for the short period needed to run backups and honour legal duties after deletion.</Sec>
      <Sec title="7. Children">Platinum Circles is not for children under 13, and we remove accounts that are.</Sec>
      <Sec title="8. Changes">This policy may be updated as the service grows. Meaningful changes will be announced in the app.</Sec>
    </div>
  );
}