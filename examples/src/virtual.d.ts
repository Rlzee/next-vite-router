declare module "virtual:next-vite-router" {
  import type { ReactElement } from "react";
  import type { LinkProps as ReactRouterLinkProps, RouteObject } from "react-router-dom";

  export type RoutePath = string;
  export type RouteParams<Path extends RoutePath> = Record<string, string>;

  // Fallback shape for editors before the plugin writes the generated
  // declaration; a literal still selects its own branch here.
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

  export type LinkProps = Omit<ReactRouterLinkProps, "to" | "href"> & {
    href: RoutePath;
    params?: Record<string, string>;
  };

  export function Link(props: LinkProps): ReactElement | null;

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export function useCatchAll(name?: string): string[];
  export { useRoutes } from "react-router-dom";
}
