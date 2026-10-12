import React from "react";
import type { RouteObject } from "react-router-dom";
import type { RouteNode } from '../index';
import {
  createLazyElement,
  parseRouteSegments,
  routeSegmentToPath,
} from '../utils/index.utils';
import { applyMiddlewares } from '../middleware/index.middleware';
import { CatchAllParamProvider } from '../router-params-context';

function applyLayoutMiddleware(path: string, layout: React.ComponentType): React.ReactElement {
  return applyMiddlewares(path, React.createElement(layout));
}

function isOptionalCatchAll(segment: string): boolean {
  const parsed = parseRouteSegments(segment)[0];
  return parsed?.kind === "catchAll" && parsed.optional;
}

function normalizedSegment(segment: string): string {
  const parsed = parseRouteSegments(segment)[0];
  return parsed ? routeSegmentToPath(parsed) : "";
}

function createIndexRoute(node: RouteNode, nodePath: string): RouteObject {
  return createPageRoute(node, nodePath, true);
}

function createPageRoute(
  node: RouteNode,
  nodePath: string,
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
    nodePath
  );

  const routeSegment = parseRouteSegments(node.segment)[0];
  const routeElement = routeSegment?.kind === "catchAll"
    ? React.createElement(CatchAllParamProvider, {
        name: routeSegment.name,
        children: element,
      })
    : element;

  return isIndex
    ? { index: true, element: routeElement }
    : { path: normalizedSegment(node.segment), element: routeElement };
}

function createNotFoundRoute(node: RouteNode): RouteObject {
  const notFound = node.notFound;
  if (!notFound) {
    throw new Error(`Route node "${node.fullPath}" has no not-found loader`);
  }

  const routePath = node.fullPath ? `/${node.fullPath}` : "/";
  return {
    path: "*",
    element: createLazyElement(
      async () => {
        const mod = await notFound();
        return { default: mod.default };
      },
      `notfound:${node.fullPath}`,
      routePath,
    ),
  };
}

function createNotFoundRoutes(node: RouteNode): RouteObject[] {
  return node.notFound ? [createNotFoundRoute(node)] : [];
}

function createLayoutRoute(
  nodePath: string,
  nodeSegment: string,
  layout: React.ComponentType,
  children: RouteObject[],
): RouteObject {
  return {
    ...(nodeSegment ? { path: nodeSegment } : {}),
    element: applyLayoutMiddleware(nodePath, layout),
    children: children.length > 0 ? children : undefined,
  };
}

function processChildren(
  node: RouteNode,
  currentPath: string
): RouteObject[] {
  const children: RouteObject[] = [];
  
  [...node.children.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([segment, childNode]) => {
    const childSegment = normalizedSegment(segment);
    const childPath = childSegment
      ? (currentPath ? `${currentPath}/${childSegment}` : `/${childSegment}`)
      : currentPath;
    
      children.push(...treeToRoutes(childNode, false, childPath));
    });
  
  return children;
}

function createNodeChildren(node: RouteNode, currentPath: string): RouteObject[] {
  const children: RouteObject[] = [];

  if (node.page) {
    children.push(createIndexRoute(node, currentPath || "/"));
  }

  children.push(...processChildren(node, currentPath));

  children.push(...createNotFoundRoutes(node));

  return children;
}

function createPageRoutes(
  node: RouteNode,
  currentPath: string,
  nodePath: string,
  nodeSegment: string,
  descendants: RouteObject[],
  notFound: RouteObject[],
): RouteObject[] {
  if (isOptionalCatchAll(node.segment)) {
    const catchAllChildren = [...descendants, ...notFound];
    return [
      createIndexRoute(node, currentPath),
      {
        path: nodeSegment,
        element: createPageRoute(node, nodePath).element,
        children: catchAllChildren.length > 0 ? catchAllChildren : undefined,
      },
    ];
  }

  if (descendants.length > 0 || notFound.length > 0) {
    return [{
      path: nodeSegment,
      children: [
        createIndexRoute(node, nodePath),
        ...descendants,
        ...notFound,
      ],
    }];
  }

  return [{
    path: nodeSegment,
    element: createPageRoute(node, nodePath).element,
  }];
}

function createPathlessNodeRoutes(
  node: RouteNode,
  nodePath: string,
  descendants: RouteObject[],
  notFound: RouteObject[],
): RouteObject[] {
  const children = [
    ...(node.page ? [createIndexRoute(node, nodePath)] : []),
    ...descendants,
    ...notFound,
  ];

  return [{
    children: children.length > 0 ? children : undefined,
  }];
}

function createRootRoutes(node: RouteNode): RouteObject[] {
  const children = createNodeChildren(node, "");

  if (node.layout) {
    return [{
      path: "/",
      element: applyLayoutMiddleware("/", node.layout),
      children,
    }];
  }

  if (node.page) {
    if (children.length > 1) {
      return [{ path: "/", children }];
    }

    return [{
      path: "/",
      element: createPageRoute(node, "/", false).element,
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
  currentPath = ""
): RouteObject[] {
  if (isRoot) {
    return createRootRoutes(node);
  }

  const nodeSegment = normalizedSegment(node.segment);
  const isPathless = !nodeSegment;
  const nodePath = isPathless
    ? currentPath
    : currentPath + "/" + nodeSegment;
  const descendants = processChildren(node, nodePath);
  const notFound = createNotFoundRoutes(node);

  if (node.layout) {
    return [createLayoutRoute(
      nodePath,
      isPathless ? "" : nodeSegment,
      node.layout,
      createNodeChildren(node, nodePath),
    )];
  }

  if (node.page && !isPathless) {
    return createPageRoutes(
      node,
      currentPath,
      nodePath,
      nodeSegment,
      descendants,
      notFound,
    );
  }

  if (node.page || node.notFound || !isPathless) {
    return isPathless
      ? createPathlessNodeRoutes(node, nodePath, descendants, notFound)
      : [{
          path: nodeSegment,
          children: [
            ...(node.page ? [createIndexRoute(node, nodePath)] : []),
            ...descendants,
            ...notFound,
          ],
        }];
  }

  return descendants;
}
