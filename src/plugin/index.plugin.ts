import type { Plugin, ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { normalizeSegment, type RouteFileOptions } from "../utils/path";
import { assertNoDuplicateRoutes } from "../routes/tree";

export type NextViteRouterPluginOptions = {
  pagesDir?: string;
  pageFile?: string;
  layoutFile?: string;
  notFoundFile?: string;
};

function routePathFromDirectory(directory: string): string {
  const segments = directory
    .split(path.sep)
    .filter(Boolean)
    .map(normalizeSegment)
    .filter(Boolean);

  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

type RouteTypeEntry = {
  path: string;
  params: Array<{ name: string; optional: boolean }>;
};

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
        const params = segments
          .map((segment) => {
            const optionalMatch = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
            if (optionalMatch) {
              return { name: optionalMatch[1], optional: true };
            }

            const requiredMatch = segment.match(/^\[\.\.\.(.+)\]$/);
            return requiredMatch
              ? { name: requiredMatch[1], optional: false }
              : undefined;
          })
          .filter((param): param is { name: string; optional: boolean } => Boolean(param));
        const routePath = routePathFromDirectory(relativeDirectory);
        paths.set(routePath, { path: routePath, params });

        const lastSegment = segments[segments.length - 1];
        const optionalCatchAll = lastSegment?.match(/^\[\[\.\.\.(.+)\]\]$/);
        if (optionalCatchAll) {
          const baseDirectory = segments.slice(0, -1).join(path.sep);
          const basePath = routePathFromDirectory(baseDirectory);
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

function dynamicParamName(segment: string): string | undefined {
  const match = segment.match(/^\/(?:\[\.\.\.|:)([^/\]]+)\]?$/);
  return match?.[1];
}

function createRouteTypes(routePaths: RouteTypeEntry[]): string {
  const routeLiterals = routePaths.map(({ path: route }) => `  | "${route}"`).join("\n");
  const params = routePaths.map(({ path: route, params: catchAllParams }) => {
    const names = route
      .split("/")
      .map((segment) => dynamicParamName(`/${segment}`))
      .filter((name): name is string => Boolean(name));
    const fields = names.length > 0 || catchAllParams.length > 0
      ? [
          ...names.map((name) => `    ${name}: string;`),
          ...catchAllParams.map(({ name, optional }) =>
            `    ${name}${optional ? "?" : ""}: string;`),
        ].join("\n")
      : "    [key: string]: never;";

    return `  "${route}": {\n${fields}\n  };`;
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
      assertNoDuplicateRoutes(collectPageFiles(pagesRoot, pageFile), fileOptions);
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
          assertNoDuplicateRoutes(collectPageFiles(pagesRoot, pageFile), fileOptions);
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
        return `
import { buildRouteTree, treeToRoutes, normalizeSegment, createLazyElement, useParams } from 'next-vite-router';
import { Link, useRoutes } from 'react-router-dom';

const pagesGlob = import.meta.glob('/${pagesDir}/**/${pageFile}');
const layoutsGlob = import.meta.glob('/${pagesDir}/**/${layoutFile}', { eager: true });
const notFoundsGlob = import.meta.glob('/${pagesDir}/**/${notFoundFile}');

const transformPath = (path) => path.replace('/${pagesDir}/', '');

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
