import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { distPath } from "./vite-cli.js";

/**
 * `lazyLayouts` is a build-time promise - one chunk per layout - and only the
 * production bundle can show it. The dev server serves every module separately,
 * so asking it would prove nothing.
 */

/** The asset path `dist/index.html` loads as its module entry. */
function entryAsset() {
  const html = readFileSync(distPath("index.html"), "utf8");
  const match = html.match(/src="(\/assets\/[^"]+\.js)"/);
  if (!match) {
    throw new Error(`the built index.html loads no module script:\n${html}`);
  }
  return match[1];
}

test("lazyLayouts keeps a nested layout out of the entry chunk", async ({ page }) => {
  const entry = entryAsset();
  const entrySource = readFileSync(distPath(entry.slice(1)), "utf8");

  // The root shell is deliberately eager (a lazy root would suspend outside every
  // boundary), so its marker belongs in the entry...
  expect(entrySource).toContain("ROOT-LAYOUT");
  // ...while `shop`'s layout has to live in another chunk.
  expect(entrySource).not.toContain("SHOP-LAYOUT");

  const siblings = readdirSync(distPath("assets")).filter(
    (file) => file.endsWith(".js") && `/assets/${file}` !== entry,
  );
  expect(
    siblings.some((file) =>
      readFileSync(distPath("assets", file), "utf8").includes("SHOP-LAYOUT"),
    ),
    "no emitted chunk other than the entry carries the shop layout",
  ).toBe(true);

  // The split is only useful if the chunk then arrives: the browser paints the
  // lazy shell and its page.
  await page.goto("/shop");
  await expect(page.getByTestId("shop-layout")).toContainText("SHOP-LAYOUT[");
  await expect(page.getByTestId("shop-page")).toContainText("SHOP-PAGE");
});
