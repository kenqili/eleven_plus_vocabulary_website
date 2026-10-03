import { resolveOrigin } from "@/lib/seo";
import { setting } from "./db";

/**
 * The canonical origin, read from the Workers environment.
 *
 * Server-only, because it reads `setting()` and therefore `cloudflare:workers`.
 * Everything a crawler needs an absolute URL for — the sitemap, `robots.txt` and
 * every page's canonical — is rendered on the Worker, so all three callers are on
 * this side already.
 *
 * It exists as its own module rather than as a constant in `lib/seo.ts` because the
 * two halves cannot be merged. `setting()` is the only reader that sees a Worker
 * secret, and importing it would drag `cloudflare:workers` into `lib/seo.ts`, which
 * `tests/seo.test.mjs` imports under plain Node where that scheme does not resolve.
 * Reading the origin here and handing it to `resolveOrigin()` keeps both halves
 * loadable where they need to be.
 */
export function siteUrl(): string {
  // `setting()` checks the `env` binding first and `process.env` second, so this is
  // correct on the Worker and in a Node process without either being special-cased.
  return resolveOrigin(setting("APP_ORIGIN"));
}
