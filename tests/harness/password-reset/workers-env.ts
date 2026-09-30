/**
 * `cloudflare:workers`, as two lines.
 *
 * The route reads its database and its configuration out of the environment the
 * Workers runtime binds this module to. There is no Workers runtime here - the
 * one this repository is developed on cannot run at all - so the test sets a
 * global before importing the bundle, and this is what the `cloudflare:workers`
 * alias resolves to.
 *
 * Two lines on purpose. Anything more in here would be code the test was running
 * that the application does not have, and the whole value of this harness is
 * that it adds nothing but a way for the test to hand over the database
 * scripts/node-dev-db.mjs opened. The settings the route also wants -
 * RESEND_API_KEY, EMAIL_FROM, APP_ORIGIN - deliberately do not come from here;
 * `setting()` falls back to the process environment for them, and putting them
 * in the Worker env instead would make them a second source of truth.
 */
declare global {
  /**
   * Set by the test before the bundle is imported, and never replaced after -
   * this module reads it once, at evaluation. Declared with `var` because that
   * is the only binding `globalThis` can carry.
   */
  var __minewordsHarnessEnv: Record<string, unknown> | undefined;
}

export const env = globalThis.__minewordsHarnessEnv;
