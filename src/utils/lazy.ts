import React, { lazy, Suspense } from "react";
import { getRouterConfig } from '../config/index.config';
import { applyMiddlewares } from '../middleware/index.middleware';

const DefaultLoadingFallback = () => React.createElement("div");
const lazyComponentCache = new Map<string, React.LazyExoticComponent<any>>();

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
  const config = getRouterConfig();
  
  // If lazy loading is disabled, return a wrapper that loads synchronously
  if (config.enableLazyLoading === false) {
    const DirectLoadComponent = React.lazy(loader);
    const element = React.createElement(
      Suspense,
      { fallback: null },  // No loading fallback when disabled
      React.createElement(DirectLoadComponent)
    );
    
    if (routePath) {
      return applyMiddlewares(routePath, element);
    }
    return element;
  }
  
  // Lazy loading enabled: use cache and show loading fallback
  let LazyComponent = lazyComponentCache.get(cacheKey);
  
  if (!LazyComponent) {
    LazyComponent = lazy(loader);
    lazyComponentCache.set(cacheKey, LazyComponent);
  }
  
  const FallbackComponent = config.loadingFallback || DefaultLoadingFallback;
  
  const suspenseElement = React.createElement(
    Suspense,
    { fallback: React.createElement(FallbackComponent) },
    React.createElement(LazyComponent)
  );
  
  if (routePath) {
    return applyMiddlewares(routePath, suspenseElement);
  }
  
  return suspenseElement;
}
