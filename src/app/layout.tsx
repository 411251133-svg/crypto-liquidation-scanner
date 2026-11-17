import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PerpSqueeze // Analytics & Scanner",
  description: "Cryptocurrency perpetual futures analytics and squeeze-scanner web application",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className="dark"><body className="bg-[#07070a] text-zinc-100 antialiased">{children}</body></html>;
}
