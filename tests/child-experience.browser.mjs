const { chromium, webkit } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
const root = process.cwd(),
  origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
if (
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname) ||
  !process.env.TEST_NODE_DB
)
  throw Error("Use a local preview and set TEST_NODE_DB.");
const engine = process.env.TEST_BROWSER === "webkit" ? webkit : chromium;
const browser = await engine.launch({
  headless: true,
  ...(engine === chromium && process.env.TEST_CHROME_EXECUTABLE
    ? { executablePath: process.env.TEST_CHROME_EXECUTABLE }
    : {}),
});
const db = new DatabaseSync(process.env.TEST_NODE_DB);
db.exec("PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000");
let user;
const errors = [];
mkdirSync(root + "/outputs/child-experience", { recursive: true });
try {
  const bootstrap = await browser.newContext();
  const r = await bootstrap.request.post(origin + "/api/auth/register", {
    headers: { Origin: origin },
    data: {
      email: `child-browser-${randomUUID()}@example.test`,
      password: `Test-only-${randomUUID()}`,
    },
  });
  assert.equal(r.status(), 200);
  user = (await r.json()).user.id;
  const storageState = await bootstrap.storageState();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    storageState,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.locator(".answer").first().waitFor();
  assert.ok(
    await page
      .getByRole("link", { name: "0 of 20 questions tried. Go to practice." })
      .isVisible(),
  );
  await page
    .getByRole("button", { name: "Give me a clue", exact: true })
    .click();
  assert.ok(await page.getByText("A clue:", { exact: true }).isVisible());
  assert.equal(await page.locator(".answer:disabled").count(), 0);
  assert.equal(
    await page.getByLabel("Next word", { exact: true }).inputValue(),
    "0",
    "manual pacing is the default",
  );
  await page.getByLabel("Next word", { exact: true }).selectOption("5");
  async function correct() {
    const pending = db
      .prepare(
        "SELECT id,answer FROM attempts WHERE user_id=? AND answered_at IS NULL",
      )
      .get(user);
    await page.locator(".answer").filter({ hasText: pending.answer }).click();
    await page.locator(".feedback").waitFor();
  }
  await correct();
  await page.getByRole("button", { name: "Stay here", exact: true }).click();
  await page.waitForTimeout(5400);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM attempts WHERE user_id=? AND answered_at IS NULL",
      )
      .get(user).n,
    0,
    "Stay here prevents auto-next",
  );
  await page.getByRole("button", { name: "Next word", exact: true }).click();
  await page.locator(".answer:not(:disabled)").first().waitFor();
  await correct();
  await page
    .getByRole("button", { name: /^Hear .+ pronounced in British English$/ })
    .click();
  await page.waitForTimeout(5400);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM attempts WHERE user_id=? AND answered_at IS NULL",
      )
      .get(user).n,
    0,
    "pronunciation prevents auto-next",
  );
  await page.getByRole("button", { name: "Next word", exact: true }).click();
  await page.locator(".answer:not(:disabled)").first().waitFor();
  await correct();
  await page
    .locator(".feedback summary")
    .getByText("More word help", { exact: true })
    .click();
  await page.waitForTimeout(5400);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM attempts WHERE user_id=? AND answered_at IS NULL",
      )
      .get(user).n,
    0,
    "More word help prevents auto-next",
  );
  await page.getByRole("button", { name: "Next word", exact: true }).click();
  await page.locator(".answer:not(:disabled)").first().waitFor();
  await correct();
  await page
    .locator(".answer:not(:disabled)")
    .first()
    .waitFor({ timeout: 10000 });
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM attempts WHERE user_id=? AND answered_at IS NULL",
      )
      .get(user).n,
    1,
    "five-second auto-next advances",
  );

  await page.getByLabel("Next word", { exact: true }).selectOption("10");
  await correct();
  await page.waitForTimeout(6000);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM attempts WHERE user_id=? AND answered_at IS NULL",
      )
      .get(user).n,
    0,
    "ten-second pacing waits beyond six seconds",
  );
  await page
    .locator(".answer:not(:disabled)")
    .first()
    .waitFor({ timeout: 7000 });
  db.prepare(
    "UPDATE daily_stats SET questions=19,reveals=0 WHERE user_id=? AND day=?",
  ).run(
    user,
    (await (await context.request.get(origin + "/api/mission")).json()).mission
      .day,
  );
  await page.getByLabel("Next word", { exact: true }).selectOption("5");
  await correct();
  await page
    .getByRole("link", { name: "20 of 20 questions tried. Go to practice." })
    .waitFor();
  await page.waitForTimeout(5400);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM attempts WHERE user_id=? AND answered_at IS NULL",
      )
      .get(user).n,
    0,
    "daily goal pauses automatic advancement",
  );
  await page.goto(origin + "/stories");
  await page.locator(".story-card").first().waitFor();
  await page
    .getByRole("button", { name: "Level 3 · Intermediate", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".story-levels button[aria-pressed=true]")
      ?.textContent.includes("Level 3"),
  );
  await page.goto(origin + "/stories/level-3-03");
  await page.locator(".story-prose").waitFor();
  await page.waitForTimeout(400);
  await page
    .locator('[data-reading-paragraph="2"]')
    .evaluate((e) =>
      scrollTo(0, scrollY + e.getBoundingClientRect().top - 100),
    );
  let savedParagraph;
  for (let attempt = 0; attempt < 24; attempt++) {
    savedParagraph = (
      await (
        await context.request.get(origin + "/api/stories?id=level-3-03")
      ).json()
    ).bookmark?.paragraph;
    if (savedParagraph === 2) break;
    await page.waitForTimeout(500);
  }
  assert.equal(savedParagraph, 2, "phone bookmark reaches the server");
  const second = await browser.newContext({
    viewport: { width: 834, height: 1194 },
    hasTouch: true,
    isMobile: true,
    storageState,
  });
  const ipad = await second.newPage();
  ipad.on("pageerror", (e) => errors.push(e.message));
  await ipad.goto(origin + "/stories");
  await ipad.locator(".story-card").first().waitFor();
  assert.equal(
    await ipad
      .getByRole("button", { name: "Level 3 · Intermediate", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await ipad
    .locator(".continue-reading")
    .getByRole("link", { name: "Continue reading →" })
    .click();
  await ipad.locator(".story-prose").waitFor();
  await ipad.waitForTimeout(600);
  const top = await ipad
    .locator('[data-reading-paragraph="2"]')
    .evaluate((e) => e.getBoundingClientRect().top);
  const metrics = await ipad.evaluate(() => ({
    scroll: scrollY,
    max: document.documentElement.scrollHeight - innerHeight,
  }));
  await ipad.screenshot({
    path:
      root +
      `/outputs/child-experience/${process.env.TEST_BROWSER || "chromium"}-ipad-resume.png`,
  });

  assert.ok(
    Math.abs(top - 100) < 50 ||
      (Math.abs(metrics.scroll - metrics.max) < 3 && top >= 100 && top < 1194),
    `paragraph restored on iPad at ${top}`,
  );
  await ipad.getByRole("button", { name: "Start again", exact: true }).click();
  await ipad.waitForTimeout(200);
  assert.ok(
    await ipad
      .locator('[data-reading-paragraph="0"]')
      .evaluate((e) => Math.abs(e.getBoundingClientRect().top - 100) < 25),
  );
  await page.goto(origin + "/stories/level-1-01");
  await page.locator(".story-word").first().waitFor();
  await page.waitForTimeout(450);
  await page.bringToFront();
  const beforeClock = await page.getByRole("timer").innerText();
  await page.waitForTimeout(2200);
  assert.notEqual(
    await page.getByRole("timer").innerText(),
    beforeClock,
    "reading clock ticks by seconds",
  );
  await page.screenshot({
    path:
      root +
      `/outputs/child-experience/${process.env.TEST_BROWSER || "chromium"}-reader-phone.png`,
  });
  const opening = await page.locator(".story-prose").boundingBox();
  assert.ok(opening.y < 700, `story opening is visible: ${opening.y}`);
  await page.locator(".story-word").first().tap();
  const help = page.getByRole("dialog", { name: "Help with enterprise" });
  await help.waitFor();
  assert.match(await help.innerText(), /Maya’s pet-rock shop/);
  const bounds = await help.boundingBox();
  assert.ok(
    bounds.x >= 0 &&
      bounds.x + bounds.width <= 391 &&
      bounds.y >= 0 &&
      bounds.y + bounds.height <= 845,
  );
  const voiceButton = help.getByRole("button", {
    name: "Hear enterprise pronounced in British English",
  });
  const audioManifest = await (
    await context.request.get(origin + "/audio/vocabulary/manifest.json")
  ).json();
  assert.ok(audioManifest.words.enterprise, "British audio is generated");
  await voiceButton.click();
  await help.getByText("Playing…", { exact: true }).waitFor();
  await help.getByText("Hear this word", { exact: true }).waitFor();
  await page.route("**/audio/vocabulary/*.mp3*", (route) => route.abort());
  await voiceButton.click();
  await help
    .getByText("Couldn’t play that word. Tap Hear this word to retry.")
    .waitFor();
  await page.unroute("**/audio/vocabulary/*.mp3*");
  await voiceButton.click();
  await help.getByText("Playing…", { exact: true }).waitFor();
  await help.getByText("More word help", { exact: true }).click();
  assert.match(await help.innerText(), /undertaking/);
  await page.waitForTimeout(150);
  const expanded = await help.boundingBox();
  assert.ok(
    expanded.y + expanded.height <= 845,
    "expanded word help stays in viewport",
  );
  await page.keyboard.press("Escape");
  assert.equal(await help.count(), 0);
  await page.screenshot({
    path:
      root +
      `/outputs/child-experience/${process.env.TEST_BROWSER || "chromium"}-reader-after-help.png`,
  });
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [834, 1194],
    [1024, 768],
    [1194, 834],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    for (const path of [
      "/",
      "/stories",
      "/stories/level-1-01",
      "/rewards",
      "/words",
    ]) {
      await page.goto(origin + path, { waitUntil: "networkidle" });
      const ready =
        path === "/"
          ? ".answer"
          : path === "/stories"
            ? ".story-card"
            : path.startsWith("/stories/")
              ? ".story-prose"
              : path === "/rewards"
                ? ".badge-card"
                : ".word-table";
      await page.locator(ready).first().waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${path} overflow at ${width}`,
      );
    }
    console.log(`PASS layout ${width}x${height}`);
  }
  await page.goto(origin + "/rewards");
  await page.getByText("total credits earned", { exact: false }).waitFor();
  assert.equal(await page.locator(".badge-uncollected").count(), 3);
  assert.ok(
    await page.getByText("Badge receipts", { exact: true }).isVisible(),
  );
  assert.deepEqual(errors, []);
  await second.close();
  await context.close();
  await bootstrap.close();
  console.log(`${process.env.TEST_BROWSER || "chromium"} ${browser.version()}`);
  console.log(
    "PASS child journeys: clues, pacing, synced levels/bookmarks, restart, word help, compact reader, badge collection and 35 responsive page checks.",
  );
} finally {
  await browser.close();
  if (user) db.prepare("DELETE FROM users WHERE id=?").run(user);
  db.close();
}
