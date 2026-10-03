/**
 * Where a parent writes to us.
 *
 * One constant, and the reason is that this address had nowhere to live. Three
 * separate places on the site told a parent to "get in touch" - the hardship note
 * on `/about`, the Contact section of `/privacy`, and the message shown when a
 * payment has not been applied - and not one of them said where. A promise with no
 * address behind it is worse than no promise: a parent who has just been charged
 * and cannot find out whether it worked has nowhere to go, and the most likely
 * result is a second payment.
 *
 * Written out rather than read from configuration, for the same reason the site
 * name is not read from configuration: it is not a secret, it changes when the
 * owner changes it, and a setting that has to be set on a new deployment before
 * the site will tell a parent how to complain is one that will be missed.
 *
 * `mailto:` and a visible address, not a hidden `mailto:` link with no fallback.
 * A parent on a locked-down school machine may not be able to click a link, and
 * an address they cannot select and copy is no use to them at that point.
 */
export const CONTACT_EMAIL = "support@11pluswords.com";

/**
 * The address as a parent reads it, with the `mailto:` already applied.
 *
 * Kept beside the plain address rather than being the only form, because the plain
 * one has to be readable by eye in the page text and the link one has to survive
 * being the only thing on a line.
 */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
