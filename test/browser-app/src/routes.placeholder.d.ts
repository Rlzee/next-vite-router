// Loose fallback for editors and for a clean checkout: the declaration the Vite
// plugin writes (`src/routes.d.ts`, git-ignored) only exists after something has
// been built, and the browser suite builds it through `pnpm run test:browser` /
// `pnpm run typecheck`. Without this file, every `next-vite-router/routes` import
// in the fixture is unresolved until then.
//
// It is the widened variant on purpose: `params` accepts the segment array
// `useCatchAll()` returns, which `src/app/layout.tsx` passes to a catch-all link.
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
  export function notFound(): never;
  export function redirect(to: string | URL, options?: { replace?: boolean }): never;
  export function permanentRedirect(to: string | URL, options?: { replace?: boolean }): never;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export function useCatchAll(name?: string): string[];
  export { useRoutes } from "react-router-dom";
}
