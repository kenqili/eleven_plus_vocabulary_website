"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GAMES } from "@/lib/games";

/**
 * The left navigation of the games section.
 *
 * It is a client component only because the active game is the current path,
 * and the path is a browser fact. The list itself is in `lib/games.ts`, so the
 * navigation, the games index and the routes cannot drift apart.
 */
export default function GamesNav() {
  const pathname = usePathname();
  return (
    <nav className="games-nav" aria-label="Games">
      <p className="games-nav-title">Games</p>
      <p className="games-nav-intro">
        Short games for the words you are learning. Pick one and play.
      </p>
      <div className="games-nav-links">
        {GAMES.map((game) => {
          const active = pathname === game.href;
          return (
            <Link
              key={game.href}
              href={game.href}
              className={`games-nav-link${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="games-nav-label">{game.label}</span>
              <span className="games-nav-blurb">{game.blurb}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
