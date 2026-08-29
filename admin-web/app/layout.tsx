import type { Metadata } from "next";
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

// Runs before first paint so the desk never flashes the wrong theme.
const THEME_BOOT = "try{var d=document.documentElement;var t=localStorage.getItem('pc-theme');d.setAttribute('data-theme',t==='dark'?'dark':'light');var n=localStorage.getItem('pc-density');d.setAttribute('data-density',n==='compact'?'compact':'comfortable');}catch(e){document.documentElement.setAttribute('data-theme','light');}";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-density="comfortable"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${jetMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
