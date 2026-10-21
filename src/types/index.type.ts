import type { ComponentType } from 'react';

export type RouteModuleLoader = () => Promise<{ default: ComponentType }>;

export type RouteNode = {
  segment: string;
  fullPath: string;
  page?: RouteModuleLoader;
  layout?: ComponentType;
  /**
   * Layout read out of a non-eager glob (`lazyLayouts`). Kept apart from
   * `layout`, which always holds a ready component, because a component and a
   * module loader are both functions: only the glob's shape tells them apart,
   * so the choice has to be recorded instead of guessed.
   */
  lazyLayout?: RouteModuleLoader;
  notFound?: RouteModuleLoader;
  children: Map<string, RouteNode>;
}

export type RouterConfig = {
  loadingFallback?: React.ComponentType;
  enableLazyLoading?: boolean;
}

export type RouteTreeOptions = {
  /**
   * Read `layout.tsx` entries as loaders (`() => import("...")`) instead of
   * eagerly imported modules, so Vite emits a separate chunk per layout.
   *
   * Must match the shape of the glob that produced the layouts record: pair it
   * with a non-eager `import.meta.glob(layouts)`. Module values are still read
   * as eager components, so a mixed record keeps working. Defaults to `false`.
   */
  lazyLayouts?: boolean;
}