import { matchRoutes, type RouteObject } from "react-router-dom";
import { normalizeRequestTarget } from "./request-target";

export { normalizeRequestTarget } from "./request-target";

export type RouteNotFoundHandle = { notFound: true };

export const NOT_FOUND_ROUTE_HANDLE: RouteNotFoundHandle = { notFound: true };

export function isNotFoundRoute(route: { handle?: unknown }): boolean {
  const handle = route.handle;
  return typeof handle === "object"
    && handle !== null
    && (handle as Partial<RouteNotFoundHandle>).notFound === true;
}

export function isUnmatched(routes: RouteObject[], url: string): boolean {
  const matches = matchRoutes(routes, normalizeRequestTarget(url));
  if (!matches) return true;
  return isNotFoundRoute(matches[matches.length - 1].route);
}

export function getRouteStatus(routes: RouteObject[], url: string): 200 | 404 {
  return isUnmatched(routes, url) ? 404 : 200;
}
