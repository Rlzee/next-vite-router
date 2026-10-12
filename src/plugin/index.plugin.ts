import type { Plugin, ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import {
  parseRouteSegments,
  routeSegmentToPath,
  type RouteFileOptions,
  type RouteSegment,
} from "../utils/path";
import { assertNoRouteConflicts } from "../routes/tree";

export type NextViteRouterPluginOptions = {
  pagesDir?: string;
  pageFile?: string;
  layoutFile?: string;
  notFoundFile?: string;
};

function routePathFromSegments(segments: RouteSegment[]): string {
  const normalized = segments
    .map(routeSegmentToPath)
    .filter(Boolean);

  return normalized.length > 0 ? `/${normalized.join("/")}` : "/";
}

type RouteTypeEntry = {
  path: string;
  params: Array<{ name: string; optional: boolean }>;
};

function validatePluginOptions(options: Required<NextViteRouterPluginOptions>): void {
  const entries = [
    ["pagesDir", options.pagesDir],
    ["pageFile", options.pageFile],
    ["layoutFile", options.layoutFile],
    ["notFoundFile", options.notFoundFile],
  ] as const;

  for (const [name, value] of entries) {
    if (!value.trim()) {
      throw new Error(`nextViteRouter option "${name}" must not be empty.`);
    }
  }

  const fileNames = entries.slice(1);
  const duplicate = fileNames.find(([, value], index) =>
    fileNames.slice(index + 1).some(([, otherValue]) => otherValue === value),
  );
  if (duplicate) {
    throw new Error(
      `nextViteRouter file options must be distinct; "${duplicate[0]}" is duplicated.`,
    );
  }
}

function normalizePluginPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/|\/$/g, "");
}

function collectRoutePaths(
  pagesRoot: string,
  pageFile: string
): RouteTypeEntry[] {
  const paths = new Map<string, RouteTypeEntry>();

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name === pageFile) {
        const relativeDirectory = path.relative(pagesRoot, directory);
        const segments = relativeDirectory
          .split(path.sep)
          .filter(Boolean);
        const routeSegments = parseRouteSegments(segments.join("/"));
        const params = routeSegments
          .filter(
            (segment): segment is Extract<RouteSegment, { kind: "dynamic" | "catchAll" }> =>
              segment.kind === "dynamic" || segment.kind === "catchAll",
          )
          .map((segment) => ({
            name: segment.name,
            optional: segment.kind === "catchAll" && segment.optional,
          }));
        const routePath = routePathFromSegments(routeSegments);
        paths.set(routePath, { path: routePath, params });

        const lastSegment = routeSegments[routeSegments.length - 1];
        if (lastSegment?.kind === "catchAll" && lastSegment.optional) {
          const baseDirectory = segments.slice(0, -1).join(path.sep);
          const basePath = routePathFromSegments(
            parseRouteSegments(baseDirectory.split(path.sep).join("/")),
          );
          if (!paths.has(basePath)) {
            paths.set(basePath, { path: basePath, params: [] });
          }
        }
      }
    }
  }

  if (fs.existsSync(pagesRoot)) {
    visit(pagesRoot);
  }

  return [...paths.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function collectPageFiles(pagesRoot: string, pageFile: string): string[] {
  const files: string[] = [];

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name === pageFile) {
        files.push(path.relative(pagesRoot, entryPath));
      }
    }
  }

  if (fs.existsSync(pagesRoot)) {
    visit(pagesRoot);
  }

  return files;
}

function createRouteTypes(routePaths: RouteTypeEntry[]): string {
  const routeLiterals = routePaths
    .map(({ path: route }) => `  | ${JSON.stringify(route)}`)
    .join("\n");
  const params = routePaths.map(({ path: route, params }) => {
    const fields = params.length > 0
      ? [
          ...params.map(({ name, optional }) =>
            `    ${name}${optional ? "?" : ""}: string;`),
        ].join("\n")
      : "    [key: string]: never;";

    return `  ${JSON.stringify(route)}: {\n${fields}\n  };`;
  }).join("\n");

  return `declare module 'virtual:next-vite-router' {
  import type { ReactElement } from 'react';
  import type { RouteObject } from 'react-router-dom';

  export type RoutePath =
${routeLiterals || '  | "/"'};

  export type RouteParams<P extends RoutePath> = P extends keyof RoutePathParams
    ? RoutePathParams[P]
    : never;

  export interface RoutePathParams {
${params}
  }

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export { Link, useRoutes } from 'react-router-dom';
}
`;
}

