import { generateRoutes } from "next-vite-router/routes";
import { getRouteStatus, normalizeRequestTarget } from "next-vite-router";

/**
 * Hands the route table this application actually mounted to
 * `test/browser/url-parity.spec.js`, which collides three readings of one URL:
 * what an SSR server decides from the request target it was handed, what
 * Chromium's own URL parser puts in `location.pathname`, and what the mounted app
 * paints after hydration.
 *
 * The comparison only means something over the table the browser really routed -
 * the plugin's generated globs, the handles the conversion stamped, the same lazy
 * components - and a table rebuilt in Node cannot promise that. So the fixture
 * exposes its own instead of being re-derived from the outside.
 *
 * Called once from `main.tsx` (a plain side-effect import could be dropped by a
 * bundling change, and the suite would then silently compare nothing). No page
 * uses it, and no other test reads it.
 */
export function exposeUrlParity(): void {
  window.__urlParity = { generateRoutes, getRouteStatus, normalizeRequestTarget };
}

declare global {
  interface Window {
    __urlParity: {
      generateRoutes: typeof generateRoutes;
      getRouteStatus: typeof getRouteStatus;
      normalizeRequestTarget: typeof normalizeRequestTarget;
    };
  }
}
