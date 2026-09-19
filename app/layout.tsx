import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MineWords | Word Challenge",
  description:
    "Build your vocabulary with Flash Card 1, Flash Card 2 and Blue Book definition practice and personal mastery tracking.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
