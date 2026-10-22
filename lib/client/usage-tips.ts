import tips from "../../data/tips/usage-tips.json" with { type: "json" };

/**
 * The tips a parent is shown, one at a time, while their child practises.
 *
 * They live in a data file because they are content, not behaviour: a parent
 * tip is a sentence, and the sentences change far more often than the rule
 * for when to show them.
 *
 * Each tip is something the app can actually do. A tip that points at a
 * feature that is not there teaches a parent to ignore the banner.
 */
export type UsageTip = {
  id: string;
  /** The headline. Short enough to read at a glance. */
  title: string;
  /** The tip itself, in a sentence or two. */
  text: string;
  /** Where to go, when there is somewhere to go. */
  href?: string;
  /** What the link says. */
  linkText?: string;
  /**
   * True when the tip only makes sense with paid access.
   *
   * Printing and exporting are member features, so a family on the free
   * collection is not shown a tip about them.
   */
  needsAccess?: boolean;
};

export const USAGE_TIPS = tips as UsageTip[];

/**
 * How many questions a child answers before a tip appears.
 *
 * Not before the first one: a parent reading a banner while their child is
 * still finding the buttons is a parent not reading it. And not many: by the
 * fourth answer the routine is established and there is a natural pause.
 */
export const TIP_AFTER_ANSWERS = 2;

/** Where the seen tips are kept, in this browser. */
const SEEN_KEY = "minewords.usage-tips.seen";

/**
 * The first tip this family has not been shown.
 *
 * A tip is shown once. A parent who has read it does not need it again, and
 * a banner that repeats itself is a banner that gets ignored — which costs
 * every later tip its readership too.
 */
export function nextTip(seen: readonly string[]): UsageTip | null {
  return USAGE_TIPS.find((tip) => !seen.includes(tip.id)) ?? null;
}

/**
 * The tips this browser has already been shown.
 *
 * Read defensively: the storage may be empty, unavailable, or hold something
 * another version of the app wrote. A tip is a nicety, and none of these
 * failures should be able to break a practice session.
 */
export function readSeenTips(): string[] {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Remember that a tip has been shown, so it is not shown again. */
export function rememberTip(id: string): void {
  try {
    const seen = readSeenTips();
    if (seen.includes(id)) return;
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id]));
  } catch {
    // A browser with storage turned off shows the tip again. That is the
    // right way round: a repeated tip is a small annoyance, and a tip that
    // never appears is a wasted one.
  }
}
