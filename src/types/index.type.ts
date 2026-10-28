import type { ComponentType } from 'react';

export type RouteModuleLoader = () => Promise<{ default: ComponentType }>;

/**
 * Props `error.tsx` receives: the thrown error, and a `reset()` that retries the
 * render. The shape is structural because the component is a plain user file -
 * nothing imports these types to declare one.
 */
export type RouteErrorProps = {
  error: unknown;
  reset: () => void;
};

/** An `error.tsx` default export: a component that renders the failure of its subtree. */
export type RouteErrorComponent = ComponentType<RouteErrorProps>;

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
   * Layout read out of a non-eager glob (`layoutShape: "loader"`). Kept apart
   * from `layout`, which always holds a ready component, because a component and a
   * module loader are both functions: only the glob's shape tells them apart,
   * so the choice has to be recorded instead of guessed.
   */
  lazyLayout?: RouteModuleLoader;
  notFound?: RouteModuleLoader;
  /**
   * `loading.tsx` of this folder, read eagerly: the placeholder shown while the
   * folder's page (or one below it) is not ready yet. Eager because a lazily
   * loaded placeholder would wait for a chunk to announce that a chunk is
   * loading, and it is a few lines of markup by nature.
   */
  loading?: ComponentType;
  /**
   * `error.tsx` of this folder, read eagerly like `loading`. An error boundary
   * has to exist before the code it guards can fail, so a lazily loaded one
   * could not catch the failure of its own chunk.
   */
  error?: RouteErrorComponent;
  children: Map<string, RouteNode>;
}

export type RouterConfig = {
  loadingFallback?: React.ComponentType;
  enableLazyLoading?: boolean;
}

/**
 * The glob records `buildRouteTree` reads, one per route-file kind.
 *
 * Passed as a single object so a new kind costs one key instead of a new
 * positional slot between the loaders and the file options. Every key is
 * optional except `pages`: a folder tree with no `page.tsx` has no route. The
 * file-name options ride along in `fileOptions` because the records style has no
 * separate positional slot for them.
 */
export type RouteFileRecords = {
  pages: Record<string, () => Promise<any>>;
  layouts?: Record<string, any>;
  notFounds?: Record<string, () => Promise<any>>;
  loadings?: Record<string, any>;
  errors?: Record<string, any>;
  fileOptions?: import('../utils/index.utils').RouteFileOptions;
};

export type RouteTreeOptions = {
  /**
   * The shape of the layouts record. Defaults to `"module"`, the output of the
   * eager glob the Vite plugin emits:
   *
   * - `"module"` - every entry is a module namespace
   *   (`import.meta.glob(layouts, { eager: true })`). Any bare function is
   *   refused here, class included, because a non-eager glob produces bare
   *   functions too: the caller has to say which one it means.
   * - `"component"` - an entry may be the unwrapped component or class itself
   *   (`{ eager: true, import: "default" }`).
   * - `"loader"` - a function entry is `() => import("...")` and lands in
   *   `RouteNode.lazyLayout`; module entries are still read as eager components,
   *   so a mixed record keeps working.
   *
   * A wrong declaration is the one thing this option cannot protect against:
   * passing loaders as `"component"` surfaces only in React ("Objects are not
   * valid as a React child (found: [object Promise])"). Nothing can close that
   * gap. The runtime would have to invoke the value to tell the two apart, and
   * the type system cannot either: Vite types an eager record as
   * `Record<string, unknown>` whatever the module exports, so a signature
   * discriminated on `layoutShape` would reject the honest `"component"` case too
   * and push callers into `as any` casts - which then silence the lying case it
   * was meant to catch. The plugin emits the declaration that matches the glob it
   * wrote, so only a hand-built record can declare itself wrongly.
   */
  layoutShape?: LayoutRecordShape;
  /**
   * Match URLs case-sensitively, like Next.js. Defaults to `true`.
   *
   * React Router's own default is the opposite: a route without
   * `caseSensitive: true` matches its pattern with a case-insensitive regexp,
   * so `/USERS` would answer a `users/` folder and `/Blog/A` would match the
   * `/blog/*` catch-all. This package opts every emitted route in.
   * Set it to `false` to restore React Router's case-insensitive matching
   * for an app whose existing links come in mixed case.
   */
  caseSensitive?: boolean;
}