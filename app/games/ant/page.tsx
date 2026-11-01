import type { Metadata } from "next";
import RelationChallenge from "@/components/minewords/relation-challenge";
import { guestQuestions } from "@/lib/server/relations";

/**
 * The antonym challenge, the same game as `/games/syn` with the other relation.
 * Keeping the two routes separate means the back button and a bookmark both
 * land on the game the child was playing.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Antonym Challenge — an 11+ word game",
  description:
    "Ten rounds of antonyms: pick the words that mean the opposite, then see the definition, example and synonyms.",
  robots: { index: false, follow: false },
};

export default function AntonymChallengePage() {
  return <RelationChallenge kind="ant" demoQuestions={guestQuestions("ant")} />;
}
