import type { RouterConfig } from "../index";

const defaultRouterConfig: RouterConfig = {
  enableLazyLoading: true,
};

let routerConfig: RouterConfig = { ...defaultRouterConfig };

export function configureRouter(config: RouterConfig): void {
  routerConfig = { ...routerConfig, ...config };
}

/**
 * Restore the module-level router configuration to its defaults.
 *
 * `configureRouter` merges, so it can never drop keys back to their initial
 * state. A dedicated reset lets isolated contexts (for example tests) start
 * from a known configuration instead of inheriting whatever was set globally
 * before, matching the explicit reset offered by `clearLazyCache` for the lazy
 * component cache.
 */
export function resetRouterConfig(): void {
  routerConfig = { ...defaultRouterConfig };
}

export function getRouterConfig(): RouterConfig {
  return routerConfig;
}