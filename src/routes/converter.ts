import React from "react";
import {
  useParams as useReactRouterParams,
  type RouteObject,
} from "react-router-dom";
import type { RouteModuleLoader, RouteNode } from '../index';
import {
  createLazyCache,
  createLazyElement,
  compareOrdinal,
  parseRouteSegments,
  routeSegmentToPath,
  type LazyComponentCache,
} from '../utils/index.utils';
import { CatchAllParamProvider } from '../router-params-context';

function isOptionalCatchAll(segment: string): boolean {
  const parsed = parseRouteSegments(segment)[0];
  return parsed?.kind === "catchAll" && parsed.optional;
}

function isRequiredCatchAll(segment: string): boolean {
  const parsed = parseRouteSegments(segment)[0];
  return parsed?.kind === "catchAll" && !parsed.optional;
}

/**
 * Element rendered at the base URL of a *required* catch-all (`[...slug]`).
 *
 * React Router's `*` splat consumes zero or more segments, and no pattern can
 * raise that floor to one: a splat branch always claims its base URL (`/blog`),
 * because the static parent matches it even when the splat child does not.
 * Next.js treats a required catch-all as one-or-more segments, so the base is
 * a 404. This guard lives on an index route at the base and reproduces that:
 * an empty splat renders the nearest ancestor `not-found` (nothing, when the
 * app declares none) instead of the page below.
 *
 * The index route makes the base a real leaf match, which also stops the
 * splat branch's static parent from swallowing the base before a `not-found`
 * splat elsewhere in the tree can be considered.
 */
function CatchAllBaseGuard({ fallback, children }: {
  fallback?: React.ReactNode;
  children?: React.ReactNode;
}): React.ReactNode {
  // Read React Router's own params, not the package `useParams`: the guard
  // renames nothing, and it may render the not-found without any provider.
  const splat = useReactRouterParams()["*"];
  const hasSegments = splat !== undefined && splat.split("/").some(Boolean);

  return hasSegments ? children ?? null : fallback ?? null;
}

/**
 * `*` route rendering the not-found of the folder that owns it. A required
 * catch-all page child suppresses it (see `processChildren`), because its own
 * splat already covers that region.
 */
function createNotFoundRoute(
  node: RouteNode,
  cache: LazyComponentCache,
  loader: RouteModuleLoader = node.notFound!,
  cacheKey: string = `notfound:${node.fullPath}`,
): RouteObject {
  return {
    path: "*",
    element: createLazyElement(
      async () => {
        const mod = await loader();
        return { default: mod.default };
      },
      cacheKey,
      cache,
    ),
  };
}

function createNotFoundRoutes(
  node: RouteNode,
  cache: LazyComponentCache,
): RouteObject[] {
  return node.notFound ? [createNotFoundRoute(node, cache)] : [];
}

function normalizedSegment(segment: string): string {
  const parsed = parseRouteSegments(segment)[0];
  return parsed ? routeSegmentToPath(parsed) : "";
}

function createIndexRoute(
  node: RouteNode,
  nodePath: string,
  cache: LazyComponentCache,
): RouteObject {
  return createPageRoute(node, nodePath, cache, true);
}

/**
 * Expose a catch-all folder under the name it declares (`[...slug]` -> `slug`)
 * to everything rendered below this element.
 *
 * React Router only ever reports the splat under the unnamed `*` key, so the
 * package's `useParams` and `useCatchAll` read this context to rename it.
 */
function withCatchAllParam(
  rawSegment: string,
  element: React.ReactElement,
): React.ReactElement {
  const routeSegment = parseRouteSegments(rawSegment)[0];
  return routeSegment?.kind === "catchAll"
    ? React.createElement(CatchAllParamProvider, {
        name: routeSegment.name,
        children: element,
      })
    : element;
}

function createPageRoute(
  node: RouteNode,
  nodePath: string,
  cache: LazyComponentCache,
  isIndex: boolean = false
): RouteObject {
  const page = node.page;
  if (!page) {
    throw new Error(`Route node "${node.fullPath}" has no page loader`);
  }

  const element = createLazyElement(
    async () => {
      const mod = await page();
      return { default: mod.default };
    },
    `page:${node.fullPath || nodePath}`,
    cache,
  );

  const routeElement = withCatchAllParam(node.segment, element);

  return isIndex
    ? { index: true, element: routeElement }
    : { path: normalizedSegment(node.segment), element: routeElement };
}

/**
 * Element a layout route renders.
 *
 * An eager layout renders its component directly, inside the entry chunk. A
 * layout coming from a non-eager glob (`lazyLayout`) goes through the shared
 * lazy cache, so one generation memoizes a single `React.lazy` component per
 * layout and suspends behind the configured fallback while Vite loads its
 * chunk. The subtree is rendered by the layout's own `Outlet`, so it waits for
 * the layout chunk instead of being requested alongside it.
 *
 * The catch-all provider wraps the layout element itself, not only the page, so
 * a layout declared inside the catch-all folder can read the parameter.
 */
