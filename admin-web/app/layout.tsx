import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jetMono = JetBrains_Mono({
  variable: "--font-jet",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Platinum Circles Operations",
  description: "The operations desk for Platinum Circles.",
};

/**
 * Appearance rides in a cookie the server reads, so the html tag arrives with
 * the right theme on the first byte. No boot script, no flash, no mismatch.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jar = await cookies();
  const theme = jar.get('pc-theme')?.value === 'dark' ? 'dark' : 'light';
  const density = jar.get('pc-density')?.value === 'compact' ? 'compact' : 'comfortable';

  return (
    <html
      lang="en"
      data-theme={theme}
      data-density={density}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${jetMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
