import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";

// Self-hosted at build time (no request to Google when a student visits). The student's words are set in the serif,
// the interface in the sans, and ids, pages and file names in the mono (see the design reference, 25 Nov 2026).
const serif = Newsreader({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], display: "swap", variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-mono" });

export const metadata = {
  title: "VerifiDocs: check your claims against your sources",
  description: "Check every claim against your sources before you submit.",
};

// Applies a saved light or dark choice before first paint, so the page never flashes the wrong theme. With no saved
// choice the system preference decides (see globals.css). localStorage can throw, so it is wrapped.
const THEME_SCRIPT = `try{var t=localStorage.getItem("verifidocs.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
