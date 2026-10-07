import React from "react";
import type { RouteObject } from "react-router-dom";
import type { RouteNode } from '../index';
import { normalizeSegment, createLazyElement } from '../utils/index.utils';
import { applyMiddlewares } from '../middleware/index.middleware';

function applyLayoutMiddleware(path: string, layout: React.ComponentType): React.ReactElement {
  return applyMiddlewares(path, React.createElement(layout));
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

  const catchAllMatch = node.segment.match(/^\[\[?\.\.\.(.+?)\]\]?$/);
  const handle = catchAllMatch ? { catchAllParam: catchAllMatch[1] } : undefined;

  return isIndex
    ? { index: true, element, handle }
    : { path: normalizeSegment(node.segment), element, handle };
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

function processChildren(
  node: RouteNode,
  currentPath: string
): RouteObject[] {
  const children: RouteObject[] = [];
  
  [...node.children.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([segment, childNode]) => {
    const normalizedSegment = normalizeSegment(segment);
    const childPath = normalizedSegment 
      ? (currentPath ? `${currentPath}/${normalizedSegment}` : `/${normalizedSegment}`)
      : currentPath;
    
      children.push(...treeToRoutes(childNode, false, childPath));
    });
  
  return children;
}

function createNodeChildren(node: RouteNode, currentPath: string): RouteObject[] {
  const children: RouteObject[] = [];

  if (node.page) {
    children.push(createPageRoute(node, currentPath || "/", true));
  }

  children.push(...processChildren(node, currentPath));

  if (node.notFound) {
    children.push(createNotFoundRoute(node));
  }

  return children;
}

export function treeToRoutes(
  node: RouteNode,
  isRoot = false,
  currentPath = ""
): RouteObject[] {
  const routes: RouteObject[] = [];
  
  if (isRoot) {
    const children = createNodeChildren(node, "");
    if (node.layout) {
      routes.push({
      path: "/",
      element: applyLayoutMiddleware("/", node.layout),
      children,
      });
      return routes;
    }

    if (node.page) {
      routes.push({
        path: "/",
        element: createPageRoute(node, "/", false).element,
        children: children.slice(1).length > 0 ? children.slice(1) : undefined,
      });
      return routes;
    }

    if (node.notFound) {
      routes.push({
        path: "/",
        children,
      });
      return routes;
    }

    return children;
  }

  const normalizedSegment = normalizeSegment(node.segment);
  const isPathless = !normalizedSegment;
  const nodePath = isPathless
    ? currentPath
    : currentPath + "/" + normalizedSegment;
  const descendants = processChildren(node, nodePath);
  const notFound = node.notFound ? [createNotFoundRoute(node)] : [];

  if (node.layout) {
    const children = createNodeChildren(node, nodePath);
    return [{
      ...(isPathless ? {} : { path: normalizedSegment }),
      element: applyLayoutMiddleware(nodePath, node.layout),
      children: children.length > 0 ? children : undefined,
    }];
  }

  if (node.page && !isPathless) {
    return [{
      path: normalizedSegment,
      element: createPageRoute(node, nodePath).element,
      children: [...descendants, ...notFound].length > 0
        ? [...descendants, ...notFound]
        : undefined,
    }];
  }

  if (node.page || node.notFound || !isPathless) {
    const children = [
      ...(node.page ? [createPageRoute(node, nodePath, true)] : []),
      ...descendants,
      ...notFound,
    ];
    return [{
      ...(isPathless ? {} : { path: normalizedSegment }),
      children: children.length > 0 ? children : undefined,
    }];
  }

  return descendants;
}
