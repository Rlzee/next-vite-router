import React, { lazy, Suspense } from "react";
import { getRouterConfig } from '../config/index.config';
import { applyMiddlewares } from '../middleware/index.middleware';

const DefaultLoadingFallback = () => React.createElement("div");
const lazyComponentCache = new Map<string, React.LazyExoticComponent<any>>();

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
 * Create a lazy element wrapped with Suspense and apply middlewares
 * @param loader - Function that loads the component
 * @param cacheKey - Unique key for the cache
 * @param routePath - Route path for middlewares
 */
export function createLazyElement(
  loader: () => Promise<any>,
  cacheKey: string,
  routePath?: string
): React.ReactElement {
  let LazyComponent = lazyComponentCache.get(cacheKey);

  if (!LazyComponent) {
    LazyComponent = lazy(loader);
    lazyComponentCache.set(cacheKey, LazyComponent);
  }

  const suspenseElement = React.createElement(
    Suspense,
    { fallback: React.createElement(RouteLoadingFallback) },
    React.createElement(LazyComponent)
  );

  if (routePath) {
    return applyMiddlewares(routePath, suspenseElement);
  }

  return suspenseElement;
}
