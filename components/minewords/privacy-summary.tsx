import { configuredFreeTrialDays, configuredFreeWordLimit, configuredPriceLabel } from "@/lib/server/billing";

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
      <p>
        {price
          ? `Full access is ${price}, and you can cancel from your account in a couple of clicks. It renews until you cancel.`
          : "Full access is a monthly subscription. The exact price is shown on your account page before you pay anything."}{" "}
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
        <a href="/privacy">The full privacy notice</a> has the detail,
        including how payments are handled.
      </p>
    </div>
  );
}
