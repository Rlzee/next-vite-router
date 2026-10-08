declare module 'virtual:next-vite-router' {
  import type { ReactElement } from 'react';
  import type { RouteObject } from 'react-router-dom';

  export type RoutePath =
  | "/"
  | "/blog/*"
  | "/docs/*"
  | "/posts/:slug"
  | "/users"
  | "/users/:id";

  export type RouteParams<P extends RoutePath> = P extends keyof RoutePathParams
    ? RoutePathParams[P]
    : never;

  export interface RoutePathParams {
  "/": {
    [key: string]: never;
  };
  "/blog/*": {
    slug: string;
  };
  "/docs/*": {
    segments?: string;
  };
  "/posts/:slug": {
    slug: string;
  };
  "/users": {
    [key: string]: never;
  };
  "/users/:id": {
    id: string;
  };
  }

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export { Link, useRoutes } from 'react-router-dom';
}
