import type { RouteNode } from '../index';
import { extractRoutePath, normalizeSegment, type RouteFileOptions } from '../utils/index.utils';

function normalizedRoutePath(filePath: string, fileOptions?: RouteFileOptions): string {
  const routePath = extractRoutePath(filePath, fileOptions);
  const segments = routePath
    ? routePath.split("/").map(normalizeSegment).filter(Boolean)
    : [];
  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

export function assertNoDuplicateRoutes(
  filePaths: string[],
  fileOptions?: RouteFileOptions,
): void {
  const routes = new Map<string, string[]>();

  for (const filePath of filePaths) {
    const routePath = normalizedRoutePath(filePath, fileOptions);
    const entries = routes.get(routePath) ?? [];
    entries.push(filePath);
    routes.set(routePath, entries);
  }

  for (const [routePath, entries] of routes) {
    if (entries.length > 1) {
      throw new Error(
        `Duplicate route "${routePath}" detected:\n${entries
          .map((entry) => `  ${entry}`)
          .join("\n")}`,
      );
    }
  }
}

function addFileToTree(
  root: RouteNode,
  filePath: string,
  fileContent: any,
  fileType: 'layout' | 'page' | 'notFound',
  fileOptions?: RouteFileOptions,
): void {
  const routePath = extractRoutePath(filePath, fileOptions);
  const segments = routePath ? routePath.split("/") : [];
  
  let currentNode = root;
  let currentPath = "";
  
  segments.forEach((segment, index) => {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    
    if (!currentNode.children.has(segment)) {
      currentNode.children.set(segment, {
        segment,
        fullPath: currentPath,
        children: new Map(),
      });
    }
    
    currentNode = currentNode.children.get(segment)!;
    
    if (index === segments.length - 1) {
      currentNode[fileType] = fileContent;
    }
  });
  
  if (segments.length === 0) {
    root[fileType] = fileContent;
  }
}

export function buildRouteTree(
  pages: Record<string, () => Promise<any>>,
  layouts: Record<string, any>,
  notFounds: Record<string, () => Promise<any>>,
  fileOptions?: RouteFileOptions,
): RouteNode {
  assertNoDuplicateRoutes(Object.keys(pages), fileOptions);

  const root: RouteNode = {
    segment: "",
    fullPath: "",
    children: new Map(),
  };

  Object.entries(layouts).forEach(([filePath, module]) => {
    addFileToTree(root, filePath, (module as any).default, 'layout', fileOptions);
  });

  Object.entries(pages).forEach(([filePath, loader]) => {
    addFileToTree(root, filePath, loader, 'page', fileOptions);
  });

  Object.entries(notFounds).forEach(([filePath, loader]) => {
    addFileToTree(root, filePath, loader, 'notFound', fileOptions);
  });

  return root;
}
