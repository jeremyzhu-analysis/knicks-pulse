import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-frame";
import { readStore } from "@/lib/store";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Knicks game to game",
  description:
    "Quarter-by-quarter offense and defense for the New York Knicks, from last season through the latest game.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const store = readStore();
  return (
    <html lang="en">
      <body>
        <SiteHeader checkedAt={store.checkedAt} />
        {children}
        <SiteFooter updatedAt={store.updatedAt} />
      </body>
    </html>
  );
}
