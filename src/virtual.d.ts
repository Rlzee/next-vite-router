declare module 'virtual:next-vite-router' {
  import type { ReactElement } from 'react';
  import type { LinkProps as ReactRouterLinkProps, RouteObject } from 'react-router-dom';

  export type RoutePath = string;
  // A catch-all value may be the string `useParams` reports or the segment array
  // `useCatchAll()` returns; `href` and `Link` join the array form.
  export type RoutePathParams = Record<string, Record<string, string | string[]>>;
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

  export type LinkProps = Omit<ReactRouterLinkProps, 'to' | 'href'> & {
    href: RoutePath;
    params?: RouteParams<RoutePath>;
  };

  export function Link(props: LinkProps): ReactElement | null;

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export function useCatchAll(name?: string): string[];

  export { useRoutes } from 'react-router-dom';
}
