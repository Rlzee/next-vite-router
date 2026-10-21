import React from "react";
import type { RouteObject } from "react-router-dom";
import type { RouteNode } from '../index';
import {
  createLazyCache,
  createLazyElement,
  parseRouteSegments,
  routeSegmentToPath,
  type LazyComponentCache,
} from '../utils/index.utils';
import { CatchAllParamProvider } from '../router-params-context';

function isOptionalCatchAll(segment: string): boolean {
  const parsed = parseRouteSegments(segment)[0];
  return parsed?.kind === "catchAll" && parsed.optional;
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

function createNotFoundRoute(
  node: RouteNode,
  cache: LazyComponentCache,
): RouteObject {
  const notFound = node.notFound;
  if (!notFound) {
    throw new Error(`Route node "${node.fullPath}" has no not-found loader`);
  }

  return {
    path: "*",
    element: createLazyElement(
      async () => {
        const mod = await notFound();
        return { default: mod.default };
      },
      `notfound:${node.fullPath}`,
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

function processChildren(
  node: RouteNode,
  currentPath: string,
  cache: LazyComponentCache,
): RouteObject[] {
  const children: RouteObject[] = [];
  
  [...node.children.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([segment, childNode]) => {
    const childSegment = normalizedSegment(segment);
    const childPath = childSegment
      ? (currentPath ? `${currentPath}/${childSegment}` : `/${childSegment}`)
      : currentPath;
    
      children.push(...treeToRoutes(childNode, false, childPath, cache));
    });
  
  return children;
}

function createNodeChildren(
  node: RouteNode,
  currentPath: string,
  cache: LazyComponentCache,
): RouteObject[] {
  const children: RouteObject[] = [];

  if (node.page) {
    children.push(createIndexRoute(node, currentPath || "/", cache));
  }

  children.push(...processChildren(node, currentPath, cache));

  children.push(...createNotFoundRoutes(node, cache));

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
  const children = createNodeChildren(node, "", cache);

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
): RouteObject[] {
  if (isRoot) {
    return createRootRoutes(node, cache);
  }

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
    return [createLayoutRoute(
      isPathless ? "" : nodeSegment,
      createLayoutElement(node, nodePath, cache),
      createNodeChildren(node, nodePath, cache),
    )];
  }

  const descendants = processChildren(node, nodePath, cache);
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
    );
  }

  if (node.page || node.notFound || !isPathless) {
    return isPathless
      ? createPathlessNodeRoutes(node, nodePath, descendants, notFound, cache)
      : [{
          path: nodeSegment,
          children: [
            ...(node.page ? [createIndexRoute(node, nodePath, cache)] : []),
            ...descendants,
            ...notFound,
          ],
        }];
  }

  return descendants;
}
