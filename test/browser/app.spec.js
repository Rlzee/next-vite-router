import { expect, test } from "@playwright/test";

/**
 * The mount-level scenarios, run against BOTH `vite dev` and the production build
 * behind `vite preview`: a route that only works in one of the two pipelines -
 * per-module requests versus real chunks - cannot pass silently.
 *
 * Marker strings (`HOME`, `USER:42`, `SHOP-LAYOUT[`…) come from
 * `test/browser-app/src/app`; they are also what the chunk assertions look for in
 * the built output, so a page must keep its marker literal.
 */

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
  await page.goto("/docs/guide/api");
  await expect(page.getByTestId("docs-page")).toHaveText("DOCS{guide|api}");

  // `[[...seg]]` is optional, so the base is a page rather than a 404.
  await page.goto("/docs");
  await expect(page.getByTestId("docs-page")).toHaveText("DOCS{}");
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

test("a thrown null still renders error.tsx", async ({ page }) => {
  // `throw null` is legal JavaScript. A boundary that stores "no failure" and the
  // captured value in the same field reads it as healthy, renders the failing
  // subtree again, and the folder's `error.tsx` never appears - a mistake only a
  // real mount can show, because `react-dom/server` does not run a class
  // boundary's catch.
  await page.goto("/null-throw");
  await expect(page.getByTestId("null-error")).toContainText("ERROR-IS-NULL");
});
