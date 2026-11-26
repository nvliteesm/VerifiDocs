import type { ReactNode } from "react";
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Serif, Source_Serif_4 } from "next/font/google";
import "./globals.css";

// Self-hosted at build time (no request to Google when a student visits). Four voices, each with one job (the Claude
// Design reference, 25 Nov 2026): Instrument Serif for headlines and the source's own words, Bricolage Grotesque for the
// interface, IBM Plex Mono for citations, pages and counts, Source Serif 4 for the student's draft so it reads like a page.
const display = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap", variable: "--font-display" });
const sans = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap", variable: "--font-mono" });
const page = Source_Serif_4({ subsets: ["latin"], display: "swap", variable: "--font-page" });

export const metadata = {
  title: "VerifiDocs: check your claims against your sources",
  description: "Check every claim against your sources before you submit.",
};

// Applies a saved light or dark choice before first paint, so the page never flashes the wrong theme. With no saved
// choice the system preference decides (see globals.css). localStorage can throw, so it is wrapped.
const THEME_SCRIPT = `try{var t=localStorage.getItem("verifidocs.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} ${page.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
