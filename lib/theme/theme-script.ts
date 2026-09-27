import { createHash } from "node:crypto";
import { THEMES, THEME_STORAGE_KEY } from "./themes.ts";

export { THEME_STORAGE_KEY };

/**
 * The script that applies a saved theme before the first paint.
 *
 * A child's theme is a small thing to ask them to choose twice, so it is read
 * here, inline and early, rather than in an effect after first paint. Without
 * it the page renders in the default colours and then snaps to the chosen ones,
 * which is jarring on a dark theme.
 *
 * Both interpolated values are JSON-encoded rather than concatenated, so a theme
 * id could not break out of the string even if one were ever attacker-supplied.
 * The lookup is an allowlist membership test, not an assignment: an unknown
 * value from an older version, a tampered localStorage, or a hand-edited entry
 * simply does nothing.
 */
export const APPLY_SAVED_THEME = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(t&&${JSON.stringify(THEMES.map((theme) => theme.id))}.indexOf(t)>-1){
document.documentElement.setAttribute("data-theme",t);
}}catch(e){}})();`;

/**
 * The SHA-256 of that exact string, base64, which is the form a
 * Content-Security-Policy script-src hash takes.
 *
 * It is computed from the script rather than written out by hand, so editing the
 * script changes the hash and the policy stops matching. A hand-copied hash
 * would go stale silently, and a policy that falls back to `unsafe-inline`
 * because its hash broke is worse than no policy at all.
 */
export const THEME_SCRIPT_HASH = createHash("sha256")
  .update(APPLY_SAVED_THEME)
  .digest("base64");
