import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { distPath } from "./vite-cli.js";

/**
 * The mount-level scenarios, run against BOTH `vite dev` and the production build
 * behind `vite preview`: a route that only works in one of the two pipelines -
 * per-module requests versus real chunks - cannot pass silently.
 *
 * Marker strings (`HOME`, `USER:42`, `SHOP-LAYOUT[`…) come from
 * `test/browser-app/src/app`; they are also what the chunk assertions look for in
 * the built output, so a page must keep its marker literal.
 */

/**
 * The request a reader would make for `chunk/page.tsx`, which is the file a
 * stale deploy is simulated by removing: `vite dev` serves the module under its
 * own path, the production build names the emitted chunk after a hash, so the
 * chunk is found by the marker it carries (the same read `build.spec.js` does).
 *
 * @param {string} projectName `dev` or `preview`, from the Playwright project.
 */
function chunkRequest(projectName) {
  if (projectName !== "preview") {
    return "**/src/app/chunk/page.tsx*";
  }

  const assets = readdirSync(distPath("assets")).filter((file) => file.endsWith(".js"));
  const chunk = assets.find(
    (file) => readFileSync(distPath("assets", file), "utf8").includes("CHUNK-PAGE"),
  );
  if (!chunk) {
    throw new Error("no emitted chunk carries CHUNK-PAGE, so there is nothing to remove");
  }
  // The entry holds the eager files (root layout, boundaries), never a page.
  const entry = readFileSync(distPath("index.html"), "utf8").match(/src="\/assets\/([^"]+\.js)"/)?.[1];
  if (chunk === entry) {
    throw new Error("CHUNK-PAGE is in the entry chunk, which would block the whole app");
  }
  return `**/assets/${chunk}`;
}

test("the initial load paints the home page inside the root layout", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-page")).toHaveText("HOME");
  await expect(page.getByTestId("root-layout")).toContainText("ROOT-LAYOUT[");
  await expect(page.getByTestId("root-layout")).toContainText("]ROOT-LAYOUT");
});

test("a Link navigates without a document reload", async ({ page }) => {
  await page.goto("/");
  // A marker on the live document: only a client-side navigation can keep it.
  await page.evaluate(() => {
    document.body.dataset.stayedMounted = "yes";
  });

  await page.getByTestId("nav-user").click();

  await expect(page).toHaveURL(/\/users\/42$/);
  await expect(page.getByTestId("user-page")).toHaveText("USER:42");
  await expect(page.evaluate(() => document.body.dataset.stayedMounted)).resolves.toBe("yes");
});

test("back and forward walk the history", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-user").click();
  await expect(page.getByTestId("user-page")).toHaveText("USER:42");
  await page.getByTestId("nav-docs").click();
  await expect(page.getByTestId("docs-page")).toHaveText("DOCS{guide|api}");

  await page.goBack();
  await expect(page.getByTestId("user-page")).toHaveText("USER:42");
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("home-page")).toHaveText("HOME");

  await page.goForward();
  await expect(page.getByTestId("user-page")).toHaveText("USER:42");
  await page.goForward();
  await expect(page.getByTestId("docs-page")).toHaveText("DOCS{guide|api}");
});

test("a deep URL survives a reload", async ({ page }) => {
  await page.goto("/users/7");
  await expect(page.getByTestId("user-page")).toHaveText("USER:7");

  await page.reload();

  await expect(page.getByTestId("user-page")).toHaveText("USER:7");
  await expect(page.getByTestId("root-layout")).toContainText("ROOT-LAYOUT[");
});

test("an unknown URL renders the built-in 404 inside the layout", async ({ page }) => {
  // The fixture declares no `not-found.tsx` anywhere, so this is the page the
  // converter appends at the root, painted inside the root layout as Next.js does.
  await page.goto("/nowhere-at-all");
  await expect(page.getByText("This page could not be found")).toBeVisible();
  await expect(page.getByTestId("root-layout")).toContainText("ROOT-LAYOUT[");

  // A 404 must not break the application: the shell still navigates.
  await page.getByTestId("nav-home").click();
  await expect(page.getByTestId("home-page")).toHaveText("HOME");
});