function createLayoutElement(
  node: RouteNode,
  nodePath: string,
  cache: LazyComponentCache,
): React.ReactElement {
  const element = node.lazyLayout
    ? createLazyElement(
        node.lazyLayout,
        `layout:${node.fullPath || nodePath}`,
        cache,
      )
    : React.createElement(node.layout!);

  return withCatchAllParam(node.segment, element);
}

function hasLayout(node: RouteNode): boolean {
  return Boolean(node.layout || node.lazyLayout);
}

function createLayoutRoute(
  nodeSegment: string,
  element: React.ReactElement,
  children: RouteObject[],
): RouteObject {
  return {
    ...(nodeSegment ? { path: nodeSegment } : {}),
    element,
    children: children.length > 0 ? children : undefined,
  };
}

/**
 * The tree walk of one folder's children: the routes each child contributes
 * plus `childClaimsSplats`, true when a child is a required catch-all with a
 * page. Such a child takes the splat route that would otherwise sit beside it,
 * so the folder's own `not-found` must not also emit a `*` there - it becomes
 * that guard's base fallback instead (`blog/not-found.tsx` serving `/blog`).
 * Both come out of the same enumeration of `node.children`, which the
 * traversal-cost test in `routes.test.js` pins to one read per node.
 */
function processChildren(
  node: RouteNode,
  currentPath: string,
  cache: LazyComponentCache,
  notFoundFallback: RouteModuleLoader | undefined,
): { routes: RouteObject[]; childClaimsSplats: boolean } {
  const routes: RouteObject[] = [];
  let childClaimsSplats = false;

  [...node.children.entries()]
    // Ordinal, not locale-aware: children order the emitted route array, and a
    // collation that varies with the machine would reorder the generated tree.
    .sort(([left], [right]) => compareOrdinal(left, right))
    .forEach(([segment, childNode]) => {
    if (childNode.page && isRequiredCatchAll(childNode.segment)) {
      childClaimsSplats = true;
    }
    const childSegment = normalizedSegment(segment);
    const childPath = childSegment
      ? (currentPath ? `${currentPath}/${childSegment}` : `/${childSegment}`)
      : currentPath;
    
      routes.push(...treeToRoutes(
        childNode,
        false,
        childPath,
        cache,
        notFoundFallback,
      ));
    });

  return { routes, childClaimsSplats };
}

/**
 * Index route holding the base guard of a required catch-all.
 *
 * The fallback is the folder's own `not-found` when it has one, else the
 * nearest ancestor's. Without any `not-found` the guard renders nothing, the
 * same blank 404 Next.js paints for an app without a `not-found.tsx`.
 */
function createCatchAllBaseRoute(
  node: RouteNode,
  cache: LazyComponentCache,
  inheritedFallback: RouteModuleLoader | undefined,
): RouteObject {
  const fallbackLoader = node.notFound ?? inheritedFallback;
  const fallback = fallbackLoader
    ? createLazyElement(
        async () => ({ default: (await fallbackLoader()).default }),
        `notfound:${node.fullPath}:base`,
        cache,
      )
    : undefined;

  return {
    index: true,
    element: React.createElement(CatchAllBaseGuard, { fallback }),
  };
}

/**
 * Routes a required catch-all page folder contributes to its parent: a guard
 * index that answers the base URL (`/blog`) plus the splat route carrying the
 * page for everything below it.
 *
 * React Router's `*` consumes zero or more segments and its static parents
 * partial-match, so no pattern lifts that floor to one segment: a splat branch
 * always claims `/blog`, which used to paint the layout with an empty outlet
 * (or the page with an empty catch-all). Placing a guard on an index route one
 * level up makes the base a real leaf match, so Next.js's one-or-more contract
 * holds: `/blog` answers with the nearest `not-found`, and only `/blog/...`
 * renders the page.
 */
function createRequiredCatchAllRoutes(
  node: RouteNode,
  nodePath: string,
  cache: LazyComponentCache,
  notFoundFallback: RouteModuleLoader | undefined,
): RouteObject[] {
  return [
    createCatchAllBaseRoute(node, cache, notFoundFallback),
    createPageRoute(node, nodePath, cache),
  ];
}

function createNodeChildren(
  node: RouteNode,
  currentPath: string,
  cache: LazyComponentCache,
  notFoundFallback: RouteModuleLoader | undefined,
): RouteObject[] {
  const children: RouteObject[] = [];

  if (node.page) {
    children.push(createIndexRoute(node, currentPath || "/", cache));
  }

  const { routes, childClaimsSplats } = processChildren(
    node, currentPath, cache, notFoundFallback,
  );
  children.push(...routes);

  if (!childClaimsSplats) {
    children.push(...createNotFoundRoutes(node, cache));
  }

  return children;
}

