import { expect, test } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The plugin watches the pages directory, so a route file that appears has to join
 * the table and one that disappears has to leave it - what a developer feels as
 * "add a page, it works". `test/browser-app/hmr-run` is a private copy of the
 * fixture app served on its own port precisely because a structural change makes
 * the plugin reload every client of that server.
 */

const routesDir = fileURLToPath(new URL("../browser-app/hmr-run/src/app", import.meta.url));
const liveDir = `${routesDir}/hmr-live`;

const PAGE_SOURCE = [
  "export default function HmrLivePage() {",
  '  return <div data-testid="hmr-page">HMR-PAGE</div>;',
  "}",
  "",
].join("\n");

test.beforeEach(async ({ page }) => {
  // A cold dev server re-optimizes its dependencies and reloads the document once.
  // Settle that before touching the file system, so the first assertion below is a
  // warm one.
  await expect
    .poll(
      async () => {
        await page.goto("/").catch(() => {});
        return page.getByTestId("home-page").isVisible().catch(() => false);
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(true);
});

test.afterEach(() => {
  rmSync(liveDir, { recursive: true, force: true });
});

/** Reload `/hmr-live` and report whether the page that only a live route can paint shows. */
async function paintsLiveRoute(page) {
  await page.goto("/hmr-live").catch(() => {});
  return page.getByTestId("hmr-page").isVisible().catch(() => false);
}

test("creating a page file registers its route, deleting it removes the route", async ({ page }) => {
  // Absent to begin with: the built-in 404 answers, which is also the proof the
  // route is not left over from an earlier run.
  await expect(await paintsLiveRoute(page)).toBe(false);
  await expect(page.getByText("This page could not be found")).toBeVisible();

  mkdirSync(liveDir, { recursive: true });
  writeFileSync(`${liveDir}/page.tsx`, PAGE_SOURCE);

  await expect
    .poll(() => paintsLiveRoute(page), {
      timeout: 30_000,
      intervals: [500],
      message: "the new page never joined the route table",
    })
    .toBe(true);
  await expect(page.getByTestId("hmr-page")).toHaveText("HMR-PAGE");

  rmSync(liveDir, { recursive: true, force: true });

  await expect
    .poll(() => paintsLiveRoute(page), {
      timeout: 30_000,
      intervals: [500],
      message: "the removed page kept answering its URL",
    })
    .toBe(false);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});
