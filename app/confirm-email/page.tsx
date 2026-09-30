import ConfirmEmail from "@/components/minewords/confirm-email";

/**
 * The page the confirmation email's link opens.
 *
 * It has to exist. The link a new parent is sent points at a path in the app, and
 * for a while the only thing answering that path was the API, so the one moment
 * the whole feature depends on - a parent clicking the link they were just sent -
 * arrived at a 404, with an account that could not be signed into either. The
 * reset page is here for exactly the same reason, and this is its counterpart: a
 * committed, user-facing page that reads `?token=` and says what happened, with
 * the API staying under `/api/`.
 *
 * The token is checked before anything is drawn, rather than trusted from the
 * URL, so a link that is dead is reported as dead on this screen instead of
 * showing a confirmation that never happened.
 */
export const metadata = { title: "Confirm your email address · MineWords" };

export default function ConfirmEmailPage() {
  return <ConfirmEmail />;
}
