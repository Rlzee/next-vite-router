import { expect, test } from "@playwright/test";
import { normalizeRequestTarget } from "../../dist/index.js";
import { CASES, NOT_FOUND } from "./url-parity-cases.js";

/**
 * The differential battery between the three readings of one request target:
 *
 *   1. `normalizeRequestTarget()` in Node, which is what an SSR server decides
 *      from `req.url` before it commits a status;
 *   2. `location.pathname` in Chromium, which is what the browser resolved, sent,
 *      and then let its own router match;
 *   3. the document the mounted application paints, which *is* `matchRoutes()`
 *      having run through `useRoutes` on the table the plugin generated.
 *
 * Every case hand-writes all three, so the readings collide instead of agreeing
 * with each other: this package's answer, a real browser's URL parser - another
 * implementation of the same spec as Node's - and the rendered page cannot drift
 * apart without one assertion below failing against the corpus rather than
 * against the library. The pairing that matters for SSR is the last one: what the
 * server calls `200` has to paint a page after hydration, and what it calls
 * `404` has to paint the 404 there too. Either drifting alone is a document
 * streamed as one page and rendered as another.
 *
 * See `url-parity-cases.js` for the inputs left out, and for the one server
 * limitation that closes a case in a single pipeline.
 */
for (const testCase of CASES) {
  const title = `${testCase.target} - ${testCase.status} and ${testCase.notFound ? "the 404 page" : testCase.text}`;

  test(title, async ({ page }, testInfo) => {
    const skip = testCase.skipIn?.[testInfo.project.name];
    test.skip(!!skip, skip ?? "");

    // Reading 1, in Node, over the bundle an SSR entry imports.
    expect(
      normalizeRequestTarget(testCase.target),
      "what this package's server-side reading makes of the target",
    ).toBe(testCase.pathname);

    await page.goto(testCase.target);

    // Readings 2 and 3, inside the page, over the route table the app mounted.
    const outcome = await page.evaluate((target) => {
      const { generateRoutes, getRouteStatus } = window.__urlParity;
      const routes = generateRoutes();
      return {
        pathname: window.location.pathname,
        forTarget: getRouteStatus(routes, target),
        forPathname: getRouteStatus(routes, window.location.pathname),
        forHref: getRouteStatus(routes, window.location.href),
      };
    }, testCase.target);

    expect(outcome.pathname, "Chromium's own location.pathname").toBe(testCase.pathname);
    expect(outcome.forTarget, "the status decided on the raw request target").toBe(testCase.status);
    expect(outcome.forPathname, "the same rule on the browser's pathname").toBe(testCase.status);
    expect(outcome.forHref, "the same rule on the absolute href").toBe(testCase.status);

    // And the document the client router settled on says what the status said.
    // Pages arrive through `React.lazy`, so this waits for the chunk to land.
    const notFound = page.getByText(NOT_FOUND);
    if (testCase.notFound) {
      await expect(notFound).toBeVisible();
    } else {
      await expect(page.getByTestId(testCase.testid)).toContainText(testCase.text);
      await expect(notFound).toHaveCount(0);
    }
    // Both answers stay inside the shell, which is what makes them comparable.
    await expect(page.getByTestId("root-layout")).toContainText("ROOT-LAYOUT[");
  });
}
