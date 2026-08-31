import type { Metadata } from "next";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { Marcellus, Instrument_Sans } from "next/font/google";
import "./globals.css";

const marcellus = Marcellus({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-marcellus",
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://platinumcircles.com";

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
      <body suppressHydrationWarning>
        {children}
        {/* Global, so a dropped connection is reported on every route. */}
        <ConnectionBanner />
      </body>
    </html>
  );
}