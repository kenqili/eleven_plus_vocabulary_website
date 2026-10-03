import Challenge from "@/components/minewords/challenge";

/**
 * The practice screen, at its own URL.
 *
 * It used to be the front page. A landing page that is also the thing a child uses
 * is two pages pretending to be one: the sales copy has to share a screen with the
 * first question, and neither can be the right size. So `/` sells and `/practice`
 * practises.
 *
 * Every "start practising" link on the site points here. The brand in the header
 * points at `/`, because a parent who has landed on the site and wants to know what
 * it is should not be dropped straight into a question.
 */
export default function PracticePage() {
  return <Challenge />;
}
