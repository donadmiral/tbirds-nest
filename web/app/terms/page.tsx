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

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-[640px] px-1">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="pb-1 font-display text-xl text-porcelain">Terms of Service</h1>
      <p className="mb-4 text-[12px] text-ink/45">Effective 28 July 2026</p>

      <Sec title="1. Agreement">Platinum Circles is a social and professional network for Zimbabwe. By creating an account or using the app, you agree to these terms. If you do not agree, do not use the service.</Sec>
      <Sec title="2. Your account">You must be at least 13 years old. Keep your account information accurate and your credentials private — what happens under your account is your responsibility. One person, one identity: impersonation is not allowed.</Sec>
      <Sec title="3. What the service includes">Feed posts and stories, direct and group messaging with voice and video calls, the Market for peer-to-peer listings, the Jobs board and applications, the Innovation channel, and business accounts. Features may change as the service grows.</Sec>
      <Sec title="4. Your content">What you post stays yours. By posting, you give Platinum Circles the permission needed to store, display, and distribute that content within the service — showing your post in feeds, previews, and notifications. Delete your content and that permission ends, except for copies already shared by others, such as reposts.</Sec>
      <Sec title="5. Conduct">Do not use Platinum Circles to harass, threaten, defraud, impersonate, or spam; to post content that is illegal, hateful, or sexually exploits anyone; to scrape the service or interfere with its operation; or to misrepresent listings, jobs, or your identity. We can remove content and restrict or terminate accounts that break these rules.</Sec>
      <Sec title="6. The Market">Listings are transactions between you and the other person. Platinum Circles does not hold money, take commissions, process payments, ship goods, or guarantee any item or buyer. Inspect before you pay, meet safely, and mark items sold when done. Deals are made at your own judgement.</Sec>
      <Sec title="7. Jobs">Job posts are provided by their posters. Platinum Circles does not verify every listing and does not guarantee employment, interviews, or the accuracy of any posting. Never pay anyone to apply for a job.</Sec>
      <Sec title="8. Messages and calls">Messages, media, and call signalling are stored and transmitted to deliver the service across your devices. Do not record or share private conversations without consent, and do not use messaging to break section 5.</Sec>
      <Sec title="9. Termination">You can delete your account at any time from Settings, which removes your profile and content from the service. We may suspend or terminate accounts that violate these terms or put other people at risk.</Sec>
      <Sec title="10. Disclaimers">The service is provided as-is, without warranties of uninterrupted operation or error-free behaviour. To the fullest extent the law allows, Platinum Circles is not liable for losses arising from user content, Market deals, job applications, or service interruptions.</Sec>
      <Sec title="11. Changes">These terms may be updated as the service evolves. Meaningful changes will be announced in the app, and continued use after a change means acceptance.</Sec>
    </div>
  );
}