test("a catch-all reads its segments, and its base renders the page", async ({ page }) => {
  // One folder declaring its own layout (`docs/[[...seg]]/layout.tsx`) below an
  // optional catch-all, so the base URL is answered inside that layout instead
  // of by a 404 and every deeper URL paints its page through the same shell.
  const cases = [
    ["/docs", ""],
    ["/docs/guide", "guide"],
    ["/docs/guide/api", "guide|api"],
  ];
  for (const [url, segments] of cases) {
    await page.goto(url);
    await expect(page.getByTestId("docs-page")).toHaveText(`DOCS{${segments}}`);
    await expect(page.getByTestId("docs-seg-layout")).toContainText(
      `DOCS-SEG-LAYOUT[DOCS{${segments}}]DOCS-SEG-LAYOUT`,
    );
    await expect(page.getByTestId("root-layout")).toContainText("ROOT-LAYOUT[");
  }

  // Between two URLs of the same catch-all folder the navigation stays
  // client-side, so the shell that mounted on the first is the one still on
  // screen for the second - the index and the splat child share it.
  await page.goto("/docs/guide");
  await page.evaluate(() => {
    document.body.dataset.docsMount = "kept";
  });
  await page.getByTestId("nav-docs").click();
  await expect(page).toHaveURL(/\/docs\/guide\/api$/);
  await expect(page.evaluate(() => document.body.dataset.docsMount)).resolves.toBe("kept");
  await expect(page.getByTestId("docs-page")).toHaveText("DOCS{guide|api}");
});

test("a catch-all link fills the splat from a segment array", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-docs").click();
  await expect(page).toHaveURL(/\/docs\/guide\/api$/);
  await expect(page.getByTestId("docs-page")).toHaveText("DOCS{guide|api}");
});

test("a lazy nested layout paints and its child route still navigates", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-shop").click();

  await expect(page.getByTestId("shop-layout")).toContainText("SHOP-LAYOUT[");
  await expect(page.getByTestId("shop-page")).toContainText("SHOP-PAGE");

  await page.getByTestId("nav-shop-cart").click();
  await expect(page).toHaveURL(/\/shop\/cart$/);
  await expect(page.getByTestId("shop-cart-page")).toHaveText("SHOP-CART");

  await page.goBack();
  await expect(page.getByTestId("shop-page")).toContainText("SHOP-PAGE");
});

test("error.tsx replaces a failing page and reset retries the subtree", async ({ page }) => {
  await page.goto("/broken");
  await expect(page.getByTestId("broken-error")).toContainText("BROKEN-ERROR");
  await expect(page.getByTestId("broken-message")).toHaveText("broken page");
  // The layout above the boundary keeps painting: only the folder's content failed.
  await expect(page.getByTestId("root-layout")).toContainText("ROOT-LAYOUT[");

  // A deterministic failure cannot be reset away: the retry renders the page again,
  // it throws again, and the boundary keeps the fallback on screen.
  await page.getByTestId("broken-reset").click();
  await expect(page.getByTestId("broken-error")).toContainText("BROKEN-ERROR");

  // A transient one can: the folder's `error.tsx` clears the failure condition and
  // `reset()` re-renders the subtree, which then succeeds.
  await page.goto("/flaky");
  await expect(page.getByTestId("flaky-error")).toContainText("FLAKY-ERROR");
  await expect(page.getByTestId("flaky-message")).toHaveText("flaky failure");
  await page.getByTestId("flaky-reset").click();
  await expect(page.getByTestId("flaky-page")).toHaveText("FLAKY-PAGE");
  // The shell above the boundary is the one that survived both passes.
  await expect(page.getByTestId("root-layout")).toContainText("]ROOT-LAYOUT");
});

