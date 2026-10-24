import type { Logger, Plugin, ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import {
  extractRoutePath,
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
  /**
   * Import `layout.tsx` files with a non-eager glob so Vite emits a separate
   * chunk per layout instead of keeping them in the entry chunk.
   *
   * Defaults to `false`: a layout wraps its whole subtree, so loading it eagerly
   * avoids a fallback flash and a chunk round-trip before the page can even be
   * requested. Turn it on for large, rarely visited shells.
   */
  lazyLayouts?: boolean;
};

function routePathFromSegments(segments: RouteSegment[]): string {
  const normalized = segments
    .map(routeSegmentToPath)
    .filter(Boolean);

  return normalized.length > 0 ? `/${normalized.join("/")}` : "/";
}

type RouteTypeEntry = {
  path: string;
  params: Array<{ name: string; optional: boolean; variadic: boolean }>;
};

function validatePluginOptions(
  options: Required<Omit<NextViteRouterPluginOptions, "lazyLayouts">>,
): void {
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
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/|\/$/g, "");
}

function collectRoutePaths(
  pagesRoot: string,
  fileOptions: RouteFileOptions,
  globPrefix: string,
): RouteTypeEntry[] {
  const pageFile = fileOptions.pageFile ?? "page.tsx";
  const paths = new Map<string, RouteTypeEntry>();

  // Reuse the exact same file -> route derivation as the runtime
  // (extractRoutePath + parseRouteSegments inside buildRouteTree) so the
  // generated types can never diverge from the routes React Router builds.
  for (const globKey of collectPageFiles(pagesRoot, pageFile, globPrefix)) {
    const routePath = extractRoutePath(globKey, fileOptions);
    const segments = parseRouteSegments(routePath, globKey);
    const params = segments
      .filter(
        (segment): segment is Extract<RouteSegment, { kind: "dynamic" | "catchAll" }> =>
          segment.kind === "dynamic" || segment.kind === "catchAll",
      )
      .map((segment) => ({
        name: segment.name,
        optional: segment.kind === "catchAll" && segment.optional,
        // A catch-all spans several segments, so `href` and `Link` also take the
        // array form `useCatchAll()` returns; a `:name` param stays a string.
        variadic: segment.kind === "catchAll",
      }));
    const computedPath = routePathFromSegments(segments);
    paths.set(computedPath, { path: computedPath, params });

    const lastSegment = segments[segments.length - 1];
    if (lastSegment?.kind === "catchAll" && lastSegment.optional) {
      const basePath = routePathFromSegments(segments.slice(0, -1));
      if (!paths.has(basePath)) {
        paths.set(basePath, { path: basePath, params: [] });
      }
    }
  }

  return [...paths.values()].sort((left, right) => left.path.localeCompare(right.path));
}

type CatchAllMetadataMap = Record<
  string,
  { catchAll: { name: string; optional: boolean } }
>;

/**
 * Map each public catch-all pattern (`/blog/*`) back to the folder name it
 * declares (`slug`) and whether it is optional, derived from the SAME traversal
 * that produces the route types so the two can never diverge.
 *
 * The pattern keeps React Router's unnamed `*` splat, so on its own it cannot tell
 * `href`/`Link` which key fills it. This metadata is emitted into the virtual
 * module, where it turns the compile-time guarantee (types list only `slug`) into
 * a runtime one: an unknown key is rejected instead of routed onto the splat.
 */
function collectCatchAllMetadata(routePaths: RouteTypeEntry[]): CatchAllMetadataMap {
  const metadata: CatchAllMetadataMap = {};
  for (const { path, params } of routePaths) {
    const catchAll = params.find((param) => param.variadic);
    if (catchAll) {
      metadata[path] = { catchAll: { name: catchAll.name, optional: catchAll.optional } };
    }
  }
  return metadata;
}

