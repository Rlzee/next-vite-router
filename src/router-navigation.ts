import React from "react";
import {
  Link as RouterLink,
  type LinkProps as RouterLinkProps,
} from "react-router-dom";

/**
 * Values for the parameters of a route pattern (`/users/:id`, `/blog/*`).
 *
 * The keys are the names the route declares: `:id` for a `[id]` folder, and the
 * catch-all folder name (`slug` for `[...slug]`) rather than React Router's
 * unnamed `*` splat, which is what `useParams` from this package already exposes.
 *
 * A catch-all also accepts the segment array `useCatchAll()` returns, so reading
 * a catch-all route and building a link to it use the same value. A `:name`
 * param stays a string: it is always exactly one path segment.
 */
export type RouteHrefParams = Record<string, string | string[]>;

/**
 * Props of the typed `Link`: a route pattern in `href`, the values it needs in
 * `params`, and everything else forwarded to React Router's `Link`.
 */
export type LinkProps = Omit<RouterLinkProps, "to" | "href"> & {
  /** A route pattern taken from the generated `RoutePath` union. */
  href: string;
  /** Values substituted into that pattern; required whenever it has parameters. */
  params?: RouteHrefParams;
};

/**
 * True when a pattern declares at least one token to substitute, which is the
 * only case where rewriting it can change the result.
 */
function hasSubstitutableTokens(pattern: string): boolean {
  const segments = pattern.split("/").filter(Boolean);
  return (
    segments.some((segment) => segment.startsWith(":")) ||
    segments[segments.length - 1] === "*"
  );
}

/**
 * Percent-encode one path segment. `encodeURIComponent` also escapes `/`, `?`,
 * and `#`, so a substituted value can never break out of its own segment or
 * start a query or fragment.
 *
 * `.` and `..` are the one case encoding cannot cover: it leaves them verbatim,
 * and a browser's URL parser (and React Router) still resolves them as
 * parent-directory segments (`/users/..` becomes `/`, `/blog/../x` becomes
 * `/x`) even when written `%2e%2e`, so a value that is exactly a dot-segment is
 * rejected rather than encoded.
 */
function encodeSegment(value: string): string {
  if (value === "." || value === "..") {
    throw new Error(
      `A route parameter value cannot be "${value}": "." and ".." resolve as ` +
      "parent-directory segments, so the link would escape its own path " +
      '("/users/.." becomes "/", "/blog/../x" becomes "/x").',
    );
  }
  return encodeURIComponent(value);
}

/**
 * Build a concrete URL from a route pattern and its parameter values.
 *
 * `RoutePath` holds patterns (`/users/:id`), not URLs, so navigating needs the
 * pattern filled in. `generatePath` is deliberately not used: it inserts named
 * params verbatim in React Router v6 but percent-encodes them in v7, so the same
 * `id` yields `/users/a/b` on one and `/users/a%2Fb` on the other, and this
 * package's peer range spans both. Filling the pattern here and encoding every
 * value with `encodeURIComponent` gives one result on either version. A
 * catch-all folder is still mapped onto the unnamed `*` splat, the same
 * translation `CatchAllParamProvider` performs when reading parameters, and an
 * unmatched or missing value is reported instead of letting React Router render
 * a broken link.
 *
 * Each value is encoded per path segment. A catch-all value may span several
 * segments — a string is split on `/`, an array (`useCatchAll()`) is already
 * segments — so each segment is encoded and the `/` separators are preserved.
 * A segment that is exactly `.` or `..` throws instead of being encoded,
 * because no encoding keeps a dot-segment from resolving out of the path.
 *
 * @example
 * href("/users/:id", { id: "42" });          // "/users/42"
 * href("/users/:id", { id: "a/b" });          // "/users/a%2Fb"
 * href("/blog/*", { slug: "guide/api" });     // "/blog/guide/api"
 * href("/blog/*", { slug: ["a b", "c?d"] });  // "/blog/a%20b/c%3Fd", from useCatchAll()
 * href("/docs/*", {});                        // "/docs" (optional catch-all)
 * href("/typed-routes");                      // "/typed-routes"
 */
