import { SoundProvider } from "@/lib/theme/sound-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { THEMES, THEME_STORAGE_KEY } from "@/lib/theme/themes";
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

/**
 * Applies the saved theme before the page paints.
 *
 * A child's theme is a small thing to ask them to choose twice, so it is read
 * here, inline and early, rather than in an effect after first paint. Without
 * this the page renders in the default colours and then snaps to the chosen
 * ones, which is jarring on a dark theme. The list is inlined rather than
 * imported so this cannot become a reason to delay rendering.
 */
const APPLY_SAVED_THEME = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(t&&${JSON.stringify(THEMES.map((theme) => theme.id))}.indexOf(t)>-1){
document.documentElement.setAttribute("data-theme",t);
}}catch(e){}})();`;

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
