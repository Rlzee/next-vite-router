import type { RouteNode } from '../index';
import {
  extractRoutePath,
  parseRouteSegments,
  routeSegmentToPath,
  type RouteFileOptions,
} from '../utils/index.utils';

type RouteCollision = {
  kind: "literal" | "pattern";
  filePath: string;
};

function canonicalSegment(segment: ReturnType<typeof parseRouteSegments>[number]): string {
  if (segment.kind === "group") return "";
  if (segment.kind === "catchAll") return "*";
  if (segment.kind === "dynamic") return ":param";
  return routeSegmentToPath(segment);
}

function normalizedRoutePaths(filePath: string, fileOptions?: RouteFileOptions): string[] {
  const routePath = extractRoutePath(filePath, fileOptions);
  const segments = parseRouteSegments(routePath, filePath);
  const canonicalSegments = segments.map(canonicalSegment).filter(Boolean);
  const paths = [
    canonicalSegments.length > 0 ? `/${canonicalSegments.join("/")}` : "/",
  ];

  const lastSegment = segments[segments.length - 1];
  if (lastSegment?.kind === "catchAll" && lastSegment.optional) {
    const baseSegments = canonicalSegments.slice(0, -1);
    paths.push(baseSegments.length > 0 ? `/${baseSegments.join("/")}` : "/");
  }

  return paths;
}

function collisionKind(path: string): RouteCollision["kind"] {
  return /(^|\/)(:param|\*)($|\/)/.test(path) ? "pattern" : "literal";
}

function assertNoCatchAllFallbackCollisions(
  pageFiles: string[],
  notFoundFiles: string[],
  fileOptions?: RouteFileOptions,
): void {
  const catchAllRoutes = pageFiles.flatMap((filePath) => {
    const routePath = extractRoutePath(filePath, fileOptions);
    const segments = parseRouteSegments(routePath, filePath);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment?.kind !== "catchAll") {
      return [];
    }

    const canonicalSegments = segments.map(canonicalSegment).filter(Boolean);
    const fullPath = canonicalSegments.length > 0
      ? `/${canonicalSegments.join("/")}`
      : "/";
    const parentSegments = canonicalSegments.slice(0, -1);
    const parentPath = parentSegments.length > 0
      ? `/${parentSegments.join("/")}`
      : "/";

    return [{ filePath, paths: new Set([fullPath, parentPath]) }];
  });

  const conflicts = new Map<
    string,
    { routePath: string; pageFile: string; notFoundFile: string }
  >();
  for (const notFoundFile of notFoundFiles) {
    for (const routePath of normalizedRoutePaths(notFoundFile, fileOptions)) {
      for (const catchAllRoute of catchAllRoutes) {
        if (catchAllRoute.paths.has(routePath)) {
          const key = `${routePath}\0${catchAllRoute.filePath}\0${notFoundFile}`;
          conflicts.set(key, {
              routePath,
              pageFile: catchAllRoute.filePath,
              notFoundFile,
            });
        }
      }
    }
  }

  if (conflicts.size > 0) {
    throw new Error(
      [...conflicts.values()]
        .sort((left, right) => left.routePath.localeCompare(right.routePath))
        .map(({ routePath, pageFile, notFoundFile }) =>
          `Conflicting fallback routes "${routePath}" detected:\n` +
          `  catch-all page: ${pageFile}\n` +
          `  not-found file: ${notFoundFile}\n` +
          "A not-found route and a catch-all page cannot coexist at the same route level.",
        )
        .join("\n\n"),
    );
  }
}

export function assertNoDuplicateRoutes(
  filePaths: string[],
  fileOptions?: RouteFileOptions,
): void {
  const routes = new Map<string, RouteCollision[]>();

  for (const filePath of filePaths) {
    for (const routePath of normalizedRoutePaths(filePath, fileOptions)) {
      const entries = routes.get(routePath) ?? [];
      entries.push({ kind: collisionKind(routePath), filePath });
      routes.set(routePath, entries);
    }

  }

  const duplicates = [...routes.entries()]
    .filter(([, entries]) => entries.length > 1)
    .sort(([left], [right]) => left.localeCompare(right));

  if (duplicates.length > 0) {
    throw new Error(
      duplicates
        .map(([routePath, entries]) =>
          `${entries[0].kind === "pattern" ? "Ambiguous route pattern" : "Duplicate route"} "${routePath}" detected:\n${entries
            .sort((left, right) => left.filePath.localeCompare(right.filePath))
            .map((entry) => `  ${entry.filePath}`)
            .join("\n")}`,
        )
        .join("\n\n"),
    );
  }
}

export function assertNoRouteConflicts(
  pageFiles: string[],
  notFoundFiles: string[],
  fileOptions?: RouteFileOptions,
): void {
  assertNoDuplicateRoutes(pageFiles, fileOptions);
  assertNoDuplicateRoutes(notFoundFiles, fileOptions);
  assertNoCatchAllFallbackCollisions(pageFiles, notFoundFiles, fileOptions);
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
  assertNoRouteConflicts(
    Object.keys(pages),
    Object.keys(notFounds),
    fileOptions,
  );

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
