import type { Metadata } from "next";
import PracticeGame from "@/components/minewords/practice-game";
import { guestPracticeQuestions } from "@/lib/server/practice-game";

/**
 * The mixed-practice game. The questions a signed-out visitor plays are built
 * here from the free collection; a signed-in browser asks the endpoint for the
 * practice words its account is working on and for its score history.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mi Challenge — an 11+ word game",
  description:
    "Ten mixed practice questions: meanings, similar words, opposites, name the word and fill the gap.",
  robots: { index: false, follow: false },
};

export default function MiChallengePage() {
  return <PracticeGame demoQuestions={guestPracticeQuestions()} />;
}
