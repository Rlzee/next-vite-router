import type { ReactElement } from 'react';

export type RouteNode = {
  segment: string;
  fullPath: string;
  page?: any;
  layout?: any;
  notFound?: any;
  children: Map<string, RouteNode>;
}

export type RouterConfig = {
  loadingFallback?: React.ComponentType;
  pagesDir?: string;
  enableLazyLoading?: boolean;
}

export type RouteMiddleware = (element: ReactElement) => ReactElement;