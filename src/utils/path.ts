/**
 * Normalize a Next.js segment to a React Router segment
 * @example (admin) -> ""
 * @example [id] -> :id
 * @example [...slug] -> *
 */
export function normalizeSegment(segment: string): string {
  if (/^\([^)]+\)$/.test(segment)) return "";
  if (/^\[\.\.\.(.+)\]$/.test(segment)) return "*";
  if (/^\[([^\]]+)\]$/.test(segment)) return segment.replace(/^\[([^\]]+)\]$/, ":$1");
  return segment;
}

/**
 * Extract the route path from a file path
 * @example "../../app/blog/[id]/page.tsx" -> "blog/[id]"
 * @example "../../app/page.tsx" -> ""
 */
export function extractRoutePath(filePath: string): string {
  return filePath
    .replace("../../app/", "")
    .replace(/\/?(page|layout|not-found)\.tsx$/, "");
}
