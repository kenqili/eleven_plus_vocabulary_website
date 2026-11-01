import type { Metadata } from "next";
import FiveLetters from "@/components/minewords/five-letters";
import { words } from "@/lib/challenge/bank";
import { freeWordIds } from "@/lib/server/free-words";
import type { FiveLettersCard } from "@/lib/challenge/five-letters";

/**
 * Five Letters, now one game inside `/games`.
 *
 * The page is unchanged apart from the frame, which moved to the section
 * layout. The old `/five-letters` address still exists and redirects here, so
 * a bookmark or a link in an old email keeps working.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Five Letters — a word game for 11+ vocabulary",
  description:
    "Guess a five-letter word in six tries. Vocabulary guesses come with a definition, example, synonyms and antonyms.",
  robots: { index: false, follow: false },
};

const splitRelations = (value: string) =>
  value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && part !== "—" && part !== "-");

/**
 * The free sample is built here rather than fetched.
 *
 * A signed-out visitor gets the same twenty five-letter words as the free
 * collection, and their curated bank cards travel with the page. The browser
 * still fetches the full dictionary separately: it needs it to gloss a
 * vocabulary word outside the sample that a child types. Other valid guesses
 * use a short fallback note. Loading 400 KB only when the game is opened keeps
 * it off every other page.
 */
export default function FiveLettersPage() {
  const free = freeWordIds();
  const demoWords = words
    .filter((word) => word.word.length === 5 && free.has(word.id))
    .map((word) => ({
      word: word.id,
      card: {
        definition: (word.help || word.definition).trim(),
        example: word.example.trim(),
        synonyms: splitRelations(word.syn),
        antonyms: splitRelations(word.ant),
        source: "MineWords" as const,
      } satisfies FiveLettersCard,
    }));

  return <FiveLetters demoWords={demoWords} />;
}
