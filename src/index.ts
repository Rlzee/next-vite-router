// Routes
export { createRouteGenerator } from './routes/generator';
export { buildRouteTree } from './routes/tree';
export { treeToRoutes } from './routes/converter';

// Middleware
export { registerMiddleware, clearMiddlewares } from './middleware/index.middleware';

// Config
export { configureRouter } from './config/index.config';

// Types
export type {
  RouterConfig,
  RouteNode,
  RouteMiddleware,
  RouteModuleLoader,
} from './types/index.type';

// Utils
export { normalizeSegment, extractRoutePath } from './utils/path';
export type { RouteFileOptions } from './utils/path';
export { createLazyElement } from './utils/lazy';
export { useParams } from './router-params';
export { CatchAllParamProvider } from './router-params-context';