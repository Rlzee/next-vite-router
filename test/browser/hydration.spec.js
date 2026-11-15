import assert from "node:assert/strict";
import path from "node:path";
import { PassThrough } from "node:stream";
import React from "react";
import { renderToStaticMarkup, renderToPipeableStream } from "react-dom/server";
import { test, expect } from "@playwright/test";
import { build } from "vite";
import { appDir } from "./vite-cli.js";
import { buildElement, buildRoutes } from "../browser-app/src/hydration-fixture.js";
import { createRenderOutcome, isNotFoundSignal } from "../../dist/plugin-runtime.js";
import { renderResponse } from "../../dist/ssr.js";

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

test("a renderResponse document hydrates without a recoverable error", async ({ page }) => {
  // The strict I17 case: the HTML is the one `renderResponse` actually streams -
  // pass 1 records the signal, pass 2 paints the fallback, and the sink collects
  // the pipeable stream. Hydrating it must not report a recoverable error.
  const adapter = collector();
  const plan = await renderResponse({
    routes: buildRoutes(),
    url: "/gone",
    adapter,
    render: nodeEngine,
    streaming: false,
  });
  assert.equal(plan.kind, "not-found");
  assert.equal(adapter.status, 404);
  assert.equal(adapter.failed, null);
  assert.match(adapter.body, /GONE-NOT-FOUND/);

  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setContent(
    `<!doctype html><html><body><div id="root">${adapter.body}</div></body></html>`,
  );
  await page.addScriptTag({ content: await clientBundle() });
  await page.waitForFunction(() => window.__hydrated === true);

  await expect(page.getByTestId("gone-not-found")).toHaveText("GONE-NOT-FOUND");
  const recoverable = await page.evaluate(() => window.__recoverable);
  expect(recoverable, recoverable.join("\n")).toEqual([]);
  const hydrationErrors = errors.filter((message) =>
    /hydrat|mismatch|recoverable|did not match/i.test(message));
  expect(hydrationErrors, hydrationErrors.join("\n")).toEqual([]);
});

/**
 * The Node engine the package's `RenderEngine` describes: `renderToPipeableStream`
 * buffers until `pipe()`, and the callbacks are forwarded verbatim. A signal in
 * the shell settles both promises, because the protocol owns it.
 */
function nodeEngine(element, callbacks) {
  let resolveShell;
  let resolveAll;
  const shellReady = new Promise((resolve) => { resolveShell = resolve; });
  const allReady = new Promise((resolve) => { resolveAll = resolve; });
  const rendered = renderToPipeableStream(element, {
    onShellReady() {
      callbacks.onShellReady();
      resolveShell();
    },
    onAllReady() {
      callbacks.onAllReady();
      resolveAll();
    },
    onShellError(error) {
      callbacks.onShellError(error);
      resolveShell();
      resolveAll();
    },
    onError(error) {
      callbacks.onError(error);
    },
  });
  return {
    pipeTo(sink) { rendered.pipe(sink); },
    stream: null,
    abort() { rendered.abort(); },
    shellReady,
    allReady,
  };
}

function collector() {
  let status = 0;
  let headers = new Headers();
  let body = "";
  let failed = null;
  return {
    head(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = nextHeaders;
    },
    async send(attempt) {
      await new Promise((resolve, reject) => {
        const sink = new PassThrough();
        sink.setEncoding("utf8");
        sink.on("data", (chunk) => { body += chunk; });
        sink.on("finish", resolve);
        sink.on("error", reject);
        attempt.pipeTo(sink);
      });
    },
    abandon(attempt) {
      attempt.abort();
    },
    fail(nextStatus, error) {
      failed = { status: nextStatus, error };
    },
    get status() { return status; },
    get headers() { return headers; },
    get body() { return body; },
    get failed() { return failed; },
  };
}

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