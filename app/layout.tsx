import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import "./product.css";
import "./landing.css";
import "./dashboard.css";
import "./canvas.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3210"),
  title: "InPublic — Speak. Watch your ideas take shape.",
  description: "InPublic turns speaking into a live visual experience, transforming your developing ideas into editable concepts, diagrams, drawings and stories.",
  openGraph: {
    title: "InPublic — Speak. Watch your ideas take shape.",
    description: "Speaking becomes a live, editable visual experience.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "InPublic — Speak. Watch your ideas take shape.",
    description: "Speaking becomes a live, editable visual experience.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className={geist.variable} suppressHydrationWarning>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
