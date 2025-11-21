// Routes
export { createRouteGenerator } from './routes/generator';
export { buildRouteTree } from './routes/tree';
export { treeToRoutes } from './routes/converter';

// Middleware
export { registerMiddleware, clearMiddlewares } from './middleware/index.middleware';

// Config
export { configureRouter } from './config/index.config';

// Plugin
export { nextViteRouter } from './plugin/index.plugin';
export type { NextViteRouterPluginOptions } from './plugin/index.plugin';

// Types
export type {
  RouterConfig,
  RouteNode,
  RouteMiddleware
} from './types/index.type';

// Utils
export { normalizeSegment, extractRoutePath } from './utils/path';
export { createLazyElement } from './utils/lazy';