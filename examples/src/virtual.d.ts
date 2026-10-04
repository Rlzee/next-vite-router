declare module "virtual:next-vite-router" {
  import type { ReactElement } from "react";
  import type { RouteObject } from "react-router-dom";

  export type RoutePath = string;
  export type RouteParams<Path extends RoutePath> = Record<string, string>;
  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export { Link, useRoutes } from "react-router-dom";
}
