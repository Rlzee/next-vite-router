/**
 * Normalize a Next.js segment to a React Router segment
 * @example (admin) -> ""
 * @example [id] -> :id
 * @example [...slug] -> *
 */
export function normalizeSegment(segment: string): string {
  if (/^\([^)]+\)$/.test(segment)) return "";
  if (/^\[\[\.\.\.(.+)\]\]$/.test(segment)) return "*";
  if (/^\[\.\.\.(.+)\]$/.test(segment)) return "*";
  if (/^\[([^\]]+)\]$/.test(segment)) return segment.replace(/^\[([^\]]+)\]$/, ":$1");
  return segment;
}

export type RouteSegment =
  | { kind: "group"; name: string }
  | { kind: "static"; name: string }
  | { kind: "dynamic"; name: string }
  | { kind: "catchAll"; name: string; optional: boolean };

const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function routeSegmentToPath(segment: RouteSegment): string {
  if (segment.kind === "group") return "";
  if (segment.kind === "dynamic") return `:${segment.name}`;
  if (segment.kind === "catchAll") return "*";
  return segment.name;
}

export function parseRouteSegments(routePath: string): RouteSegment[] {
  const segments = routePath ? routePath.split("/").filter(Boolean) : [];
  const parsed: RouteSegment[] = [];
  const parameterNames = new Set<string>();

  for (const segment of segments) {
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
          `Duplicate route parameter "${parameter.name}" in route "${routePath || "/"}".`,
        );
      }
      parameterNames.add(parameter.name);
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
