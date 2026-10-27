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
 * What the route generator tells the navigation helpers about a catch-all.
 *
 * The public pattern only carries React Router's unnamed splat (`/blog/*`), which
 * on its own cannot say which folder filled it. `name` is the declared catch-all
 * folder name (`slug` for `[...slug]`), and `optional` marks `[[...segments]]` as
 * allowed to resolve to its base path. The plugin generates this map and passes it
 * to `href`/`Link`; a bare call without it can address the splat only as `"*"`.
 */
export type RouteCatchAllMetadata = { name: string; optional: boolean };

/** Per-pattern metadata accepted by `href`; only a catch-all needs any. */
export type RouteHrefMetadata = { catchAll?: RouteCatchAllMetadata };

/** The map a generated `Link` is bound to: pattern -> its metadata. */
export type RouteLinkMetadata = Record<string, RouteHrefMetadata>;

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
 * value with `encodeURIComponent` gives one result on either version. An empty
 * segment inside a catch-all value is dropped (the way `useCatchAll` drops it),
 * and an unmatched, missing, or empty required value is reported instead of
 * letting React Router render a broken link.
 *
 * Each value is encoded per path segment. A catch-all value may span several
 * segments — a string is split on `/`, an array (`useCatchAll()`) is already
 * segments — so each segment is encoded and the `/` separators are preserved.
 * Empty segments are dropped first, so a trailing slash (`"a/b/"`), a leading
 * slash, or a blank array entry cannot inject a `//` into the path. A segment
 * that is exactly `.` or `..` throws instead of being encoded, because no
 * encoding keeps a dot-segment from resolving out of the path. A required
 * `:name` given an empty value throws too: encoding it would drop the segment
 * and turn `/users/:id` into `/users/`, a different route.
 *
 * A catch-all is keyed by the folder name it declares (`slug` for `[...slug]`),
 * but the public pattern (`/blog/*`) does not carry that name. The plugin
 * generates it into the `metadata` argument, so the `href` re-exported from
 * `next-vite-router/routes` accepts `{ slug: ... }` and rejects any other key
 * instead of guessing. Called directly on this package without `metadata`, only
 * React Router's `"*"` fills the splat; a friendly name cannot be validated, so
 * it is rejected rather than routed onto the catch-all. A required `[...slug]`
 * also reports a missing or empty value, while an optional `[[...segments]]`
 * still resolves to its base path.
 *
 * @example
 * href("/users/:id", { id: "42" });          // "/users/42"
 * href("/users/:id", { id: "a/b" });          // "/users/a%2Fb"
 * href("/blog/*", { slug: "guide/api" });     // "/blog/guide/api" (generated href knows "slug")
 * href("/blog/*", { slug: ["a b", "c?d"] });  // "/blog/a%20b/c%3Fd", from useCatchAll()
 * href("/blog/*", { "*": "guide/api" });      // "/blog/guide/api" (raw href, no metadata)
 * href("/docs/*", {});                        // "/docs" (optional catch-all)
 * href("/typed-routes");                      // "/typed-routes"
 */
function toCatchAllSegments(value: string | string[] | undefined): string[] {
  // A catch-all value may span several segments: an array (`useCatchAll()`) is
  // already segments, a string is split on `/`. Empty segments are dropped the
  // same way `useCatchAll` drops them, so a trailing slash, a leading slash, or
  // a `""` entry cannot inject a `//` into the path. An all-empty value (or `[]`)
  // contributes nothing, which already resolves an optional catch-all to its base.
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined) return [];
  return value.split("/").filter(Boolean);
}

/**
 * Explain which keys a pattern accepts when a caller supplies one it does not,
 * naming the declared catch-all folder when the metadata reveals it and falling
 * back to React Router's `"*"` splat otherwise.
 */
function describeMissingParameter(
  names: Set<string>,
  hasCatchAll: boolean,
  catchAll: RouteCatchAllMetadata | undefined,
): string {
  const expected = [...names].map((name) => `"${name}"`);
  if (hasCatchAll) {
    expected.push(catchAll ? `"${catchAll.name}"` : '"*"');
    const hint = catchAll
      ? ` Pass the value under its declared name "${catchAll.name}" (or React Router's "*").`
      : ' Address the splat with "*", or import href/Link from "next-vite-router/routes" so a catch-all is validated by its folder name.';
    return `Expected: ${expected.join(", ")}.${hint}`;
  }
  return expected.length > 0
    ? `Expected: ${expected.join(", ")}.`
    : "This route takes no parameters.";
}

