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

/**
 * Whether the target is in absolute form - `http(s)://host/path`, the one form that
 * carries an authority to drop. `http://` alone has neither host nor path, so it
 * names no request target and is not read as the root page.
 */
function isAbsoluteForm(url: string): boolean {
  const host = /^https?:\/\/([^/?#]*)/i.exec(url);
  return !!host && host[1] !== "";
}

/** The authority of an absolute-form target: `//host`, credentials and port alike. */
const AUTHORITY = /^https?:\/\/[^/?#]*/i;

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
    return true;
  }
}

/**
 * What the URL spec calls a single-dot and a double-dot path segment. The encoded
 * forms count too, ASCII case-insensitively, which is why `%2e%2e` and `.%2e` pop a
 * segment just as `..` does - and why the test is on the raw segment: decoding the
 * path to check it would be the very thing this branch avoids.
 */
const SINGLE_DOT = /^(?:\.|%2e)$/i;
const DOUBLE_DOT = /^(?:\.\.|%2e\.|\.%2e|%2e%2e)$/i;

/**
 * The structural half of `new URL().pathname`, without the parser: a missing
 * leading slash completed, dot segments resolved, a dot segment at the end of the
 * path leaving its slash behind (`/a/..` is `/a/`, not `/a`), and everything else -
 * every empty segment and every percent escape - kept byte for byte.
 *
 * The leading one or two slashes are held outside the resolution stack, so a chain
 * of dot segments cannot pop them: `//a/../../x` keeps both slashes, and `/../../x`
 * floors at `/`. That is what makes a protocol-relative path safe to resolve here
 * at all - popping into the prefix would turn a path into another authority.
 *
 * Reached for a path the parser must not be run over: one carrying an escape it
 * could not decode, where it warns on stderr, and a protocol-relative target, where
 * parsing it would read `//host` as an authority and swap origin. Judging the whole
 * path for one broken escape must not cost the *other* segments their structure,
 * or the escape in `/%FF/x` would decide how `/a/../%FF` matches.
 */
function resolveByHand(path: string): string {
  // The leading slashes are a prefix, not a segment the resolution may pop: keeping
  // them out of the stack is what makes `//a/../../x` keep both slashes however many
  // dot segments follow it, and a root-less path floor at `/` rather than vanish.
  const prefix = /^\/{1,2}/.exec(path)?.[0] ?? "";
  const kept: string[] = [];
  // A path that ends on a dot segment keeps a slash: that is the URL spec's rule,
  // which makes `/a/.` and `/a/..` both `/a/` rather than `/a` and `/`. Forgetting it
  // would drop a trailing slash the client router does see.
  let endsOnDot = false;
  for (const segment of path.slice(prefix.length).split("/")) {
    if (SINGLE_DOT.test(segment)) {
      endsOnDot = true;
      continue;
    }
    // A dot segment pops a named segment only; with nothing left to pop the path
    // floors at its own root, which is where `/../../x` and `//a/../../x` differ by
    // exactly that prefix.
    if (DOUBLE_DOT.test(segment)) {
      if (kept.length > 0) kept.pop();
      endsOnDot = true;
      continue;
    }
    endsOnDot = false;
    kept.push(segment);
  }
  // `prefix` already carries the leading slash, so the body is appended to it as is;
  // a path that had none is completed, and an emptied body still leaves an absolute
  // path - a request target never resolves down to nothing.
  const lead = prefix === "" ? "/" : prefix;
  const body = kept.join("/");
  const resolved = body === "" ? lead : `${lead}${body}`;
  return endsOnDot && !resolved.endsWith("/") ? `${resolved}/` : resolved;
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
 * dropped and dot segments resolved, so the server reaches the same leaf the browser
 * would. Anything else is handed to React Router as it arrived, because
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
 * `%C0%AF`, a lone surrogate `%ED%A0%80`) goes through the same steps minus the
 * parser, because the parser reads every escape and warns on stderr for those it
 * cannot decode; the structure it would have given the path - leading slash, dot
 * segments in their encoded forms as well as their literal ones - is settled by
 * {@link resolveByHand} instead. Nothing about the path is *rewritten*: the escapes
 * stay as they are and React Router hands them to the page verbatim, which is what
 * the client's router does. Matching such a path makes React Router warn while
 * decoding the param, and that warning is the router's, raised against a page that
 * exists; hiding it by answering 404 would be a wrong answer bought with a quiet log.
 */
export function normalizeRequestTarget(url: string): string {
  // A scheme that is not `http`/`https` names no request target on this origin, and
  // a bare path or a lone `?query` is not a scheme, whatever precedes the colon.
  const absolute = isAbsoluteForm(url);
  if (!absolute && !url.startsWith("//") && SCHEME.test(url)
    && !url.startsWith("?") && !url.startsWith("#")) {
    return url;
  }

  const path = absolute ? withoutSuffix(url.replace(AUTHORITY, "")) : withoutSuffix(url);

  // A protocol-relative href is an authority shortcut in a *document*, not in a
  // request target: these two slashes are the path, and must not be read as a host.
  // Which also means the parser cannot touch it - resolving it as a URL would swap
  // origin - so its structure is settled the same way an undecodable path's is.
  if (path.startsWith("//")) return resolveByHand(path);

  if (isUndecodable(path)) return resolveByHand(path);

  try {
    return new URL(path.startsWith("/") ? path : `/${path}`, ORIGIN).pathname;
  } catch {
    return path;
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
