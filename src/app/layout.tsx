import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "VerifiDocs: check your claims against your sources",
  description: "Check every claim against your sources before you submit.",
};

// Applies a saved light or dark choice before first paint, so the page never flashes the wrong theme. With no saved
// choice the system preference decides (see globals.css). localStorage can throw, so it is wrapped.
const THEME_SCRIPT = `try{var t=localStorage.getItem("verifidocs.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
