import {
  configuredFreeTrialDays,
  configuredFreeWordLimit,
  configuredPriceLabel,
} from "@/lib/server/billing";

/**
 * What it costs and what is kept, in the two places a parent will look before
 * they commit. Both numbers come from configuration, so a page can never
 * disagree with the checkout.
 */
export default function PrivacySummary() {
  const price = configuredPriceLabel();
  const trial = configuredFreeTrialDays();
  const free = configuredFreeWordLimit();
  return (
    <div className="privacy-summary">
      <h2>What it costs</h2>
      {/*
        What it costs, and - the part that was wrong - what happens next.

        This used to say "cancel from your account in a couple of clicks. It
        renews until you cancel." Both sentences described a subscription, and this
        is not one. A length is bought once and ends; there is no renewal, nothing
        to cancel, and no second charge. So a parent reading this either did not
        buy, worried about an ongoing payment they would then have to remember to
        stop, or bought and found there was nothing to cancel - which is worse,
        because it reads as the site not knowing its own business.

        And it was on `/about`, which is where a parent reads before deciding. A
        false statement about the payment model on the page that sells it is not a
        copy problem.

        The price is per length, so it is not a single monthly figure either. It
        comes from configuration only as a fallback for a deployment with Stripe
        unconfigured; the real per-length prices are read from Stripe and shown on
        the account page before anyone pays.
      */}
      <p>
        Full access is bought for a fixed length — 1 month, 3 months or 1 year —
        {price ? `It costs ${price}. ` : ""}
        It is a one-off payment. It does not renew, there is nothing to cancel,
        and we will not charge you again. When the time runs out you can buy
        more, and it adds to the end date rather than replacing it.{" "}
        {trial > 0
          ? `New accounts get ${trial} days of full access first, with no card needed.`
          : "There is no free trial at the moment."}
      </p>
      <h2>What we keep</h2>
      <p>
        An email address and a password hash for the account. For your child:{" "}
        <strong>one row per question answered</strong> (the word, what was
        chosen, whether it was right, how long it took) and how far through each
        story they had read. That is the whole record. No name, no date of
        birth, no photo, no location, no advertising, and nothing is shared with
        anyone for marketing.
      </p>
      <p>
        The free collection is {free} words. To see everything, go to{" "}
        <a href="/account">your account</a>.
      </p>
      <h2>Getting rid of it</h2>
      <p>
        Your account page has <strong>Delete this account</strong> at the
        bottom. It removes the account and every practice record in it, and
        there is no copy kept. You do not need to email anyone.{" "}
        <a href="/privacy">The full privacy notice</a> has the detail, including
        how payments are handled.
      </p>
    </div>
  );
}
