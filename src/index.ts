// Routes
export { createRouteGenerator } from './routes/generator';
export { buildRouteTree } from './routes/tree';
export { assertNoDuplicateRoutes } from './routes/tree';
export { assertNoRouteConflicts } from './routes/tree';
export { treeToRoutes } from './routes/converter';

// Types
export type {
  RouteNode,
  RouteFileRecords,
  RouteModuleLoader,
  RouteTreeOptions,
  LayoutRecordShape,
  RouteErrorProps,
  RouteErrorComponent,
} from './types/index.type';

// Utils
export {
  extractRoutePath,
  parseRouteSegments,
  routeSegmentToPath,
} from './utils/path';
export type { RouteFileOptions } from './utils/path';
export type { RouteSegment } from './utils/path';
export { createLazyCache, createLazyElement, clearLazyCache } from './utils/lazy';
export type { LazyComponentCache } from './utils/lazy';

// The navigation helpers (`href`, `Link`, `createTypedLink`, `useParams`,
// `useCatchAll`, `CatchAllParamProvider`) are intentionally NOT exported here.
// They reach an application only through the module the Vite plugin generates
// (`next-vite-router/routes`), which binds them to the project's route metadata.
// They live in `src/plugin-runtime.ts`: a build entry kept out of the package
// "exports" map, so `import { href } from "next-vite-router"` does not resolve.