export function href(
  pattern: string,
  params: RouteHrefParams = {},
  metadata: RouteHrefMetadata = {},
): string {
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
  // The declared catch-all name reaches the runtime only through the metadata the
  // plugin generates; without it the splat can be filled by its literal "*" key
  // and no friendly name can be validated, so one is rejected rather than guessed.
  const catchAll = hasCatchAll ? metadata.catchAll : undefined;

  // A null-prototype object so a param named like an `Object.prototype` key
  // (`constructor`, `toString`, …) reads as `undefined` when missing instead of
  // resolving to the inherited member and being encoded into the path.
  const values: Record<string, string> = Object.create(null);
  let catchAllSegments: string[] = [];
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
    } else if (hasCatchAll && (key === "*" || key === catchAll?.name)) {
      // The catch-all is filled only by React Router's "*" or the folder name the
      // metadata declares. Any other key is a mistake and is rejected below, so a
      // misspelled or arbitrary key is never silently routed onto the splat.
      catchAllSegments = toCatchAllSegments(value);
      catchAllKeys.push(key);
    } else {
      throw new Error(
        `Route "${pattern}" has no "${key}" parameter. ` +
        describeMissingParameter(names, hasCatchAll, catchAll),
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
    if (values[name] === "") {
      throw new Error(
        `Route "${pattern}" requires a non-empty value for its ":${name}" param; ` +
        "an empty value drops the segment and resolves to a different route.",
      );
    }
  }

  // A required `[...name]` never matches its base path, so resolving it to one
  // would build a link the route cannot render. This is enforceable only when the
  // metadata says the catch-all is required; an optional `[[...name]]` still
  // collapses to its base, and a bare call without metadata keeps its lenient
  // "*"-only behavior.
  if (catchAll && !catchAll.optional) {
    if (catchAllKeys.length === 0) {
      throw new Error(
        `Route "${pattern}" is missing the required "${catchAll.name}" catch-all param.`,
      );
    }
    if (catchAllSegments.length === 0) {
      throw new Error(
        `Route "${pattern}" requires a non-empty value for its "${catchAll.name}" catch-all param; ` +
        "an empty value drops the segment and resolves to a different route.",
      );
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
      const joined = catchAllSegments.map(encodeSegment).join("/");
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
  metadata: RouteHrefMetadata,
): React.ReactElement {
  const target = params === undefined && !hasSubstitutableTokens(pattern)
    ? pattern
    : href(pattern, params, metadata);

  return React.createElement(RouterLink, { ...rest, to: target });
}

/**
 * Build a `Link` that resolves patterns through a generated catch-all metadata map.
 *
 * The plugin creates the map (`pattern -> { catchAll: { name, optional } }`) from
 * the same traversal that emits the route types, then binds it here, so the
 * `Link` re-exported from `next-vite-router/routes` accepts a catch-all's declared
 * folder name and rejects any other key — the runtime guarantee the generated
 * types already provide at compile time.
 *
 * @param metadataByPattern - Per-pattern metadata; an absent entry (a static or
 *   `:name` route, or a bare URL) simply carries no catch-all to validate.
 */
export function createTypedLink(
  metadataByPattern: RouteLinkMetadata = {},
): (props: LinkProps) => React.ReactElement {
  return function Link(props: LinkProps): React.ReactElement {
    const { href: pattern, params, ...rest } = props;

    if (typeof pattern !== "string") {
      throw new Error(
        'Link takes a route pattern in `href`, as in <Link href="/users/:id" params={{ id }} />.\n' +
        'Use the `Link` from "react-router-dom" for its `to` prop instead.',
      );
    }

    return renderTypedLink(pattern, params, rest, metadataByPattern[pattern] ?? {});
  };
}

/**
 * Next.js-style `Link` bound to a route pattern instead of a hand-written URL.
 *
 * With the plugin's generated types and the metadata-bound `Link` re-exported from
 * `next-vite-router/routes`, `href` must be a known `RoutePath`, `params` is
 * required as soon as that path has parameters, and a catch-all is validated
 * against the folder name it declares. Every other `Link` prop (`className`,
 * `replace`, `state`, …) is forwarded untouched.
 *
 * This direct export carries no metadata, so it fills a catch-all only through
 * React Router's `"*"`, exactly like `href` without its `metadata` argument; an
 * app should use the generated `Link`, which supplies the declared name.
 *
 * React Router's own `Link`, the one that spells this prop `to`, stays available
 * from `react-router-dom`; the virtual module no longer re-exports it because
 * `Link` there now means this typed component.
 *
 * @example
 * <Link href="/users/:id" params={{ id: user.id }}>Profile</Link>
 * <Link href="/users">All users</Link>
 */
export const Link = createTypedLink();
