declare module 'virtual:next-vite-router' {
  import type { ReactElement } from 'react';
  import type { LinkProps, RouteObject } from 'react-router-dom';

  export type RoutePath = string;
  export type RoutePathParams = Record<string, Record<string, string>>;
  export type RouteParams<P extends RoutePath> = P extends keyof RoutePathParams
    ? RoutePathParams[P]
    : never;

  // Fallback shape used before the plugin writes the generated declaration:
  // `RoutePath` is `string`, so any literal still selects its own branch here.
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

  export type RouteLinkProps = Omit<LinkProps, 'to'> & {
    to: RoutePath;
    params?: RouteParams<RoutePath>;
  };

  export function RouteLink(props: RouteLinkProps): ReactElement | null;

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;

  export { Link, useRoutes } from 'react-router-dom';
}
