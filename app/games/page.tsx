import type { Metadata } from "next";
import Link from "next/link";
import { GAMES } from "@/lib/games";

export const metadata: Metadata = {
  title: "Games — word games for 11+ vocabulary",
  description:
    "Short word games for the vocabulary a child is learning: Five Letters, a synonym challenge and an antonym challenge.",
};

/**
 * The games index. It exists so that "Games" in the header lands somewhere that
 * explains the three games rather than dropping a child into the middle of one.
 */
export default function GamesPage() {
  return (
    <div className="games-hub">
      <div className="games-hub-hero">
        <p className="eyebrow">Play and learn</p>
        <h1>Games</h1>
        <p>
          Three short games for the words you are learning. Ten rounds is a
          sitting; the words you get right count towards mastery.
        </p>
      </div>
      <div className="games-cards">
        {GAMES.map((game) => (
          <Link key={game.href} href={game.href} className="games-card">
            <h2>{game.label}</h2>
            <p>{game.blurb}</p>
            <span className="games-card-cta">Play</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
