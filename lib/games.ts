/**
 * The games in `/games`, in the order they appear in the left navigation.
 *
 * One list, read by the navigation, the games index and the tests. Five Letters
 * used to be a lone link in the header, so adding a second game meant editing
 * the header, the page and anything else that named it - and a game nobody
 * linked to is a game nobody plays. The same mistake as the parent guides, one
 * feature later.
 */
export type Game = {
  slug: string;
  href: string;
  label: string;
  blurb: string;
};

export const GAMES: readonly Game[] = [
  {
    slug: "five-letters",
    href: "/games/five-letters",
    label: "Five Letters",
    blurb: "Guess the hidden five-letter word in six tries.",
  },
  {
    slug: "syn",
    href: "/games/syn",
    label: "Synonym Challenge",
    blurb: "Pick the words that mean the same. Ten rounds, then a score.",
  },
  {
    slug: "ant",
    href: "/games/ant",
    label: "Antonym Challenge",
    blurb: "Pick the words that mean the opposite. Ten rounds, then a score.",
  },
  {
    slug: "mi",
    href: "/games/mi",
    label: "Mi Challenge",
    blurb:
      "Ten mixed questions: meanings, similar words, opposites, name the word and fill the gap.",
  },
] as const;

/** A match time as `m:ss`, shared by every game's summary and history. */
export const formatMatchSeconds = (seconds: number) => {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

/** A match date as `1 Nov`, shared by every game's history. */
export const formatMatchDate = (time: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(
    new Date(time),
  );
