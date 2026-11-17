import type { ReactNode } from "react";

export const metadata = {
  title: "VerifiDocs",
  description: "Check every claim against your sources before you submit.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
