/**
 * Normalize a Next.js segment to a React Router segment.
 *
 * @deprecated Nothing in the package calls it; the rules live in
 * `parseRouteSegments` and `routeSegmentToPath`, which validate as they convert.
 * This wrapper forwards to those two so the single segment cannot drift from the
 * router's own behavior — including rejecting a parameter name the router would
 * reject (`[123]`). It leaves the root entry at the next major.
 * @example (admin) -> ""
 * @example [id] -> :id
 * @example [...slug] -> *
 */
export function normalizeSegment(segment: string): string {
  // A `/` means the caller handed over a path instead of a segment. The anchored
  // regexes this function replaced left such input untouched, and re-joining
  // parsed segments would prefix it with a leading slash, so keep it as is.
  if (segment.includes("/")) return segment;

  // A single segment always parses to exactly one entry; an empty segment
  // parses to none and stays empty.
  const [parsed] = parseRouteSegments(segment);
  return parsed ? routeSegmentToPath(parsed) : segment;
}

export type RouteSegment =
  | { kind: "group"; name: string }
  | { kind: "static"; name: string }
  | { kind: "dynamic"; name: string }
  | { kind: "catchAll"; name: string; optional: boolean };

/**
 * Compare two strings by UTF-16 code unit instead of by locale collation.
 *
 * `String.prototype.localeCompare` depends on the locale and the ICU build of
 * the running process, so the same route tree can be ordered differently on two
 * machines. Every ordering that leaves this package has to be reproducible: the
 * `RoutePath` union written into the generated declarations, the key order of the
 * catch-all metadata, the child order of the route tree, and the file lists in
 * conflict errors. Code-unit order is the same everywhere.
 *
 * Internal to the package: it is re-exported through `utils/index.utils` for the
 * route modules and the plugin, but not from the root entry, so it adds nothing
 * to the public API.
 */
export function compareOrdinal(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function routeSegmentToPath(segment: RouteSegment): string {
  if (segment.kind === "group") return "";
  if (segment.kind === "dynamic") return `:${segment.name}`;
  if (segment.kind === "catchAll") return "*";
  return segment.name;
}

/**
 * Parse a route path into normalized segments.
 *
 * `source` optionally names the file the path came from so validation errors
 * can point at the offending file instead of only the derived route path.
 * Callers that already know the file (the runtime tree builder and the plugin
 * type generator) pass it; the converter parses single segments and omits it.
 */
export function parseRouteSegments(routePath: string, source?: string): RouteSegment[] {
  const segments = routePath ? routePath.split("/").filter(Boolean) : [];
  const parsed: RouteSegment[] = [];
  const parameterNames = new Set<string>();
  const routeLabel = source ?? (routePath || "/");
  let catchAllSegment: string | undefined;

  for (const segment of segments) {
    // A catch-all maps to React Router's `*` splat, which consumes the rest of
    // the path, so nothing can meaningfully follow it. Reject any segment that
    // appears after one instead of silently generating a route that can never
    // match (e.g. `docs/[...slug]/edit/page.tsx`).
    if (catchAllSegment !== undefined) {
      throw new Error(
        `Invalid route "${routeLabel}": catch-all segment "${catchAllSegment}" must be the last segment. ` +
        `The "${segment}" segment that follows it can never match, because React Router's "*" captures the rest of the path. ` +
        "Move the catch-all to the end of the route or remove the segments after it.",
      );
    }

    const groupMatch = segment.match(/^\(([^)]+)\)$/);
    const optionalCatchAllMatch = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
    const catchAllMatch = segment.match(/^\[\.\.\.(.+)\]$/);
    const dynamicMatch = segment.match(/^\[([^\]]+)\]$/);
    const parameter = optionalCatchAllMatch
      ? { name: optionalCatchAllMatch[1], optional: true, kind: "catchAll" as const }
      : catchAllMatch
        ? { name: catchAllMatch[1], optional: false, kind: "catchAll" as const }
        : dynamicMatch
          ? { name: dynamicMatch[1], optional: false, kind: "dynamic" as const }
          : undefined;

    if (groupMatch) {
      parsed.push({ kind: "group", name: groupMatch[1] });
    } else if (parameter) {
      if (!PARAMETER_NAME.test(parameter.name)) {
        throw new Error(
          `Invalid route parameter name "${parameter.name}" in segment "${segment}". ` +
          "Parameter names must start with a letter or underscore and contain only letters, numbers, and underscores.",
        );
      }
      if (parameterNames.has(parameter.name)) {
        throw new Error(
          `Duplicate route parameter "${parameter.name}" in route "${routeLabel}".`,
        );
      }
      parameterNames.add(parameter.name);
      if (parameter.kind === "catchAll") catchAllSegment = segment;
      parsed.push(parameter);
    } else {
      parsed.push({ kind: "static", name: segment });
    }
  }

  return parsed;
}

export type RouteFileOptions = {
  pagesDir?: string;
  pageFile?: string;
  layoutFile?: string;
  notFoundFile?: string;
};

/**
 * Extract the route path from a file path
 * @example "../../app/blog/[id]/page.tsx" -> "blog/[id]"
 * @example "../../app/page.tsx" -> ""
 *
 * `pagesDir` may be relative or absolute. The plugin resolves it relative to
 * the Vite project root before passing it here.
 * The prefix is stripped lazily so it matches the FIRST directory boundary
 * that equals `pagesDir` (or the leading `app`/`pages` root marker when no
 * `pagesDir` is supplied). A greedy match would instead consume up to the
 * LAST such folder, which mangles routes that legitimately contain a nested
 * folder named like the pages directory (e.g. `app/docs/app/page.tsx`).
 */
export function extractRoutePath(
  filePath: string,
  { pagesDir, pageFile = "page.tsx", layoutFile = "layout.tsx", notFoundFile = "not-found.tsx" }: RouteFileOptions = {},
): string {
  const normalized = filePath.replace(/\\/g, "/");
  // Normalize `pagesDir` to a root-relative POSIX form so relative spellings
  // like `./src/app`, `src\app`, or `/src/app` all match Vite's root-relative
  // glob keys (`/src/app/...`). Without this, a `./` (or `.\`) prefix leaks
  // into the match and the pages directory is never stripped.
  const base = pagesDir
    ?.replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/|\/$/g, "");
  const escapedBase = base?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fileNames = [pageFile, layoutFile, notFoundFile]
    .map((file) => file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  return normalized
    .replace(
      base
        ? new RegExp(`^.*?(?:^|/)${escapedBase}/`)
        : /^.*?(?:^|\/)(?:app|pages)\//,
      "",
    )
    .replace(/\\/g, "/")
    .replace(new RegExp(`/?(?:${fileNames})$`), "");
}
