import { SoundProvider } from "@/lib/theme/sound-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { APPLY_SAVED_THEME } from "@/lib/theme/theme-script";
import "./globals.css";
import { initializeStoryLibrary } from "@/lib/server/story-library";
import type { Metadata } from "next";

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
    <html lang="en" data-theme="classic" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_SAVED_THEME }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <SoundProvider>{children}</SoundProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
