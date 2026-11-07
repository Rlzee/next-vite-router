import React, { lazy, Suspense } from "react";
import { useRouteLoading } from '../router/loading-context';

/**
 * A cache of `React.lazy` components keyed by a route-derived string (see the
 * converter: `page:<fullPath>` / `notfound:<fullPath>`).
 *
 * Caches are no longer a package-wide singleton. Each route generator (and each
 * standalone `treeToRoutes` call) owns its own instance, so components stay
 * memoized within one generation while separate generators can never collide on
 * the same key with different loaders.
 */
export type LazyComponentCache = Map<string, React.LazyExoticComponent<any>>;

/** Create a fresh, empty lazy component cache to hand to a single generator. */
export function createLazyCache(): LazyComponentCache {
  return new Map();
}

/**
 * Drop every memoized lazy component held by `cache`.
 *
 * Caches stopped being a package-wide singleton, so the caller names the one it
 * wants reset - usually the instance a generator owns (see `createLazyCache`).
 *
 * @param cache - The cache to reset.
 */
export function clearLazyCache(cache: LazyComponentCache): void {
  cache.clear();
}

/**
 * Resolve the loading placeholder at render time rather than at route
 * generation time.
 *
 * `treeToRoutes` / `generateRoutes` build React elements eagerly, so reading
 * the folder's placeholder while creating them would capture the tree as it
 * stood at that moment; rendering a dedicated fallback component defers the read
 * until the route is actually painted, keeping the `Suspense` boundary stable.
 *
 * The folder's `loading.tsx` is the only placeholder there is: it arrives
 * through `RouteLoadingContext`, because this element renders inside the page's
 * own `Suspense`, which is deeper than any boundary the converter could place
 * around it. A folder that declares none renders *nothing* while its page is
 * loading, exactly like Next.js, which has no global fallback to configure: the
 * placeholder is a file in a folder, or there is none. Returning `null` rather
 * than an empty element also keeps a stray `<div>` out of the DOM.
 */
function RouteLoadingFallback() {
  const FolderFallback = useRouteLoading();
  return FolderFallback ? React.createElement(FolderFallback) : null;
}

/**
 * Create a lazy element wrapped in a Suspense boundary.
 *
 * The `React.lazy` component is memoized in the provided `cache` under
 * `cacheKey`. Thread the SAME cache instance through an entire route generation
 * so components are reused; create it once with `createLazyCache` (per
 * generator) rather than per call. A separate cache for the same key memoizes a
 * fresh component, which is exactly what keeps independent generators isolated.
 *
 * @param loader - Loads the component; used only on the first call for a given
 *   `cacheKey` within `cache`. Later calls with the same key reuse the memoized
 *   component and ignore the passed loader.
 * @param cacheKey - Route-unique key identifying the lazy component.
 * @param cache - The cache instance that owns this route generation.
 */
export function createLazyElement(
  loader: () => Promise<any>,
  cacheKey: string,
  cache: LazyComponentCache,
): React.ReactElement {
  let LazyComponent = cache.get(cacheKey);

  if (!LazyComponent) {
    LazyComponent = lazy(loader);
    cache.set(cacheKey, LazyComponent);
  }

  return React.createElement(
    Suspense,
    { fallback: React.createElement(RouteLoadingFallback) },
    React.createElement(LazyComponent),
  );
}
