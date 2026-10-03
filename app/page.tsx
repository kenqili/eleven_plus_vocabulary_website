import Landing from "@/components/minewords/landing";
import { bankSize } from "@/lib/server/free-words";
import { configuredFreeWordLimit, publicPrices } from "@/lib/server/billing";
import { STORY_COUNT } from "@/lib/server/story-library";

/**
 * The front page.
 *
 * A server component, and that is the whole point of the file being separate. The
 * two numbers on the page are read from the word bank here and handed down as
 * props, so they are right for every visitor including a signed-out one.
 *
 * The first draft was a client component that fetched them, and got it wrong twice:
 * once from an endpoint whose `words` is the free-tier *question* list, which
 * showed a signed-out parent "223 words" directly above a source list summing to
 * 2,247, and then from `/api/words`, which is `requireUser` and so answers 401 to
 * exactly the audience a landing page exists for. Both produced a number that was
 * wrong or missing for the people reading this page.
 */
export default async function Home() {
  // `configuredFreeWordLimit` rather than a literal, because the hero says what a
  // child keeps after the trial and that number is a setting. A hard-coded 224 on a
  // page whose job is to be believed would eventually disagree with the app.
  return (
    <Landing
      totalWords={bankSize()}
      freeWords={configuredFreeWordLimit()}
      storyCount={STORY_COUNT}
      priced={await publicPrices()}
    />
  );
}
