import type { RouteNode } from '../index';
import { extractRoutePath } from '../utils/index.utils';

function addFileToTree(
  root: RouteNode,
  filePath: string,
  fileContent: any,
  fileType: 'layout' | 'page' | 'notFound'
): void {
  const routePath = extractRoutePath(filePath);
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
  notFounds: Record<string, () => Promise<any>>
): RouteNode {
  const root: RouteNode = {
    segment: "",
    fullPath: "",
    children: new Map(),
  };

  Object.entries(layouts).forEach(([filePath, module]) => {
    addFileToTree(root, filePath, (module as any).default, 'layout');
  });

  Object.entries(pages).forEach(([filePath, loader]) => {
    addFileToTree(root, filePath, loader, 'page');
  });

  Object.entries(notFounds).forEach(([filePath, loader]) => {
    addFileToTree(root, filePath, loader, 'notFound');
  });

  return root;
}
