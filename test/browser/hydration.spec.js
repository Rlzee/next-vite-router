import assert from "node:assert/strict";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, expect } from "@playwright/test";
import { build } from "vite";
import { appDir } from "./vite-cli.js";
import { buildElement } from "../browser-app/src/hydration-fixture.js";
import { createRenderOutcome, isNotFoundSignal } from "../../dist/plugin-runtime.js";

/**
 * I17: a document streamed for `notFound()` hydrates without a recoverable or
 * mismatch error.
 *
 * The server side is the real boundary path: a recorded outcome makes the
 * boundary paint the owning fallback in pass 2. The client side is the other
 * real path: the boundary catches the signal thrown by the page and paints the
 * same fallback. The page is eager here so the only variable is the boundary's
 * transition, not the Suspense boundary above it.
 */
test("a notFound() fallback document hydrates without a mismatch", async ({ page }) => {
  const outcome = createRenderOutcome({ pathname: "/gone", search: "", hash: "" });
  assert.throws(
    () => renderToStaticMarkup(buildElement(outcome)),
    (error) => isNotFoundSignal(error),
    "pass 1 must record the signal and abort",
  );
  const html = renderToStaticMarkup(buildElement(outcome));
  assert.match(html, /GONE-NOT-FOUND/, "pass 2 must paint the fallback");

  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setContent(
    `<!doctype html><html><body><div id="root">${html}</div></body></html>`,
  );
  await page.addScriptTag({ content: await clientBundle() });
  await page.waitForFunction(() => window.__hydrated === true);

  await expect(page.getByTestId("gone-not-found")).toHaveText("GONE-NOT-FOUND");
  await expect(page.getByTestId("root-layout")).toContainText("GONE-NOT-FOUND");

  const hydrationErrors = errors.filter((message) =>
    /hydrat|mismatch|recoverable|did not match/i.test(message));
  expect(hydrationErrors, hydrationErrors.join("\n")).toEqual([]);
});

/**
 * The client entry, bundled once: React, the boundary engine and the fixture are
 * resolved by Vite from the same app the browser suite serves, so the hydration
 * runs against the shipped `dist`, not a copy of the boundary.
 */
async function clientBundle() {
  const result = await build({
    configFile: false,
    root: appDir,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: path.join(appDir, "src/hydration-entry.js"),
        output: {
          format: "iife",
          entryFileNames: "hydration.js",
          inlineDynamicImports: true,
        },
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  return output.output[0].code;
}