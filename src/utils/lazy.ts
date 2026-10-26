import React, { lazy, Suspense } from "react";
import { getRouterConfig } from '../config/index.config';

const DefaultLoadingFallback = () => React.createElement("div");

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
 * Resolve the configured loading fallback at render time rather than at route
 * generation time.
 *
 * `treeToRoutes` / `generateRoutes` build React elements eagerly, so reading
 * `getRouterConfig()` while creating them captures whatever configuration
 * existed at that moment. When `generateRoutes()` is called at module scope
 * (the "Use React Router directly" pattern, or `createRouteGenerator`), that
 * happens before `configureRouter(...)` runs during app setup, so a later
 * `loadingFallback` or `enableLazyLoading` change would be ignored. Rendering a
 * dedicated fallback component defers the read until the route is actually
 * painted, keeping the `Suspense` boundary stable while honoring the latest
 * configuration.
 */
function RouteLoadingFallback() {
  const config = getRouterConfig();

  // The loader stays asynchronous even when lazy loading is disabled, so keep
  // the Suspense boundary but render no configured fallback for it.
  if (config.enableLazyLoading === false) {
    return null;
  }

  const FallbackComponent = config.loadingFallback || DefaultLoadingFallback;
  return React.createElement(FallbackComponent);
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
