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
 */
export function extractRoutePath(
  filePath: string,
  { pagesDir, pageFile = "page.tsx", layoutFile = "layout.tsx", notFoundFile = "not-found.tsx" }: RouteFileOptions = {},
): string {
  const normalized = filePath.replace(/\\/g, "/");
  const base = pagesDir?.replace(/\\/g, "/").replace(/^\/|\/$/g, "");
  const fileNames = [pageFile, layoutFile, notFoundFile]
    .map((file) => file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  return normalized
    .replace(
      base
        ? new RegExp(`^.*(?:^|/)${base}/`)
        : /^.*(?:^|\/)(?:app|pages)\//,
      "",
    )
    .replace(/\\/g, "/")
    .replace(new RegExp(`/?(?:${fileNames})$`), "");
}
