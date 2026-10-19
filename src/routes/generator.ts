import type { RouteObject } from "react-router-dom";
import { buildRouteTree } from './index.routes';
import { treeToRoutes } from './index.routes';
import { createLazyCache } from '../utils/lazy';
import type { RouteFileOptions } from '../utils/path';

/**
 * Create a custom route generator function using your own files
 *
 * ⚠️ NOTE: This function is intended for advanced use only.
 * For most cases, use the Vite plugin which automatically handles the paths.
 *
 * @example
 * // In your configuration file
 * const pages = import.meta.glob("../../pages/**\\/page.tsx");
 * const layouts = import.meta.glob("../../pages/**\\/layout.tsx", { eager: true });
 * const notFounds = import.meta.glob("../../pages/**\\/not-found.tsx");
 *
 * export const generateCustomRoutes = createRouteGenerator(pages, layouts, notFounds);
 *
 * // Then use it
 * const routes = generateCustomRoutes();
 *
 * The generator owns a single lazy component cache, so repeated calls reuse the
 * memoized `React.lazy` component for each route key. This assumes the supplied
 * sources stay stable for the generator's lifetime: if you swap a loader for the
 * same route between calls, the cached component (old loader) is kept. Create a
 * new generator (or pass a fresh cache) when the sources change.
 */
export function createRouteGenerator(
  pages: Record<string, () => Promise<any>>,
  layouts: Record<string, any>,
  notFounds: Record<string, () => Promise<any>>,
  fileOptions?: RouteFileOptions
) {
  // One cache per generator: lazy components stay memoized across repeated calls
  // to the returned function, while separate generators never share (and so can
  // never collide on) a route key resolved against different loaders.
  const lazyCache = createLazyCache();

  return (): RouteObject[] => {
    const routeTree = buildRouteTree(pages, layouts, notFounds, fileOptions);
    const routes = treeToRoutes(routeTree, true, "", lazyCache);
    return routes;
  };
}