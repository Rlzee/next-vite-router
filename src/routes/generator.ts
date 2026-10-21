import type { RouteObject } from "react-router-dom";
import { buildRouteTree } from './index.routes';
import { treeToRoutes } from './index.routes';
import { createLazyCache } from '../utils/lazy';
import type { RouteFileOptions } from '../utils/path';
import type { RouteTreeOptions } from '../types/index.type';

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
 * Loader stability:
 * The generator owns a single lazy component cache, so repeated calls reuse the
 * memoized `React.lazy` component for each route key. This assumes the supplied
 * sources stay stable for the generator's lifetime. If you replace a loader for
 * a route that was already generated (for example `pages["users/page.tsx"] =
 * loaderB`), the existing cache hit means the new loader is ignored: the route
 * keeps resolving the component built from the original loader. When sources
 * change, build a new generator (it starts from a fresh cache):
 *
 * @example
 * const generateV1 = createRouteGenerator(pages, layouts, notFounds);
 * // ...later, after swapping a loader in `pages`...
 * const generateV2 = createRouteGenerator(pages, layouts, notFounds);
 * const routes = generateV2(); // fresh cache, resolves the current loaders
 *
 * Lazy layouts:
 * Layouts are eager by default, which keeps the shell in the entry chunk. Pass a
 * non-eager glob plus `{ lazyLayouts: true }` to code-split them as well; the
 * layout then suspends, so its subtree waits for the layout chunk:
 *
 * @example
 * const layouts = import.meta.glob("../../pages/**\\/layout.tsx");
 * export const generateCustomRoutes = createRouteGenerator(
 *   pages,
 *   layouts,
 *   notFounds,
 *   fileOptions,
 *   { lazyLayouts: true },
 * );
 */
export function createRouteGenerator(
  pages: Record<string, () => Promise<any>>,
  layouts: Record<string, any>,
  notFounds: Record<string, () => Promise<any>>,
  fileOptions?: RouteFileOptions,
  options?: RouteTreeOptions
) {
  // One cache per generator: lazy components stay memoized across repeated calls
  // to the returned function, while separate generators never share (and so can
  // never collide on) a route key resolved against different loaders.
  const lazyCache = createLazyCache();

  return (): RouteObject[] => {
    const routeTree = buildRouteTree(
      pages,
      layouts,
      notFounds,
      fileOptions,
      options,
    );
    const routes = treeToRoutes(routeTree, true, "", lazyCache);
    return routes;
  };
}