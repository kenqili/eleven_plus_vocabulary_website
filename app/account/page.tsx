import Account from "@/components/minewords/account";
import { turnstileClientKey } from "@/lib/server/turnstile";

/**
 * The account page, with the human check's public key if the server is set up
 * to verify one.
 *
 * The key is read on the server and handed to the browser as a prop rather than
 * inlined at build time: it is a setting of the deployment, not of the bundle,
 * and a page built before the keys existed must still pick them up on the next
 * request. That is also why the page is dynamic - a prerendered page would bake
 * in whichever key existed when it was built, which is none of them.
 */
export const dynamic = "force-dynamic";

export default function AccountPage() {
  return <Account turnstileSiteKey={turnstileClientKey()} />;
}
