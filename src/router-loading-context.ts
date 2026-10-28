import React, { createContext, useContext } from "react";
import type { ComponentType } from "react";

/**
 * The `loading.tsx` component of the folder the current route renders in.
 *
 * A page already suspends inside its own `Suspense` (see `createLazyElement`),
 * which is deeper than any boundary the converter could place around it, so the
 * placeholder cannot be handed over as that boundary's `fallback` - the inner one
 * would always paint `loadingFallback` first. The boundary therefore *names* the
 * component through this context and the inner fallback reads it, which keeps one
 * Suspense per page and gives each folder the placeholder it declared. A folder
 * that declares none leaves the context untouched, so the configured
 * `loadingFallback` still answers: the default behavior is unchanged.
 *
 * Read through the provider below rather than a bare `createContext(...)` call in
 * the converter, so the element the route carries stays small and inspectable.
 */
export const RouteLoadingContext = createContext<ComponentType | undefined>(undefined);

/** Publish `loading` to the subtree rendered by a folder's boundary. */
export function RouteLoadingProvider({
  loading,
  children,
}: {
  loading: ComponentType;
  children: React.ReactNode;
}): React.ReactElement {
  return React.createElement(
    RouteLoadingContext.Provider,
    { value: loading },
    children,
  );
}

/** The nearest folder's `loading.tsx`, or `undefined` when no folder declared one. */
export function useRouteLoading(): ComponentType | undefined {
  return useContext(RouteLoadingContext);
}
