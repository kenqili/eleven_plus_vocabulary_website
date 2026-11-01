import type { Metadata } from "next";
import RelationChallenge from "@/components/minewords/relation-challenge";
import { guestQuestions } from "@/lib/server/relations";

/**
 * The synonym challenge. The questions a signed-out visitor plays are built
 * here from the free collection; a signed-in browser asks the endpoint for the
 * words its account is allowed and for its score history.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Synonym Challenge — an 11+ word game",
  description:
    "Ten rounds of synonyms: pick the words that mean the same, then see the definition, example and antonyms.",
  robots: { index: false, follow: false },
};

export default function SynonymChallengePage() {
  return <RelationChallenge kind="syn" demoQuestions={guestQuestions("syn")} />;
}
