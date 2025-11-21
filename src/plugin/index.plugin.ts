import type { Plugin } from "vite";

export type NextViteRouterPluginOptions = {
  pagesDir?: string;
  pageFile?: string;
  layoutFile?: string;
  notFoundFile?: string;
};

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

  return {
    name: "next-vite-router",
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
