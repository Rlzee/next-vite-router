import { expect, test } from "@playwright/test";

/**
 * Dev-server only: the placeholder is a timing behavior, and the dev server is the
 * one pipeline where a single page module can be held back. In the production
 * build the chunks are local and arrive too fast to observe, which is why the
 * `loading.tsx` contract is pinned here instead of in `app.spec.js`.
 */

test("loading.tsx paints while the page module is still on its way", async ({ page }) => {
  let release = () => {};
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/src/app/shop/page.tsx*", async (route) => {
    await held;
    await route.continue();
  });

  await page.goto("/");
  await page.getByTestId("nav-shop").click();

  // The folder's own placeholder answers inside the layout's outlet, and nothing of
  // the page is on screen yet.
  await expect(page.getByTestId("shop-layout")).toContainText("SHOP-LAYOUT[");
  await expect(page.getByTestId("shop-loading")).toBeVisible();
  await expect(page.getByTestId("shop-page")).toHaveCount(0);

  release();

  await expect(page.getByTestId("shop-page")).toContainText("SHOP-PAGE");
  await expect(page.getByTestId("shop-loading")).toHaveCount(0);
});
