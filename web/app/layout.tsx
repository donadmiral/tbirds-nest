import BootSplash from "@/components/BootSplash";
import type { Metadata } from "next";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { Manrope, Inter } from "next/font/google";
import "./globals.css";

const marcellus = Manrope({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-marcellus", display: "swap" });

const instrument = Inter({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://platinumcircles.app";

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' as const };
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Platinum Circles", template: "%s | Platinum Circles" },
  description: "Work, market and community in one place.",
  applicationName: "Platinum Circles",
  openGraph: {
    type: "website",
    siteName: "Platinum Circles",
    title: "Platinum Circles",
    description: "Work, market and community in one place.",
    url: SITE,
  },
  twitter: { card: "summary_large_image", title: "Platinum Circles", description: "Work, market and community in one place." },
  robots: { index: true, follow: true },
  icons: { icon: "/logo.png", apple: "/logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${marcellus.variable} ${instrument.variable}`}>
      <head>
        {/* Applies the saved appearance before paint so dark users see no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('pc:theme')||'light';if(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <BootSplash />
        {children}
        {/* Global, so a dropped connection is reported on every route. */}
        <ConnectionBanner />
      </body>
    </html>
  );
}