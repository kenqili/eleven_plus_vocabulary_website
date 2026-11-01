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
] as const;
