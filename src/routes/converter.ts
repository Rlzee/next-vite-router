import React from "react";
import type { RouteObject } from "react-router-dom";
import type { RouteNode } from '../index';
import { normalizeSegment, createLazyElement } from '../utils/index.utils';

function createPageRoute(
  node: RouteNode,
  nodePath: string,
  isIndex: boolean = false
): RouteObject {
  const element = createLazyElement(
    async () => {
      const mod = await node.page();
      return { default: (mod as any).default };
    },
    `page:${node.fullPath || nodePath}`,
    nodePath
  );

  return isIndex ? { index: true, element } : { path: normalizeSegment(node.segment), element };
}

function createNotFoundRoute(node: RouteNode): RouteObject {
  return {
    path: "*",
    element: createLazyElement(
      async () => {
        const mod = await node.notFound();
        return { default: (mod as any).default };
      },
      `notfound:${node.fullPath}`
    ),
  };
}

function processChildren(
  node: RouteNode,
  currentPath: string
): RouteObject[] {
  const children: RouteObject[] = [];
  
  node.children.forEach((childNode, segment) => {
    const normalizedSegment = normalizeSegment(segment);
    const childPath = normalizedSegment 
      ? (currentPath ? `${currentPath}/${normalizedSegment}` : `/${normalizedSegment}`)
      : currentPath;
    
    children.push(...treeToRoutes(childNode, false, childPath));
  });
  
  return children;
}

export function treeToRoutes(
  node: RouteNode,
  isRoot = false,
  currentPath = ""
): RouteObject[] {
  const routes: RouteObject[] = [];
  
  if (isRoot && node.layout) {
    const children: RouteObject[] = [];
    
    if (node.page) {
      children.push(createPageRoute(node, "/", true));
    }
    
    children.push(...processChildren(node, ""));
    
    if (node.notFound) {
      children.push(createNotFoundRoute(node));
    }
    
    routes.push({
      path: "/",
      element: React.createElement(node.layout),
      children,
    });
    
    return routes;
  }
  
  if (node.layout) {
    const normalizedSegment = normalizeSegment(node.segment);
    
    if (!normalizedSegment) {
      return processChildren(node, currentPath);
    }
    
    const nodePath = currentPath + "/" + normalizedSegment;
    const children: RouteObject[] = [];
    
    if (node.page) {
      children.push(createPageRoute(node, nodePath, true));
    }
    
    children.push(...processChildren(node, nodePath));
    
    if (node.notFound) {
      children.push(createNotFoundRoute(node));
    }
    
    routes.push({
      path: normalizedSegment,
      element: React.createElement(node.layout),
      children: children.length > 0 ? children : undefined,
    });
    
    return routes;
  }
  
  if (node.page) {
    const normalizedSegment = normalizeSegment(node.segment);
    
    if (!normalizedSegment) {
      return processChildren(node, currentPath);
    }
    
    const nodePath = currentPath + "/" + normalizedSegment;
    const children = processChildren(node, nodePath);
    
    const pageRoute = createPageRoute(node, nodePath, false);
    
    routes.push({
      path: pageRoute.path,
      element: pageRoute.element,
      children: children.length > 0 ? children : undefined,
    });
    
    return routes;
  }
  
  return processChildren(node, currentPath);
}
