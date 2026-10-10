import { SoundProvider } from "@/lib/theme/sound-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { APPLY_SAVED_THEME } from "@/lib/theme/theme-script";
import "./globals.css";
import { initializeStoryLibrary } from "@/lib/server/story-library";
import type { Metadata } from "next";
import { PAGE_METADATA } from "@/lib/seo";
import { siteUrl } from "@/lib/server/origin";

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
  metadataBase: new URL(siteUrl()),
  alternates: { canonical: "/" },
  openGraph: {
    // A link a parent pastes into a message. Without a title and description the
    // preview is a bare URL, which does not get clicked.
    title: PAGE_METADATA[""].title,
    description: PAGE_METADATA[""].description,
    type: "website",
    siteName: "MineWords",
    // The share card. A committed PNG rendered once from `public/og-image.svg`
    // (rsvg-convert -w 1200 -h 630), not generated per request: link previews
    // are fetched by crawlers that run no code. Relative, because
    // `metadataBase` above resolves it against the canonical origin.
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "MineWords — 11+ words to practise, level by level, until you know them",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_METADATA[""].title,
    description: PAGE_METADATA[""].description,
    images: ["/og-image.png"],
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
  // Read once: the structured data below names the origin four times, and four
  // reads would only invite them to disagree.
  const origin = siteUrl();
  return (
    <html lang="en" data-theme="classic" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_SAVED_THEME }} />
        {/*
          Site identity for search engines. A data block, not a program: script
          elements whose type is not JavaScript are never executed, so the
          Content-Security-Policy needs no nonce or hash for this one the way
          it does for the theme script above. Kept in the layout because it
          describes the site, not any one page.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": `${origin}/#organization`,
                  name: "MineWords",
                  url: origin,
                  logo: `${origin}/favicon.svg`,
                  email: "support@11pluswords.com",
                },
                {
                  "@type": "WebSite",
                  url: origin,
                  name: "MineWords",
                  publisher: { "@id": `${origin}/#organization` },
                },
              ],
            }),
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <SoundProvider>{children}</SoundProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
