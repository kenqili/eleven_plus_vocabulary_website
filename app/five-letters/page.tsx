import { permanentRedirect } from "next/navigation";

/**
 * Five Letters moved into `/games`.
 *
 * Kept as a redirect rather than deleted, because the address has been in the
 * header, in the guide at `/how-to` and in whatever a parent bookmarked. A 308
 * is the honest answer to "this page has a new home": the browser remembers it,
 * and so does anything that follows links for a living.
 */
export default function FiveLettersPage() {
  permanentRedirect("/games/five-letters");
}
