import type { Metadata } from "next";
import type { ReactNode } from "react";
import Header from "@/components/minewords/header";
import GamesNav from "@/components/minewords/games-nav";

/**
 * The games section's frame: header, left navigation, the game.
 *
 * The games used to be one page reached from one header link. A second game
 * makes the section a place, and a place needs a way to move between what is in
 * it. The navigation is in the layout rather than in each page so a new game
 * appears in it by being added to `lib/games.ts`, not by remembering to edit
 * three pages.
 *
 * No game here is indexable: these are a child's playground, not a page a
 * parent searches for. The metadata is set on the layout so no page can forget.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function GamesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      <Header />
      <main className="workspace games-workspace">
        <div className="games-shell">
          <GamesNav />
          <div className="games-content">{children}</div>
        </div>
      </main>
    </div>
  );
}
