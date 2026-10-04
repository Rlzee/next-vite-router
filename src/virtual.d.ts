declare module 'virtual:next-vite-router' {
  import type { ReactElement } from 'react';
  import type { RouteObject } from 'react-router-dom';

  export type RoutePath = string;
  export type RoutePathParams = Record<string, Record<string, string>>;
  export type RouteParams<P extends RoutePath> = P extends keyof RoutePathParams
    ? RoutePathParams[P]
    : never;

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;

  export { Link, useRoutes } from 'react-router-dom';
}