// Internal runtime engine, imported by the module the Vite plugin generates
// (`next-vite-router/routes`) through a resolved file path, never a package
// specifier. It is deliberately absent from the package.json "exports" map, so
// application code cannot import these symbols from `next-vite-router` or any
// `next-vite-router/<subpath>`; the app-facing surface is the generated routes
// module, which re-exports them bound to the project's route metadata.
export { buildRouteTree } from "./routes/tree";
export { treeToRoutes } from "./routes/converter";
export { useParams, useCatchAll } from "./router-params";
export { CatchAllParamProvider } from "./router-params-context";
export { href, Link, createTypedLink } from "./router-navigation";

export type {
  RouteHrefParams,
  LinkProps,
  RouteCatchAllMetadata,
  RouteHrefMetadata,
  RouteLinkMetadata,
} from "./router-navigation";
