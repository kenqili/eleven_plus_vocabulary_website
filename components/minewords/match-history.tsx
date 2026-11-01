import type { ReactNode } from "react";
import type { RelationMatch } from "@/lib/challenge/relations";
import { formatMatchDate, formatMatchSeconds } from "@/lib/games";

/**
 * The last ten matches, in the right-hand column of a game.
 *
 * The three games share this panel rather than each carrying a copy. The
 * history is already per game in the database; what differs between the games
 * is only the intro line above it and the key hints below it.
 */
export default function MatchHistory({
  history,
  loading,
  guest,
  intro,
  howTo,
}: {
  history: RelationMatch[];
  loading: boolean;
  guest: boolean;
  intro: string;
  howTo: ReactNode;
}) {
  return (
    <aside className="relation-history">
      <h2>Your matches</h2>
      <p className="relation-history-intro">{intro}</p>
      {loading ? (
        <p className="relation-history-empty">Loading your matches…</p>
      ) : guest ? (
        <p className="relation-history-empty">Sign in to keep a history.</p>
      ) : history.length ? (
        <ol className="relation-history-list">
          {history.map((match) => (
            <li key={match.id}>
              <span className="relation-history-score">
                {match.score}/{match.questions}
              </span>
              <span className="relation-history-time">
                {formatMatchSeconds(match.seconds)}
              </span>
              <span className="relation-history-date">
                {formatMatchDate(match.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="relation-history-empty">
          No matches yet. This is your first.
        </p>
      )}
      <div className="relation-howto">
        <h3>How to play</h3>
        {howTo}
      </div>
    </aside>
  );
}
