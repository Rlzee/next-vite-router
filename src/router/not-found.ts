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
 * The dummy origin `normalizeRequestTarget` resolves a bare path against. It is
 * never sent anywhere; it only gives relative input a frame of reference, the way
 * the current page does in a browser.
 */
const ORIGIN = "http://next-vite-router.invalid/";

/** An absolute request target, in the one two forms a server can be handed. */
const HTTP_ABSOLUTE = /^https?:\/\//i;

/**
 * A percent escape that does not form valid UTF-8: `%zz` (not hex at all), `%FF`
 * (valid hex, undecodable), `%C0%AF` (overlong), `%ED%A0%80` (a lone surrogate).
 */
function isUndecodable(path: string): boolean {
  if (!path.includes("%")) return false;
  try {
    decodeURIComponent(path);
    return false;
  } catch {
    // React Router decodes params the same way and Node prints a warning while
    // doing it, so a scanner walking these paths would add lines to the server log
    // for every probe. Handing it back is the whole point of this predicate.
    return true;
  }
}

/** A leading `scheme:` - whatever it turns out to name, it is not an origin-form path. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Reduce anything a server may hand over to the pathname React Router should
 * match - the same value a browser would put in `location.pathname`.
 *
 * The accepted input is an HTTP request target, which is what an SSR server is
 * asked to answer:
 *
 * - origin-form (`/users/123`), with or without a `?query` and a `#fragment`;
 * - absolute-form (`https://host/users/123`) - what a proxy forwards and what a
 *   `new URL(req.url)` readback gives - for `http` and `https` only.
 *
 * For those the authority (host, credentials, port), the query and the fragment are
 * dropped and `.`/`..` segments resolved, so the server reaches the same leaf the
 * browser would. Anything else is handed to React Router as it arrived, because
 * reading it as a path on *this* origin would invent a page no client can reach
 * under that name: `ftp://example.com/users/123`, `file:///C:/users/123`,
 * `mailto:` and `javascript:` are not requests, and a `//host/path` - an href
 * shortcut in a document, not a request target - is a path that genuinely begins
 * with two slashes. All of them answer no route, which is the honest `404`.
 *
 * A trailing slash is deliberately kept: the browser keeps it, the client router
 * sees it, and dropping it here would make the server decide with a different URL
 * than the client renders.
 *
 * A pathname whose escapes are not valid UTF-8 (`/users/%FF`, an overlong
 * `%C0%AF`, a lone surrogate `%ED%A0%80`) is also left alone, hex escapes and all:
 * such a path can address a real page - a `[...slug]` or `[id]` route takes it
 * verbatim, which is what the client's router does with it - so there is nothing to
 * clean up here. Matching it makes React Router warn while it decodes the param,
 * and that warning is the router's, raised against a page that exists; hiding it by
 * answering 404 would be a wrong answer bought with a quiet log.
 */
export function normalizeRequestTarget(url: string): string {
  // A path that cannot be decoded never goes through the URL parser, which warns on
  // stderr reading it - but it is not rewritten either, because it can address a
  // real page whose params the router takes verbatim. An absolute target still has
  // to lose its authority, so that is cut by hand here.
  if (isUndecodable(withoutSuffix(url))) {
    if (!HTTP_ABSOLUTE.test(url)) return url;
    const path = withoutSuffix(url.replace(/^https?:\/\/[^/?#]*/i, ""));
    return path.startsWith("/") ? path : "/";
  }

  // Absolute-form: the authority carries no routing information for this app.
  if (HTTP_ABSOLUTE.test(url)) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  if (url.startsWith("//")) return withoutSuffix(url);

  // A scheme that is not `http` or `https`, but not a bare path either.
  if (SCHEME.test(url) && !url.startsWith("?") && !url.startsWith("#")) return url;

  try {
    return new URL(url.startsWith("/") ? url : `/${url}`, ORIGIN).pathname;
  } catch {
    return url;
  }
}

/** Everything before the first `?` or `#`. */
function withoutSuffix(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
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
 * `url` may be a pathname, a path with a query or fragment, or a full absolute URL;
 * it goes through {@link normalizeRequestTarget} first, so all three decide on the
 * same pathname the browser would route.
 *
 * The answer comes out of the route table and nothing else: a URL a page of yours
 * can take - including one whose percent escapes React Router cannot decode, and
 * one that begins with two slashes - is a page, and is not reported as a 404 to
 * keep a log tidy.
 *
 * @param routes the array to match against - `generateRoutes()`, or your own
 *               `treeToRoutes()` result
 * @param url    the request target: `pathname`, with or without query and fragment,
 *               or an absolute URL
 */
export function isUnmatched(routes: RouteObject[], url: string): boolean {
  const matches = matchRoutes(routes, normalizeRequestTarget(url));
  // Still worth honouring: a caller may hand a partial tree, or one built without
  // this package's conversion, and then `null` means what it always meant.
  if (!matches) return true;
  return isNotFoundRoute(matches[matches.length - 1].route);
}

/**
 * What an HTTP response for this URL should say: `200` when one of the app's pages
 * answers it, `404` when a not-found page does (or when nothing matches at all).
 *
 * The point of exposing the status rather than only the boolean is that a server
 * should never have to know *how* a not-found is recognised - which leaf it is,
 * what the handle says - and so never grows its own copy of that rule.
 *
 * Two boundaries worth being blunt about:
 *
 * - This is a routing decision, not an HTTP one. Compute it **before** the first
 *   byte is written, then pass it to the response; once a streamed document has
 *   begun, no status can still be changed.
 * - It answers "is this a page", never "did it render". A page that throws - and is
 *   caught by a folder's `error.tsx` - is still `200` here, because the route
 *   matched a page. Turning a render failure into `500`, and a redirect into `3xx`,
 *   belongs to the server: this package does not own the response, the headers, or
 *   the stream, and does not try to.
 */
export function getRouteStatus(routes: RouteObject[], url: string): 200 | 404 {
  return isUnmatched(routes, url) ? 404 : 200;
}
