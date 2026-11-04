import { matchRoutes, type RouteObject } from "react-router-dom";

/**
 * The `handle` this package stamps on every route it generates that renders a
 * not-found page - the built-in root 404, a folder's `not-found.tsx`, and the two
 * base guards. It is the answer to a question the emitted shape cannot ask on its
 * own: a `path: "*"` route is used both by a not-found page and by a
 * `[...slug]` **page**, and a folder whose base renders a not-found is a guard
 * `index` route - the same shape a real `page.tsx` at that base produces. No
 * reading of the route tree can separate those, because by then they are the same
 * thing; only the conversion knows, so it records it here.
 *
 * `handle` is a React Router field meant for exactly this kind of static route
 * data, and the converter builds every route object in a generated tree, so an
 * application has no other way to set it. Reading it through
 * {@link isNotFoundRoute} rather than directly keeps the check honest about the
 * type: React Router declares `handle` as unknown.
 */
export type RouteNotFoundHandle = { notFound: true };

/** The value stamped on every not-found route. */
export const NOT_FOUND_ROUTE_HANDLE: RouteNotFoundHandle = { notFound: true };

/**
 * `true` when `route` is one of the routes this package generates to answer a URL
 * that reaches no page. Use it on a match you already have; {@link isUnmatched}
 * does the matching for you.
 */
export function isNotFoundRoute(route: { handle?: unknown }): boolean {
  const handle = route.handle;
  return typeof handle === "object"
    && handle !== null
    && (handle as Partial<RouteNotFoundHandle>).notFound === true;
}

/**
 * Whether a URL is answered by a not-found page rather than by one of the app's
 * own pages - the decision an SSR entry needs in order to send a real `404`.
 *
 * Since 4.0.0 a root `*` route answers every URL that reaches no page, so
 * `matchRoutes()` no longer returns `null` and the stale `if (!matches)` check
 * serves `200` for an unknown path. This reads what the conversion recorded
 * instead of what the route shape happens to look like, so it is right where a
 * shape test cannot be: a `[...slug]` page keeps its `200` even though its leaf
 * is a splat, a folder's own `not-found.tsx` and a base folder that holds no page
 * are reported as `404` even though their leaves look like any other index or splat.
 *
 * Case sensitivity comes for free, because the routes carry the flag the converter
 * stamped: with the default on, `/USERS` answers no `users/` folder and is
 * therefore unmatched - what Next.js does too.
 *
 * @param routes the array to match against - `generateRoutes()`, or your own
 *               `treeToRoutes()` result
 * @param url    the request URL (`pathname`); a full href works too
 */
export function isUnmatched(routes: RouteObject[], url: string): boolean {
  const matches = matchRoutes(routes, url);
  // Still worth honouring: a caller may hand a partial tree, or one built without
  // this package's conversion, and then `null` means what it always meant.
  if (!matches) return true;
  return isNotFoundRoute(matches[matches.length - 1].route);
}
