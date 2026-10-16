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
export { createLazyElement, clearLazyCache } from './utils/lazy';
export { useParams } from './router-params';
export { CatchAllParamProvider } from './router-params-context';