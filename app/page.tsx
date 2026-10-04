import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
 *
 * Signed in, this is not the page: a child who opens `/` to practise should land
 * on the question, not on sales copy. So a valid session goes straight to
 * `/practice`, and only anonymous visitors are sold to here.
 */
export default async function Home() {
  const jar = await cookies();
  const token =
    jar.get("__Host-mw_session")?.value ?? jar.get("mw_session")?.value;
  // `redirect()` throws, so it stays outside the `try`: catching the lookup
  // together with it would swallow the redirect and land a signed-in child
  // on the sales copy.
  let signedIn = false;
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    try {
      const { database } = await import("@/lib/server/db");
      const { tokenDigest } = await import("@/lib/server/password");
      // The clock lives in SQL, not in `Date.now()`: this is a server
      // component render, which must stay pure, and the database knows its
      // own time for the expiry comparison.
      const row = await database()
        .prepare(
          "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000",
        )
        .bind(tokenDigest(token))
        .first<{ user_id: string }>();
      signedIn = !!row;
    } catch (error) {
      // No session store here, or no such session: fall through to the landing
      // page, which needs no account to render. A sales page must never 500
      // because the login check failed.
      void error;
    }
  }
  if (signedIn) redirect("/practice");
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
