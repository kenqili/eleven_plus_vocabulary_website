import { setting } from "@/lib/server/db";
import { syncSubscription } from "@/lib/server/billing";
import { verifyStripeSignature } from "@/lib/server/webhook";
import { boundary, HttpError, json } from "@/lib/server/http";
export async function POST(request: Request) {
  return boundary(async () => {
    const raw = await request.text();
    if (raw.length > 1000000) throw new HttpError(413, "Payload too large.");
    if (
      !verifyStripeSignature(
        raw,
        request.headers.get("stripe-signature") || "",
        setting("STRIPE_WEBHOOK_SECRET"),
      )
    )
      throw new HttpError(400, "Invalid webhook signature.");
    const event = JSON.parse(raw);
    if (
      [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type)
    )
      await syncSubscription(event.data.object.id);
    if (
      event.type === "checkout.session.completed" &&
      event.data.object.subscription
    )
      await syncSubscription(event.data.object.subscription);
    return json({ received: true });
  });
}
