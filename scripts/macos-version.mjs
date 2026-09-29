import { release, platform } from "node:os";

/**
 * The macOS version the Cloudflare Workers runtime needs, and how to work out
 * which one this machine is running.
 *
 * `npm run dev` boots the real Workers runtime through Miniflare, and workerd
 * refuses to start on anything older than macOS 13.5. When it refuses, Miniflare
 * throws from inside its own constructor, so the dev server dies before it binds
 * a port and the failure surfaces in the browser as a page that cannot load its
 * data. Nothing about that points at the real cause.
 *
 * These helpers exist so the check can happen first and say what is actually
 * wrong, and so the arithmetic is testable rather than being buried in a
 * startup path that almost never runs on a developer's machine.
 *
 * The mapping is Miniflare's own, kept identical on purpose: it converts a
 * Darwin kernel version to the macOS version that shipped it, and Darwin 20 was
 * the last kernel before the two numbering schemes diverged. Anything below that
 * returns null and is left alone, because a version this code cannot read is not
 * evidence of an unsupported machine.
 */

/** The minimum macOS version workerd will run on. */
export const MINIMUM_MACOS_VERSION = "13.5.0";

/** "21.6.0" -> "12.6.0". Returns null for anything it cannot read. */
export function darwinVersionToMacOSVersion(darwinVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(darwinVersion ?? "");
  if (!match) return null;
  const major = Number(match[1]);
  if (major < 20) return null;
  return `${major - 9}.${Number(match[2])}.${Number(match[3])}`;
}

/** Numeric dotted comparison. Returns null if either side is unreadable. */
export function isVersionLessThan(version, minimum) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? "");
    return match ? match.slice(1).map(Number) : null;
  };
  const left = parse(version),
    right = parse(minimum);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i];
  }
  return false;
}

/**
 * True only when this machine is a macOS that the Workers runtime cannot run.
 *
 * CI is exempt for the same reason Miniflare exempts it: it is not running the
 * Workers runtime locally there, and a developer machine on an older macOS
 * should not have a build break because of the version it is on.
 */
export function workersRuntimeUnsupported(
  current = {
    platform: platform(),
    release: release(),
    ci: Boolean(process.env.CI),
  },
) {
  if (current.platform !== "darwin" || current.ci) return false;
  const macOS = darwinVersionToMacOSVersion(current.release);
  if (!macOS) return false;
  const unsupported = isVersionLessThan(macOS, MINIMUM_MACOS_VERSION);
  // Only truthy when the machine is actually too old. A caller checks this with
  // `if (result)`, so returning the details for a supported Mac as well would
  // refuse every Mac, which is the opposite of what the check is for.
  if (unsupported !== true) return false;
  return { macOS, unsupported: true };
}

export const UNSUPPORTED_DEV_MESSAGE = `This Mac is running macOS ${"{macOS}"}, and the Cloudflare Workers runtime needs macOS ${MINIMUM_MACOS_VERSION} or newer, so "npm run dev" cannot start here.

Use the Node-backed development server instead, which needs no Workers runtime:

  npm run dev:node

It serves the same app on the same port and stores data in a local SQLite file
instead of D1. Everything except the deployed D1 binding behaves identically, and
that is what the integration tests run against.`;
