// Routes
export { createRouteGenerator } from './routes/generator';
export { buildRouteTree } from './routes/tree';
export { assertNoDuplicateRoutes } from './routes/tree';
export { assertNoRouteConflicts } from './routes/tree';
export { treeToRoutes } from './routes/converter';

// Config
export { configureRouter, resetRouterConfig } from './config/index.config';

// Types
export type {
  RouterConfig,
  RouteNode,
  RouteModuleLoader,
  RouteTreeOptions,
} from './types/index.type';

// Utils
export {
  normalizeSegment,
  extractRoutePath,
  parseRouteSegments,
  routeSegmentToPath,
} from './utils/path';
export type { RouteFileOptions } from './utils/path';
export type { RouteSegment } from './utils/path';
export { createLazyCache, createLazyElement, clearLazyCache } from './utils/lazy';
export type { LazyComponentCache } from './utils/lazy';
export { useParams, useCatchAll } from './router-params';
export { CatchAllParamProvider } from './router-params-context';
export { href, Link, createTypedLink } from './router-navigation';
export type {
  RouteHrefParams,
  LinkProps,
  RouteCatchAllMetadata,
  RouteHrefMetadata,
  RouteLinkMetadata,
} from './router-navigation';