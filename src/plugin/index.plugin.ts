import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { normalizeSegment } from "../utils/path";

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

function collectRoutePaths(
  pagesRoot: string,
  pageFile: string
): string[] {
  const paths = new Set<string>();

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name === pageFile) {
        paths.add(routePathFromDirectory(path.relative(pagesRoot, directory)));
      }
    }
  }

  if (fs.existsSync(pagesRoot)) {
    visit(pagesRoot);
  }

  return [...paths].sort();
}

function dynamicParamName(segment: string): string | undefined {
  const match = segment.match(/^\/(?:\[\.\.\.|:)([^/\]]+)\]?$/);
  return match?.[1];
}

function createRouteTypes(routePaths: string[]): string {
  const routeLiterals = routePaths.map((route) => `  | "${route}"`).join("\n");
  const params = routePaths.map((route) => {
    const names = route
      .split("/")
      .map((segment) => dynamicParamName(`/${segment}`))
      .filter((name): name is string => Boolean(name));
    const fields = names.length > 0
      ? names.map((name) => `    ${name}: string;`).join("\n")
      : "    [key: string]: never;";

    return `  "${route}": {\n${fields}\n  };`;
  }).join("\n");

  return `declare module 'virtual:next-vite-router' {
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
  export { useRoutes } from 'react-router-dom';
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

  const virtualModuleId = "virtual:next-vite-router";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  let pagesRoot = "";
  let declarationPath = "";

  function writeRouteTypes(): void {
    const content = createRouteTypes(collectRoutePaths(pagesRoot, pageFile));
    fs.writeFileSync(declarationPath, content, "utf-8");
  }

  return {
    name: "next-vite-router",
    configResolved(config) {
      pagesRoot = path.resolve(config.root, pagesDir);
      declarationPath = path.join(path.dirname(pagesRoot), "virtual-next-vite-router.d.ts");
      writeRouteTypes();
    },
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },

    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `
import { buildRouteTree, treeToRoutes, normalizeSegment, createLazyElement } from 'next-vite-router';

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
  const tree = buildRouteTree(pages, layouts, notFounds);
  const routes = treeToRoutes(tree, true);
  return routes;
}

export { useRoutes } from 'react-router-dom';
`;
      }
    },

    handleHotUpdate({ file, server }) {
      if (
        file.includes(pagesDir) &&
        (file.endsWith(pageFile) ||
          file.endsWith(layoutFile) ||
          file.endsWith(notFoundFile))
      ) {
        writeRouteTypes();
        const module = server.moduleGraph.getModuleById(
          resolvedVirtualModuleId
        );
        if (module) {
          server.moduleGraph.invalidateModule(module);
          server.ws.send({
            type: "full-reload",
            path: "*",
          });
        }
      }
    },
  };
}
