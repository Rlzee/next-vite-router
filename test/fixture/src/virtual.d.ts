// Checked-in snapshot of the declaration the Vite plugin generates for this
// fixture, so the project type-checks in an editor before any test runs.
// `node test/test-route-types.js` regenerates it and compares, which keeps this
// file honest; the real `virtual-next-vite-router.d.ts` stays gitignored.

declare module 'virtual:next-vite-router' {
  import type { ReactElement } from 'react';
  import type { LinkProps, RouteObject } from 'react-router-dom';

  export type RoutePath =
  | "/"
  | "/blog/*"
  | "/docs"
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
  "/docs": {
    [key: string]: never;
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

  // A pattern needs values as soon as it carries a `:name` token or a trailing
  // `*` splat, which is how a [id] / [...slug] folder is compiled.
  type HasRouteParams<P extends string> =
    P extends `${string}:${string}` ? true
    : P extends `${string}/*` ? true
    : false;

  export function href<P extends RoutePath>(
    path: P,
    ...params: HasRouteParams<P> extends true
      ? [params: RouteParams<P>]
      : [params?: RouteParams<P>]
  ): string;

  // One member per route, so `to` alone decides whether `params` is required:
  // a union of concrete prop shapes avoids any generic inference in JSX.
  export type RouteLinkProps = {
    [P in RoutePath]: Omit<LinkProps, 'to'> & (HasRouteParams<P> extends true
      ? { to: P; params: RouteParams<P> }
      : { to: P; params?: RouteParams<P> });
  }[RoutePath];

  export function RouteLink(props: RouteLinkProps): ReactElement | null;

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export { Link, useRoutes } from 'react-router-dom';
}
