import type { ComponentType } from 'react';

export type RouteModuleLoader = () => Promise<{ default: ComponentType }>;

export type RouteNode = {
  segment: string;
  fullPath: string;
  page?: RouteModuleLoader;
  layout?: ComponentType;
  notFound?: RouteModuleLoader;
  children: Map<string, RouteNode>;
}

export type RouterConfig = {
  loadingFallback?: React.ComponentType;
  enableLazyLoading?: boolean;
}