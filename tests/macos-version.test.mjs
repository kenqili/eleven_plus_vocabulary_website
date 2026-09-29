// `npm run dev` boots the real Workers runtime, and workerd will not start on
// macOS older than 13.5. Left to Miniflare, that arrives as a stack trace from
// inside a constructor with nothing listening on the port, which reaches the
// browser as a page that cannot load its data. These tests pin the version
// arithmetic and the message, because the path being tested is one that almost
// never runs on a developer's machine and so cannot be checked by using it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MINIMUM_MACOS_VERSION,
  UNSUPPORTED_DEV_MESSAGE,
  darwinVersionToMacOSVersion,
  isVersionLessThan,
  workersRuntimeUnsupported,
} from "../scripts/macos-version.mjs";

test("a Darwin kernel version maps to the macOS version that shipped it", () => {
  // Darwin 21 is macOS 12, Darwin 22 is macOS 13, and the minor version carries
  // over unchanged, so macOS 13.5 and Darwin 22.5 are the same release. The
  // minimum below is therefore exactly one Darwin minor below 22.5, which makes
  // it testable from both sides without a guess.
  assert.equal(darwinVersionToMacOSVersion("21.6.0"), "12.6.0");
  assert.equal(darwinVersionToMacOSVersion("22.4.0"), "13.4.0");
  assert.equal(darwinVersionToMacOSVersion("22.5.0"), "13.5.0");
  assert.equal(darwinVersionToMacOSVersion("22.6.0"), "13.6.0");
  assert.equal(darwinVersionToMacOSVersion("23.5.0"), "14.5.0");
  assert.equal(darwinVersionToMacOSVersion("24.0.0"), "15.0.0");
});

test("a kernel version this code cannot read is left alone, not guessed at", () => {
  // Darwin 19 and older predate the scheme, and an unreadable string is not
  // evidence that the machine is too old.
  for (const value of [
    "19.6.0",
    "18.7.0",
    "",
    "not-a-version",
    null,
    undefined,
  ])
    assert.equal(darwinVersionToMacOSVersion(value), null);
});

test("versions compare numerically rather than as strings", () => {
  // The bug a string comparison has: "9" sorts above "13".
  assert.equal(isVersionLessThan("12.6.0", MINIMUM_MACOS_VERSION), true);
  assert.equal(isVersionLessThan("13.4.9", MINIMUM_MACOS_VERSION), true);
  assert.equal(isVersionLessThan("13.5.0", MINIMUM_MACOS_VERSION), false);
  assert.equal(isVersionLessThan("13.5.1", MINIMUM_MACOS_VERSION), false);
  assert.equal(isVersionLessThan("15.0.0", MINIMUM_MACOS_VERSION), false);
  assert.equal(isVersionLessThan("9.1.0", MINIMUM_MACOS_VERSION), true);
});

test("an unreadable version compares to nothing rather than to false", () => {
  // Returning false here would read as "supported" and wave the machine through.
  assert.equal(isVersionLessThan("13.5", MINIMUM_MACOS_VERSION), null);
  assert.equal(isVersionLessThan("13.5.0", "13.5"), null);
  assert.equal(isVersionLessThan(undefined, MINIMUM_MACOS_VERSION), null);
});

test("a Mac too old for the Workers runtime is refused, and says which version", () => {
  const result = workersRuntimeUnsupported({
    platform: "darwin",
    release: "21.6.0",
    ci: false,
  });
  assert.ok(result, "macOS 12.6 cannot run workerd");
  assert.equal(result.macOS, "12.6.0");
  assert.equal(result.unsupported, true);
  // One Darwin minor below the minimum is still too old.
  const justUnder = workersRuntimeUnsupported({
    platform: "darwin",
    release: "22.4.0",
    ci: false,
  });
  assert.ok(justUnder, "macOS 13.4 cannot run workerd either");
  assert.equal(justUnder.macOS, "13.4.0");
});

test("a Mac new enough for the Workers runtime is allowed through", () => {
  // The minimum itself has to pass, not only things above it: 22.5 is macOS
  // 13.5, which is the exact version workerd requires.
  for (const release of ["22.5.0", "22.6.0", "23.5.0", "24.0.0"])
    assert.equal(
      workersRuntimeUnsupported({ platform: "darwin", release, ci: false }),
      false,
      `macOS from Darwin ${release} is supported`,
    );
});

test("only the real Workers runtime is affected", () => {
  // The Node-backed dev server replaces D1 with SQLite and never loads workerd,
  // so it has to work on a Mac the real runtime refuses.
  assert.equal(
    workersRuntimeUnsupported({
      platform: "darwin",
      release: "21.6.0",
      ci: true,
    }),
    false,
    "CI is exempt, as it is for Miniflare",
  );
  assert.equal(
    workersRuntimeUnsupported({
      platform: "darwin",
      release: "21.6.0",
      ci: false,
    }).macOS,
    "12.6.0",
    "and a local Mac is still checked when not in CI",
  );
});

test("the message names the version and the command that works", () => {
  const message = UNSUPPORTED_DEV_MESSAGE.replace("{macOS}", "12.6.0");
  assert.match(message, /macOS 12\.6\.0/, "names the version actually running");
  assert.match(
    message,
    new RegExp(MINIMUM_MACOS_VERSION.replace(/\./g, "\\.")),
  );
  // The whole point is that the message says what to do instead.
  assert.match(message, /npm run dev:node/);
  assert.doesNotMatch(
    message,
    /\{macOS\}/,
    "no placeholder is left unsubstituted",
  );
});
