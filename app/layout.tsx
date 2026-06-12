import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Console — Uneo Offers",
  description: "Supervision du traitement des offres immobilières",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
