import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "11+ Vocabulary Challenge",
  description:
    "Practise 11+ vocabulary with definitions, examples, synonyms, antonyms and personal mastery tracking.",
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