export function nextViteRouter(
  options: NextViteRouterPluginOptions = {}
): Plugin {
  const {
    pagesDir = "src/app",
    pageFile = "page.tsx",
    layoutFile = "layout.tsx",
    notFoundFile = "not-found.tsx",
  } = options;
  validatePluginOptions({ pagesDir, pageFile, layoutFile, notFoundFile });
  const normalizedPagesDir = normalizePluginPath(pagesDir);
  const fileOptions: RouteFileOptions = { pagesDir, pageFile, layoutFile, notFoundFile };

  const virtualModuleId = "virtual:next-vite-router";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  let pagesRoot = "";
  let declarationPath = "";
  let watchedServer: ViteDevServer | undefined;
  let removeWatcherListeners: (() => void) | undefined;
  function writeRouteTypes(): void {
    const content = createRouteTypes(collectRoutePaths(pagesRoot, pageFile));
    fs.writeFileSync(declarationPath, content, "utf-8");
  }

  return {
    name: "next-vite-router",
    configResolved(config) {
      pagesRoot = path.resolve(config.root, pagesDir);
      declarationPath = path.join(path.dirname(pagesRoot), "virtual-next-vite-router.d.ts");
      assertNoRouteConflicts(
        collectPageFiles(pagesRoot, pageFile),
        collectPageFiles(pagesRoot, notFoundFile),
        fileOptions,
      );
      writeRouteTypes();
    },
    configureServer(server) {
      if (watchedServer === server) {
        return;
      }

      removeWatcherListeners?.();
      watchedServer = server;

      const updateRouteMetadata = (file: string) => {
        const relativeFile = path.relative(pagesRoot, file);
        if (
          relativeFile.startsWith("..") ||
          ![pageFile, layoutFile, notFoundFile].includes(path.basename(file))
        ) {
          return;
        }

        try {
          assertNoRouteConflicts(
            collectPageFiles(pagesRoot, pageFile),
            collectPageFiles(pagesRoot, notFoundFile),
            fileOptions,
          );
        } catch (error) {
          server.config.logger.error(
            error instanceof Error ? error.message : String(error),
          );
          return;
        }

        writeRouteTypes();
        const module = server.moduleGraph.getModuleById(resolvedVirtualModuleId);
        if (module) {
          // Vite cannot safely update a cached route tree when a glob entry is
          // created or removed, so use a full reload only for structural changes.
          server.moduleGraph.invalidateModule(module);
          if (reloadTimer) {
            clearTimeout(reloadTimer);
          }
          reloadTimer = setTimeout(() => {
            reloadTimer = undefined;
            server.ws.send({ type: "full-reload", path: "*" });
          }, 0);
        }
      };

      let reloadTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (reloadTimer) {
          clearTimeout(reloadTimer);
          reloadTimer = undefined;
        }
        server.watcher.off("add", updateRouteMetadata);
        server.watcher.off("unlink", updateRouteMetadata);
        server.watcher.off("close", cleanup);
        if (watchedServer === server) {
          watchedServer = undefined;
          removeWatcherListeners = undefined;
        }
      };

      // Vite updates import.meta.glob modules for file creation and deletion.
      // Only the generated declarations need to be refreshed here.
      server.watcher.on("add", updateRouteMetadata);
      server.watcher.on("unlink", updateRouteMetadata);
      server.watcher.once("close", cleanup);
      removeWatcherListeners = cleanup;
    },
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },

    load(id) {
      if (id === resolvedVirtualModuleId) {
        const pagesGlobPath = `/${normalizedPagesDir}/**/${pageFile}`;
        const layoutsGlobPath = `/${normalizedPagesDir}/**/${layoutFile}`;
        const notFoundGlobPath = `/${normalizedPagesDir}/**/${notFoundFile}`;
        const transformPrefix = `/${normalizedPagesDir}/`;
        return `
import { buildRouteTree, treeToRoutes, normalizeSegment, createLazyElement, useParams } from 'next-vite-router';
import { Link, useRoutes } from 'react-router-dom';

const pagesGlob = import.meta.glob(${JSON.stringify(pagesGlobPath)});
const layoutsGlob = import.meta.glob(${JSON.stringify(layoutsGlobPath)}, { eager: true });
const notFoundsGlob = import.meta.glob(${JSON.stringify(notFoundGlobPath)});

const transformPath = (path) => path.replace(${JSON.stringify(transformPrefix)}, '');

const pages = Object.fromEntries(
  Object.entries(pagesGlob).map(([key, value]) => [transformPath(key), value])
);
const layouts = Object.fromEntries(
  Object.entries(layoutsGlob).map(([key, value]) => [transformPath(key), value])
);
const notFounds = Object.fromEntries(
  Object.entries(notFoundsGlob).map(([key, value]) => [transformPath(key), value])
);

export function generateRoutes() {
  const tree = buildRouteTree(pages, layouts, notFounds, ${JSON.stringify(fileOptions)});
  const routes = treeToRoutes(tree, true);
  return routes;
}

export function Router() {
  routes ??= generateRoutes();
  return useRoutes(routes);
}

let routes;

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    routes = undefined;
  });
}

export { Link, useRoutes };
export { useParams };
`;
      }
    },
  };
}