test("a query-only navigation keeps the caught error, a path change clears it", async ({ page }) => {
  // The boundary's reset key is the pathname (`src/router/boundary.ts`), so this
  // pins which half of the URL it watches. The failure condition is carried by the
  // query here - `dashboard/page.tsx` only throws on `?tab=fail` - which is what
  // makes a screen surviving a tab switch provably stale instead of a fresh catch.
  await page.goto("/dashboard?tab=fail");
  await expect(page.getByTestId("dashboard-error")).toContainText("DASHBOARD-ERROR");
  await expect(page.getByTestId("dashboard-message")).toHaveText("dashboard failure");

  // Same path, other tab: the folder layout really moves, and the screen below it
  // stays exactly where it was.
  await page.getByTestId("tab-ok").click();
  await expect(page).toHaveURL(/\/dashboard\?tab=ok$/);
  await expect(page.getByTestId("dashboard-tab")).toHaveText("ok");
  await expect(page.getByTestId("dashboard-error")).toBeVisible();
  await expect(page.getByTestId("dashboard-page")).toHaveCount(0);

  // And it is the stale screen, not a re-throw: one retry over the same URL paints
  // the healthy tab.
  await page.getByTestId("dashboard-reset").click();
  await expect(page.getByTestId("dashboard-page")).toHaveText("DASHBOARD-PAGE:ok");
  await expect(page.getByTestId("dashboard-error")).toHaveCount(0);

  // Back on the failing tab, so the assertion below cannot be reading a leftover
  // success rather than a boundary that is holding a failure.
  await page.getByTestId("tab-fail").click();
  await expect(page.getByTestId("dashboard-error")).toBeVisible();

  // Another pathname of the same folder, the query left as it was: the key moved,
  // so the screen goes even though the URL still says `tab=fail`.
  await page.getByTestId("tab-settings").click();
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=fail$/);
  await expect(page.getByTestId("dashboard-settings-page")).toHaveText("DASHBOARD-SETTINGS");
  await expect(page.getByTestId("dashboard-error")).toHaveCount(0);

  // The layout above the boundary is the one that never left.
  await expect(page.getByTestId("dashboard-layout")).toContainText("DASHBOARD-LAYOUT[");
});

test("a stale-deploy chunk failure survives reset() and needs a document reload", async ({ page }, testInfo) => {
  // The deployment scenario, in the order a reader meets it: their document came
  // from the previous build, the chunk this lazy route needs is gone, and only
  // the click on the link asks for it. Blocking the request is how a 404 on a
  // removed chunk file is reproduced without rebuilding the bundle.
  const blocked = chunkRequest(testInfo.project.name);

  // A document that loaded fine, so the failure below is a navigation and the
  // shell has to stay alive around it.
  await page.goto("/");
  await page.route(blocked, (route) => route.abort());
  await page.getByTestId("nav-chunk").click();

  // The rejection reaches the folder's `error.tsx` with the browser's own value,
  // and the folder's `loading.tsx` does not stay on screen: the boundary sits
  // outside the `Suspense`, so a chunk that never arrives ends the placeholder
  // instead of leaving one that promised to finish.
  await expect(page.getByTestId("chunk-error")).toContainText("CHUNK-ERROR");
  await expect(page.getByTestId("chunk-loading")).toHaveCount(0);
  await expect(page.getByTestId("chunk-message")).toContainText("dynamically imported module");
  // The shell above the boundary is untouched - only the folder's content failed.
  await expect(page.getByTestId("root-layout")).toContainText("ROOT-LAYOUT[");

  // What a reader does next: retry. `reset()` walks the subtree again and
  // `React.lazy` answers from the rejection it stored, so the same screen paints
  // - the limit the unit suite pins on the lifecycle, proven on a real mount.
  await page.getByTestId("chunk-reset").click();
  await expect(page.getByTestId("chunk-error")).toContainText("CHUNK-ERROR");

  // And it stays true once the file is back on the server, which is exactly the
  // moment a reader hits this: the retry inside this document cannot ask for it.
  await page.unroute(blocked);
  await page.getByTestId("chunk-reset").click();
  await expect(page.getByTestId("chunk-error")).toContainText("CHUNK-ERROR");

  // Neither does leaving the route and coming back to it, now that the chunk is
  // reachable again: the memoized rejection belongs to the document, not to the
  // route that caught it.
  await page.getByTestId("nav-home").click();
  await expect(page.getByTestId("home-page")).toHaveText("HOME");
  await page.getByTestId("nav-chunk").click();
  await expect(page.getByTestId("chunk-error")).toContainText("CHUNK-ERROR");
  await expect(page.getByTestId("chunk-page")).toHaveCount(0);

  // The documented way out is the one that replaces the document.
  const reloaded = page.waitForLoadState("load");
  await page.getByTestId("chunk-reload").click();
  await reloaded;
  await expect(page.getByTestId("chunk-page")).toHaveText("CHUNK-PAGE");
  await expect(page.getByTestId("chunk-error")).toHaveCount(0);
});

test("a thrown null still renders error.tsx", async ({ page }) => {
  // `throw null` is legal JavaScript. A boundary that stores "no failure" and the
  // captured value in the same field reads it as healthy, renders the failing
  // subtree again, and the folder's `error.tsx` never appears - a mistake only a
  // real mount can show, because `react-dom/server` does not run a class
  // boundary's catch.
  await page.goto("/null-throw");
  await expect(page.getByTestId("null-error")).toContainText("ERROR-IS-NULL");
});
