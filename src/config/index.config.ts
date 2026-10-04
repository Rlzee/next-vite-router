import type { RouterConfig } from "../index";

const defaultRouterConfig: RouterConfig = {
  enableLazyLoading: true,
};

let routerConfig: RouterConfig = { ...defaultRouterConfig };

export function configureRouter(config: RouterConfig): void {
  routerConfig = { ...routerConfig, ...config };
}

export function getRouterConfig(): RouterConfig {
  return routerConfig;
}