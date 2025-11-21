import type { RouteObject } from "react-router-dom";
import { buildRouteTree } from './index.routes';
import { treeToRoutes } from './index.routes';

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
 */
export function createRouteGenerator(
  pages: Record<string, () => Promise<any>>,
  layouts: Record<string, any>,
  notFounds: Record<string, () => Promise<any>>
) {
  return (): RouteObject[] => {
    const routeTree = buildRouteTree(pages, layouts, notFounds);
    const routes = treeToRoutes(routeTree, true);
    return routes;
  };
}