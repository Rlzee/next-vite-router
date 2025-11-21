import type { RouterConfig } from "../index";

let routerConfig: RouterConfig = {};

export function configureRouter(config: RouterConfig): void {
  routerConfig = { ...routerConfig, ...config };
}

export function getRouterConfig(): RouterConfig {
  return routerConfig;
}