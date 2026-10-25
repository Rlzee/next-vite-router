import type { ComponentType } from 'react';

export type RouteModuleLoader = () => Promise<{ default: ComponentType }>;

/**
 * How the layouts record handed to `buildRouteTree` must be read.
 *
 * A component, a loader, and a module namespace come out of three different
 * `import.meta.glob` shapes, and the router is not allowed to guess between them
 * - so the shape is declared, and an ambiguous value is rejected at build time
 * instead of failing inside React later.
 */
export type LayoutRecordShape = "module" | "component" | "loader";

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
   * The shape of the layouts record. Defaults to `"module"`, the output of the
   * eager glob the Vite plugin emits:
   *
   * - `"module"` - every entry is a module namespace
   *   (`import.meta.glob(layouts, { eager: true })`). A bare function is rejected
   *   here unless it is a class component, because a non-eager glob produces bare
   *   functions too: the caller has to say which one it means.
   * - `"component"` - an entry may be the unwrapped component itself
   *   (`{ eager: true, import: "default" }`).
   * - `"loader"` - a function entry is `() => import("...")` and lands in
   *   `RouteNode.lazyLayout`; module entries are still read as eager components,
   *   so a mixed record keeps working.
   *
   * What a declaration cannot cover is a wrong declaration: passing loaders as
   * `"component"` only surfaces in React ("Objects are not valid as a React child
   * (found: [object Promise])"), because checking it would mean invoking the
   * value.
   */
  layoutShape?: LayoutRecordShape;

  /**
   * Read `layout.tsx` entries as loaders (`() => import("...")`) instead of
   * eagerly imported modules, so Vite emits a separate chunk per layout.
   *
   * @deprecated Use `layoutShape: "loader"`, which names the same thing as the
   *   record shape it always described. Kept as an alias so existing manual
   *   callers keep working; the Vite plugin emits `layoutShape` directly.
   */
  lazyLayouts?: boolean;
}