function createPageRoutes(
  node: RouteNode,
  currentPath: string,
  nodePath: string,
  nodeSegment: string,
  descendants: RouteObject[],
  notFound: RouteObject[],
  cache: LazyComponentCache,
  notFoundFallback: RouteModuleLoader | undefined,
): RouteObject[] {
  if (isOptionalCatchAll(node.segment)) {
    const catchAllChildren = [...descendants, ...notFound];
    return [
      createIndexRoute(node, currentPath, cache),
      {
        path: nodeSegment,
        element: createPageRoute(node, nodePath, cache).element,
        children: catchAllChildren.length > 0 ? catchAllChildren : undefined,
      },
    ];
  }

  if (isRequiredCatchAll(node.segment)) {
    return [
      ...createRequiredCatchAllRoutes(node, nodePath, cache, notFoundFallback),
      // A hand-built tree can still attach files under the catch-all folder;
      // file validation rejects them, but keep them reachable rather than
      // silently dropping them here.
      ...descendants,
      ...notFound,
    ];
  }

  if (descendants.length > 0 || notFound.length > 0) {
    return [{
      path: nodeSegment,
      children: [
        createIndexRoute(node, nodePath, cache),
        ...descendants,
        ...notFound,
      ],
    }];
  }

  return [{
    path: nodeSegment,
    element: createPageRoute(node, nodePath, cache).element,
  }];
}

function createPathlessNodeRoutes(
  node: RouteNode,
  nodePath: string,
  descendants: RouteObject[],
  notFound: RouteObject[],
  cache: LazyComponentCache,
): RouteObject[] {
  const children = [
    ...(node.page ? [createIndexRoute(node, nodePath, cache)] : []),
    ...descendants,
    ...notFound,
  ];

  return [{
    children: children.length > 0 ? children : undefined,
  }];
}

function createRootRoutes(
  node: RouteNode,
  cache: LazyComponentCache,
): RouteObject[] {
  const notFoundFallback = node.notFound;
  const children = createNodeChildren(node, "", cache, notFoundFallback);

  if (hasLayout(node)) {
    return [{
      path: "/",
      element: createLayoutElement(node, "/", cache),
      children,
    }];
  }

  if (node.page) {
    if (children.length > 1) {
      return [{ path: "/", children }];
    }

    return [{
      path: "/",
      element: createPageRoute(node, "/", cache, false).element,
    }];
  }

  if (node.notFound) {
    return [{ path: "/", children }];
  }

  return children;
}

export function treeToRoutes(
  node: RouteNode,
  isRoot = false,
  currentPath = "",
  cache: LazyComponentCache = createLazyCache(),
  notFoundFallback: RouteModuleLoader | undefined = undefined,
): RouteObject[] {
  if (isRoot) {
    return createRootRoutes(node, cache);
  }

  // Folders below this one can use its `not-found` as the base fallback for a
  // required catch-all; a folder's own `not-found` shadows an ancestor's.
  const inheritedNotFound = node.notFound ?? notFoundFallback;

  const nodeSegment = normalizedSegment(node.segment);
  const isPathless = !nodeSegment;
  const nodePath = isPathless
    ? currentPath
    : currentPath + "/" + nodeSegment;

  // `processChildren` walks the whole subtree, so every branch that needs the
  // walk must do it exactly once. Computing the descendants eagerly here and
  // letting `createNodeChildren` walk the subtree again doubled the work per
  // nested layout level, which grows as 2^depth.
  if (hasLayout(node)) {
    if (isRequiredCatchAll(node.segment) && node.page) {
      // A catch-all folder with both a layout and a page: the layout stays on
      // the splat route, and the page - provider included - moves to a `*`
      // child rendered through the layout's Outlet. The guard index is the
      // splat's sibling, so the base URL answers without pretending the
      // catch-all matched, and the not-found still renders inside this
      // folder's layout.
      const pageRoute = createPageRoute(node, nodePath, cache);
      return [
        createCatchAllBaseRoute(node, cache, notFoundFallback),
        {
          path: nodeSegment,
          element: createLayoutElement(node, nodePath, cache),
          children: [{ path: "*", element: pageRoute.element }],
        },
      ];
    }

    return [createLayoutRoute(
      isPathless ? "" : nodeSegment,
      createLayoutElement(node, nodePath, cache),
      createNodeChildren(node, nodePath, cache, inheritedNotFound),
    )];
  }

  const {
    routes: descendants,
    childClaimsSplats,
  } = processChildren(node, nodePath, cache, inheritedNotFound);
  const notFound = createNotFoundRoutes(node, cache);

  if (node.page && !isPathless) {
    return createPageRoutes(
      node,
      currentPath,
      nodePath,
      nodeSegment,
      descendants,
      notFound,
      cache,
      notFoundFallback,
    );
  }

  if (node.page || node.notFound || !isPathless) {
    // A required catch-all child already covers this folder's splat region, so
    // the folder's own `not-found` only serves as that guard's base fallback.
    const ownNotFound = childClaimsSplats ? [] : notFound;
    return isPathless
      ? createPathlessNodeRoutes(node, nodePath, descendants, ownNotFound, cache)
      : [{
          path: nodeSegment,
          children: [
            ...(node.page ? [createIndexRoute(node, nodePath, cache)] : []),
            ...descendants,
            ...ownNotFound,
          ],
        }];
  }

  return descendants;
}
