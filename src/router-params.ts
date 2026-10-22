import { useParams as useReactRouterParams } from "react-router-dom";
import { useCatchAllParam } from "./router-params-context";

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const params = useReactRouterParams();
  const catchAllParam = useCatchAllParam();

  if (typeof catchAllParam === "string" && params["*"] !== undefined) {
    return { ...params, [catchAllParam]: params["*"] } as T;
  }

  return params as T;
}

/**
 * Read a catch-all folder as its individual path segments.
 *
 * A catch-all param is a single string, not an array: `/docs/guide/api` matched
 * by `docs/[[...segments]]` yields `"guide/api"`, because that is what a React
 * Router splat holds and what keeps every param the same value type as
 * `react-router-dom` reports. Next.js hands the same value over as `string[]`,
 * so this hook supplies that form and saves each page from repeating the split.
 * Empty segments are dropped, so a trailing slash (`/docs/guide/api/`) still
 * reads as `["guide", "api"]` rather than carrying a final `""`.
 *
 * `href` and `Link` accept the array back, so a route can be read and re-linked
 * with one value: `href("/blog/*", { slug: useCatchAll() })`.
 *
 * Only usable at or below the route that declares the catch-all: a layout above
 * that segment has not matched it yet, so it reads `[]`.
 *
 * @param name - The folder's catch-all name (`slug` for `[...slug]`). Omit it to
 *   use the name the matched route declares.
 * @returns The path segments, or `[]` when no catch-all matched.
 *
 * @example
 * // docs/[[...segments]]/page.tsx rendering /docs/guide/api
 * const segments = useCatchAll();      // ["guide", "api"]
 */
export function useCatchAll(name?: string): string[] {
  const params = useParams();
  const catchAllName = useCatchAllParam();
  const value = params[name ?? catchAllName ?? "*"] ?? params["*"];

  return value ? value.split("/").filter(Boolean) : [];
}
