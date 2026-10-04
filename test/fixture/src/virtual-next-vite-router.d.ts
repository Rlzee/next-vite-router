declare module 'virtual:next-vite-router' {
  import type { RouteObject } from 'react-router-dom';

  export type RoutePath =
  | "/"
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
  export { useRoutes } from 'react-router-dom';
}
