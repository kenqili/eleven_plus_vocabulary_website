import { SoundProvider } from "@/lib/theme/sound-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { APPLY_SAVED_THEME } from "@/lib/theme/theme-script";
import "./globals.css";
import { initializeStoryLibrary } from "@/lib/server/story-library";
import type { Metadata } from "next";
import { PAGE_METADATA, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  // A template rather than a fixed title, so each page gets its own. A single fixed
  // string on five pages that are supposed to be found in a search is five results
  // with the same words in them, and a crawler weighs that as none of them being
  // about anything in particular.
  //
  // A page that sets its own title wins over this, so `/practice` and `/account`
  // are unaffected by the template.
  title: {
    default: PAGE_METADATA[""].title,
    template: "%s | MineWords",
  },
  description: PAGE_METADATA[""].description,
  // The canonical origin, from the same place the sitemap and the emailed links
  // read it. Without a canonical, the same page served from `workers.dev` and from
  // the custom domain is two URLs for one thing, and the search engine picks.
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  openGraph: {
    // A link a parent pastes into a message. Without a title and description the
    // preview is a bare URL, which does not get clicked.
    title: PAGE_METADATA[""].title,
    description: PAGE_METADATA[""].description,
    type: "website",
    siteName: "MineWords",
  },
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
