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
   * This option is the declaration of the record's shape, and the only one: the
   * router never calls a layout to find out whether it is a component or a
   * loader. It must match the glob that produced the layouts record - pair it
   * with a non-eager `import.meta.glob(layouts)`. Module values are still read as
   * eager components, so a mixed record keeps working.
   *
   * What a mismatch costs: loaders declared as eager reach React as components
   * and are rejected there ("Objects are not valid as a React child (found:
   * [object Promise])"), because nothing may call them to find out. Components
   * declared as lazy are caught by name instead, once the "loader" fails to
   * resolve to a module with a default export. The plugin derives the glob and
   * this flag from one option, so a generated app cannot hit either. Defaults to
   * `false`.
   */
  lazyLayouts?: boolean;
}