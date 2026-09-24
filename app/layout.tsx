import type { Metadata } from "next";
import "./globals.css";
import { initializeStoryLibrary } from "@/lib/server/story-library";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Workers start on the first request; seed once per runtime, retrying failures.
  // Keep other pages usable if storage is temporarily unavailable.
  await initializeStoryLibrary().catch((error: unknown) => {
    console.error(
      "Story library startup failed",
      error instanceof Error ? error.message : "Storage unavailable",
    );
  });
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