function collectPageFiles(
  pagesRoot: string,
  pageFile: string,
  globPrefix: string,
): string[] {
  const files: string[] = [];

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name === pageFile) {
        const relative = path.relative(pagesRoot, entryPath).replace(/\\/g, "/");
        // Match the exact root-relative keys Vite produces for
        // `import.meta.glob("/<pagesDir>/**/<pageFile>")` so the config-time
        // traversal feeds extractRoutePath the same input the runtime does.
        // Passing an already-relative path would let a folder named like
        // pagesDir (e.g. "app") be stripped again and collapse the route.
        files.push(`/${globPrefix}/${relative}`);
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
          ...params.map(({ name, optional, variadic }) =>
            `    ${name}${optional ? "?" : ""}: ${variadic ? "string | string[]" : "string"};`),
        ].join("\n")
      : "    [key: string]: never;";

    return `  ${JSON.stringify(route)}: {\n${fields}\n  };`;
  }).join("\n");

  return `declare module 'virtual:next-vite-router' {
  import type { ReactElement } from 'react';
  import type { LinkProps as ReactRouterLinkProps, RouteObject } from 'react-router-dom';

  export type RoutePath =
${routeLiterals || '  | "/"'};

  export type RouteParams<P extends RoutePath> = P extends keyof RoutePathParams
    ? RoutePathParams[P]
    : never;

  export interface RoutePathParams {
${params}
  }

  // A pattern needs values as soon as it carries a \`:name\` token or a trailing
  // \`*\` splat, which is how a [id] / [...slug] folder is compiled.
  type HasRouteParams<P extends string> =
    P extends \`\${string}:\${string}\` ? true
    : P extends \`\${string}/*\` ? true
    : false;

  export function href<P extends RoutePath>(
    path: P,
    ...params: HasRouteParams<P> extends true
      ? [params: RouteParams<P>]
      : [params?: RouteParams<P>]
  ): string;

  // One member per route, so \`href\` alone decides whether \`params\` is required:
  // a union of concrete prop shapes avoids any generic inference in JSX.
  export type LinkProps = {
    [P in RoutePath]: Omit<ReactRouterLinkProps, 'to' | 'href'> & (HasRouteParams<P> extends true
      ? { href: P; params: RouteParams<P> }
      : { href: P; params?: RouteParams<P> });
  }[RoutePath];

  export function Link(props: LinkProps): ReactElement | null;

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export function useCatchAll(name?: string): string[];
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
    lazyLayouts = false,
  } = options;
  validatePluginOptions({ pagesDir, pageFile, layoutFile, notFoundFile });
  const normalizedPagesDir = normalizePluginPath(pagesDir);
  // Use the normalized, root-relative form as the runtime base so the glob
  // keys Vite emits (`/${normalizedPagesDir}/...`), the config-time
  // collectPageFiles prefix, and buildRouteTree's extractRoutePath all agree
  // even when the user writes `./src/app`, `src\app`, or `src/app/`.
  const fileOptions: RouteFileOptions = { pagesDir: normalizedPagesDir, pageFile, layoutFile, notFoundFile };

  const virtualModuleId = "virtual:next-vite-router";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  let pagesRoot = "";
  let declarationPath = "";
  let viteLogger: Logger | undefined;
  let watchedServer: ViteDevServer | undefined;
  let removeWatcherListeners: (() => void) | undefined;
  function writeRouteTypes(): void {
    const content = createRouteTypes(collectRoutePaths(pagesRoot, fileOptions, normalizedPagesDir));
    try {
      // The declaration file sits next to the pages directory, which may not
      // exist on a misconfigured project; create it instead of letting the
      // write crash the whole build with an unexplained ENOENT.
      fs.mkdirSync(path.dirname(declarationPath), { recursive: true });
      fs.writeFileSync(declarationPath, content, "utf-8");
    } catch (error) {
      // Route types only power editor completions, so a failed write degrades
      // to a warning instead of failing the build or the dev server.
      const message = `next-vite-router could not write route types to ${declarationPath}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      if (viteLogger) {
        viteLogger.warn(message);
      } else {
        console.warn(message);
      }
    }
  }

  return {
    name: "next-vite-router",
    configResolved(config) {
      pagesRoot = path.resolve(config.root, normalizedPagesDir);
      declarationPath = path.join(path.dirname(pagesRoot), "virtual-next-vite-router.d.ts");
      viteLogger = config.logger;
      assertNoRouteConflicts(
        collectPageFiles(pagesRoot, pageFile, normalizedPagesDir),
        collectPageFiles(pagesRoot, notFoundFile, normalizedPagesDir),
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
            collectPageFiles(pagesRoot, pageFile, normalizedPagesDir),
            collectPageFiles(pagesRoot, notFoundFile, normalizedPagesDir),
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
        // Layouts stay eager unless asked otherwise, so the default output is
        // unchanged. `lazyLayouts` flips the glob AND tells the runtime to read
        // the record's function values as loaders: a loader and a component are
        // both functions, so the shape cannot be inferred from the value.
        const layoutsGlobSource = lazyLayouts
          ? `import.meta.glob(${JSON.stringify(layoutsGlobPath)})`
          : `import.meta.glob(${JSON.stringify(layoutsGlobPath)}, { eager: true })`;
        const routeTreeOptions = lazyLayouts ? ", { lazyLayouts: true }" : "";
        // The public pattern drops the catch-all folder name, so re-derive it from
        // the type traversal and forward it to the generated href/Link; without it
        // the runtime could only address the splat as "*" and could not reject a
        // misspelled key.
        const catchAllMetadata = collectCatchAllMetadata(
          collectRoutePaths(pagesRoot, fileOptions, normalizedPagesDir),
        );
        return `
import { buildRouteTree, treeToRoutes, useParams, useCatchAll, href as hrefBase, createTypedLink } from 'next-vite-router';
import { useRoutes } from 'react-router-dom';

const pagesGlob = import.meta.glob(${JSON.stringify(pagesGlobPath)});
const layoutsGlob = ${layoutsGlobSource};
const notFoundsGlob = import.meta.glob(${JSON.stringify(notFoundGlobPath)});

// Keep the raw root-relative glob keys. extractRoutePath (via buildRouteTree)
// is the single place that strips the pagesDir prefix; stripping it here as
// well would double-remove it and let the prefix regex match a same-named
// nested folder (e.g. pagesDir "app" turning "app/docs/app" into "/").
const pages = pagesGlob;
const layouts = layoutsGlob;
const notFounds = notFoundsGlob;

// Generated catch-all metadata: every "*" pattern mapped to the folder name it
// declares, so the navigation helpers validate a key against the route instead
// of routing any unknown one onto the splat.
const routeMetadata = ${JSON.stringify(catchAllMetadata)};

export function generateRoutes() {
  const tree = buildRouteTree(pages, layouts, notFounds, ${JSON.stringify(fileOptions)}${routeTreeOptions});
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

// Bind the generated catch-all names into the navigation helpers: the pattern
// alone ("/blog/*") cannot say which key fills it, so pass the metadata through.
export function href(pattern, params) {
  return hrefBase(pattern, params, routeMetadata[pattern]);
}

export const Link = createTypedLink(routeMetadata);

export { useRoutes };
export { useParams, useCatchAll };
`;
      }
    },
  };
}
