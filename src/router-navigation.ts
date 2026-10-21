import React from "react";
import {
  Link as RouterLink,
  generatePath,
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
 * Build a concrete URL from a route pattern and its parameter values.
 *
 * `RoutePath` holds patterns (`/users/:id`), not URLs, so navigating needs the
 * pattern filled in. `generatePath` alone is not enough here: a catch-all folder
 * (`docs/[...segments]`) becomes the unnamed `*` splat, and
 * `generatePath("/docs/*", { segments: "a/b" })` silently drops the value and
 * returns `/docs`. This helper maps the named catch-all onto the splat, the same
 * translation `CatchAllParamProvider` performs when reading parameters, and it
 * reports unmatched parameters instead of letting React Router render a broken
 * link.
 *
 * Values are inserted verbatim, exactly like `generatePath`, so encode anything
 * that may contain `/`, `?`, or `#` before passing it (a catch-all value is
 * expected to contain slashes).
 *
 * @example
 * href("/users/:id", { id: "42" });            // "/users/42"
 * href("/blog/*", { slug: "guide/api" });      // "/blog/guide/api"
 * href("/blog/*", { slug: ["guide", "api"] }); // "/blog/guide/api", from useCatchAll()
 * href("/docs/*", {});                         // "/docs" (optional catch-all)
 * href("/typed-routes");                       // "/typed-routes"
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

  const values: Record<string, string> = {};
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
      // and a link build share one value. An empty array joins to `""`, which
      // already resolves an optional catch-all to its base path.
      values["*"] = Array.isArray(value) ? value.join("/") : value;
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

  return generatePath(pattern, values);
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
