// Loose fallback for editors: `test/compat-app` is normally built inside a
// temporary directory (the CI compatibility job copies it next to the packed
// tarball), so the declaration the Vite plugin writes does not appear in the
// repository. These widened shapes keep the fixture readable; building it in
// place produces the real `virtual-next-vite-router.d.ts` beside this file,
// which pins `RoutePath` to the routes the fixture actually declares.
declare module "next-vite-router/routes" {
  import type { ReactElement } from "react";
  import type { LinkProps as ReactRouterLinkProps, RouteObject } from "react-router-dom";

  export type RoutePath = string;
  // A catch-all value may be the string `useParams` reports or the segment array
  // `useCatchAll()` returns; `href` and `Link` join the array form.
  export type RouteParams<Path extends RoutePath> = Record<string, string | string[]>;

  export function href<P extends RoutePath>(
    path: P,
    params?: RouteParams<P>,
  ): string;

  export type LinkProps = Omit<ReactRouterLinkProps, "to" | "href"> & {
    href: RoutePath;
    params?: RouteParams<RoutePath>;
  };

  export function Link(props: LinkProps): ReactElement | null;

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export function useCatchAll(name?: string): string[];
  export { useRoutes } from "react-router-dom";
}