export function href(pattern: string, params: RouteHrefParams = {}): string {
  if (!pattern.startsWith("/")) {
    throw new Error(
      `Route pattern "${pattern}" must be root-relative, like the generated RoutePath values ("/users/:id").`,
    );
  }

  const segments = pattern.split("/").filter(Boolean);
  const names = new Set(
    segments
      .filter((segment) => segment.startsWith(":"))
      .map((segment) => segment.slice(1)),
  );
  // React Router only ever puts the splat in the last segment, which is where a
  // catch-all folder lands (a segment after one is rejected while routing).
  const hasCatchAll = segments[segments.length - 1] === "*";

  // Values are kept raw and encoded only while the path is rebuilt below, so a
  // missing `:name` still compares equal to `undefined` in the required check
  // instead of turning into the literal string "undefined".
  const values: Record<string, string> = {};
  let catchAll: string[] = [];
  const catchAllKeys: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (names.has(key)) {
      // A `:name` folder is exactly one path segment, so an array there is a
      // mistake rather than a value this helper could join.
      if (Array.isArray(value)) {
        throw new Error(
          `Route "${pattern}" expects a string for its ":${key}" param; ` +
          "only a catch-all value accepts an array of segments.",
        );
      }
      values[key] = value;
    } else if (hasCatchAll) {
      // `useCatchAll()` hands back segments, so accepting them here lets a read
      // and a link build share one value. An empty value (or `[]`) contributes
      // nothing, which already resolves an optional catch-all to its base path.
      catchAll = Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : value.split("/");
      catchAllKeys.push(key);
    } else {
      throw new Error(
        `Route "${pattern}" has no "${key}" parameter. ` +
        (names.size > 0
          ? `Expected: ${[...names].map((name) => `"${name}"`).join(", ")}.`
          : "This route takes no parameters."),
      );
    }
  }

  if (catchAllKeys.length > 1) {
    throw new Error(
      `Route "${pattern}" takes one catch-all value, but ${catchAllKeys.length} params ` +
      `were supplied (${catchAllKeys.map((key) => `"${key}"`).join(", ")}).`,
    );
  }

  for (const name of names) {
    if (values[name] === undefined) {
      throw new Error(`Route "${pattern}" is missing the required ":${name}" param.`);
    }
  }

  // Rebuild instead of calling generatePath so the encoding is the same whether
  // React Router v6 (verbatim) or v7 (encodes) is installed. An empty catch-all
  // adds no segment, so `/docs/*` with no value resolves to `/docs`.
  let path = "";
  for (const segment of segments) {
    if (segment.startsWith(":")) {
      path += `/${encodeSegment(values[segment.slice(1)])}`;
    } else if (segment === "*") {
      const joined = catchAll.map(encodeSegment).join("/");
      if (joined) {
        path += `/${joined}`;
      }
    } else {
      path += `/${segment}`;
    }
  }

  return path || "/";
}

/**
 * Resolve a pattern into a URL and hand it to React Router's `Link`.
 *
 * A pattern with nothing to substitute is passed through unchanged, so an
 * absolute URL keeps its `//` (`generatePath` would collapse it).
 */
function renderTypedLink(
  pattern: string,
  params: RouteHrefParams | undefined,
  rest: Omit<RouterLinkProps, "to">,
): React.ReactElement {
  const target = params === undefined && !hasSubstitutableTokens(pattern)
    ? pattern
    : href(pattern, params);

  return React.createElement(RouterLink, { ...rest, to: target });
}

/**
 * Next.js-style `Link` bound to a route pattern instead of a hand-written URL.
 *
 * With the plugin's generated types, `href` must be a known `RoutePath` and
 * `params` is required as soon as that path has parameters, so a renamed folder
 * or a missing id fails to compile instead of 404ing at runtime. Every other
 * `Link` prop (`className`, `replace`, `state`, …) is forwarded untouched.
 *
 * React Router's own `Link`, the one that spells this prop `to`, stays available
 * from `react-router-dom`; the virtual module no longer re-exports it because
 * `Link` there now means this typed component.
 *
 * @example
 * <Link href="/users/:id" params={{ id: user.id }}>Profile</Link>
 * <Link href="/users">All users</Link>
 */
export function Link(props: LinkProps): React.ReactElement {
  const { href: pattern, params, ...rest } = props;

  if (typeof pattern !== "string") {
    throw new Error(
      'Link takes a route pattern in `href`, as in <Link href="/users/:id" params={{ id }} />.\n' +
      'Use the `Link` from "react-router-dom" for its `to` prop instead.',
    );
  }

  return renderTypedLink(pattern, params, rest);
}
