import type { Logger, Plugin, ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  compareOrdinal,
  extractRoutePath,
  parseRouteSegments,
  routeSegmentToPath,
  type RouteFileOptions,
  type RouteSegment,
} from "../utils/path";
import { assertNoRouteConflicts } from "../routes/tree";
import {
  LEGACY_ROUTE_DECLARATION_FILE_NAMES,
  ROUTE_DECLARATION_FILE_NAME,
  ROUTE_DECLARATION_MARKER,
} from "../utils/route-declaration";

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
  /**
   * Stamp `caseSensitive` onto every path-bearing route the generated module
   * builds, so URL matching follows the case of the folder names on disk - the
   * Next.js contract. React Router's own default is the opposite (its pattern
   * regexp gets the `i` flag unless a route opts in), which is why the flag has
   * to travel with the generated `treeToRoutes` call.
   *
   * Defaults to `true`. Set it to `false` for an app whose existing links come
   * in mixed case and must keep resolving.
   */
  caseSensitive?: boolean;
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

/**
 * Validate the string options only.
 *
 * The `Required<...>` wrapper is what forces every path/file-name option to
 * reach the call already resolved to a non-empty string; the boolean switches
 * (`lazyLayouts`, `caseSensitive`) are therefore omitted from the shape - they
 * have nothing to trim, and a new boolean option has to join this Omit rather
 * than the entries below.
 */
function validatePluginOptions(
  options: Required<Omit<NextViteRouterPluginOptions, "lazyLayouts" | "caseSensitive">>,
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

/**
 * Bare specifier the application can resolve for the React Router symbols this
 * plugin emits and the shipped engine imports: `useRoutes`, `Link`, `useParams`,
 * and the `LinkProps` / `RouteObject` types of the generated declaration.
 *
 * React Router v7 folded `react-router-dom` into `react-router` and left the old
 * name as a re-export shim whose own README tells a migrated app to remove it, so
 * an application can legitimately have no `react-router-dom` to resolve. The shim
 * is used whenever it is installed - an existing project keeps exactly the specifiers
 * it has today - and the core package is substituted only when the shim is absent.
 */
type RouterSpecifier = "react-router-dom" | "react-router";

const ROUTER_DOM: RouterSpecifier = "react-router-dom";
const ROUTER: RouterSpecifier = "react-router";

// `react-router` v6 does not export `Link` or `LinkProps` - those live in
// `react-router-dom` - so swapping the shim for the v6 core would point the
// runtime at imports that do not exist. v7 moved every export into the core
// package, which is the only case the substitution is sound.
const ROUTER_MIN_MAJOR_FOR_SWAP = 7;

// Rewritten by the `config` hook when the application has `react-router` but no
// `react-router-dom`. Vite applies `resolve.alias` to every import it resolves,
// including the ones inside this package's own `dist` files and the ones the
// application writes itself, so one entry redirects the whole build.
const routerDomToRouterAlias = {
  find: /^react-router-dom$/,
  replacement: ROUTER,
};

type InstalledPackage = { version: string; major: number };

/**
 * Read the version of `name` as an application rooted at `root` would resolve it.
 * Returns `undefined` when the package is not installed there.
 */
function readInstalledPackage(root: string, name: string): InstalledPackage | undefined {
  // Resolve as the application does, from its own root: peers belong to the
  // application, and a hoisted, linked, or store-based install has to be seen the
  // way Node and Vite see it - not the way this package's `node_modules` does.
  const requireFromRoot = createRequire(path.join(root, "resolver-anchor.js"));
  let entry: string;
  try {
    entry = requireFromRoot.resolve(name);
  } catch {
    return undefined;
  }

  // Walk up from the resolved file instead of assuming the manifest sits next to
  // it: a nested `dist`, a dual-package `dist/package.json`, or a symlink into a
  // content-addressed store all land elsewhere. Only a manifest that names this
  // package answers, which is what keeps a workspace root manifest from lying.
  let directory = path.dirname(entry);
  for (;;) {
    const manifestPath = path.join(directory, "package.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
          name?: string;
          version?: string;
        };
        if (manifest.name === name && manifest.version) {
          const major = Number.parseInt(manifest.version, 10);
          if (!Number.isNaN(major)) {
            return { version: manifest.version, major };
          }
        }
      } catch {
        // An unreadable manifest is simply not an answer; keep walking up.
      }
    }

    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function resolveRouterSpecifier(root: string, logger?: Logger): RouterSpecifier {
  if (readInstalledPackage(root, ROUTER_DOM)) {
    return ROUTER_DOM;
  }

  const core = readInstalledPackage(root, ROUTER);
  if (!core) {
    // Nothing to substitute and nothing to complain about yet: leave the specifier
    // as it has always been so a project that has not installed its dependencies
    // still fails with Vite's own "failed to resolve" message rather than a
    // plugin-specific error thrown before it can build anything.
    return ROUTER_DOM;
  }

  if (core.major < ROUTER_MIN_MAJOR_FOR_SWAP) {
    // The swap would be wrong here, so the build keeps importing the shim and
    // fails on it. Say what to install instead of leaving an unresolved specifier.
    logger?.warn(
      `next-vite-router: "${ROUTER}" ${core.version} is installed but "${ROUTER_DOM}" is not, ` +
      `and "${ROUTER}" v6 does not export the components this package takes from the shim. ` +
      `Install "${ROUTER_DOM}@6", or move to "${ROUTER}" 7 or newer, which exports them itself: ` +
      `the build keeps importing "${ROUTER_DOM}" and cannot resolve it until then.`,
    );
    return ROUTER_DOM;
  }

  return ROUTER;
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

  // Ordinal sort: this order is the order of the `RoutePath` union and of the
  // `RoutePathParams` members in the written declaration, so it must not depend
  // on the locale/ICU of the machine running the build.
  return [...paths.values()].sort((left, right) => compareOrdinal(left.path, right.path));
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

function createRouteTypes(routePaths: RouteTypeEntry[], routerSpecifier: RouterSpecifier): string {
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

  return `declare module 'next-vite-router/routes' {
  import type { ReactElement } from 'react';
  import type { LinkProps as ReactRouterLinkProps, RouteObject } from '${routerSpecifier}';

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
  export { useRoutes } from '${routerSpecifier}';
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
    caseSensitive = true,
  } = options;
  validatePluginOptions({ pagesDir, pageFile, layoutFile, notFoundFile });
  const normalizedPagesDir = normalizePluginPath(pagesDir);
  // Use the normalized, root-relative form as the runtime base so the glob
  // keys Vite emits (`/${normalizedPagesDir}/...`), the config-time
  // collectPageFiles prefix, and buildRouteTree's extractRoutePath all agree
  // even when the user writes `./src/app`, `src\app`, or `src/app/`.
  const fileOptions: RouteFileOptions = { pagesDir: normalizedPagesDir, pageFile, layoutFile, notFoundFile };

  // The generated module has a single public specifier, `next-vite-router/routes`;
  // the leading `\0` marks it as a virtual module so neither Vite nor Node ever
  // tries to resolve it against the filesystem. The older `virtual:next-vite-router`
  // name is retired entirely — no longer resolved or declared — so there is exactly
  // one way to import the route helpers.
  const routesModuleId = "next-vite-router/routes";
  const resolvedRoutesModuleId = "\0" + routesModuleId;
  let pagesRoot = "";
  let declarationPath = "";
  // Set by the `config` hook from what the application actually installed; the
  // default is the specifier this package has always written.
  let routerSpecifier: RouterSpecifier = ROUTER_DOM;
  // The root that lookup ran against, kept so `configResolved` can repeat it with
  // a logger - the `config` hook contributes its alias before Vite creates one.
  let routerResolveRoot: string | undefined;
  let viteLogger: Logger | undefined;
  let watchedServer: ViteDevServer | undefined;
  let removeWatcherListeners: (() => void) | undefined;

  /**
   * Route types power editor completion and typed `href` only, so every problem
   * here degrades to a warning instead of failing the build or the dev server.
   */
  function reportRouteTypesIssue(message: string): void {
    if (viteLogger) {
      viteLogger.warn(message);
    } else {
      console.warn(message);
    }
  }

  /** Contents of a declaration file: `undefined` when absent, `""` when unreadable. */
  function readDeclaration(file: string): string | undefined {
    try {
      return fs.readFileSync(file, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      // Locked or unreadable: treat it as a file this plugin did not write, which
      // is the only assumption that can neither overwrite nor delete it.
      return "";
    }
  }

  /** Drop declarations this package wrote under names it no longer uses. */
  function removeLegacyDeclarations(): void {
    const directory = path.dirname(declarationPath);
    for (const name of LEGACY_ROUTE_DECLARATION_FILE_NAMES) {
      const legacyPath = path.join(directory, name);
      const content = readDeclaration(legacyPath);
      // Only a copy this package authored; a project's own file keeps its place.
      if (content === undefined || !content.includes(ROUTE_DECLARATION_MARKER)) continue;
      try {
        fs.rmSync(legacyPath);
      } catch (error) {
        reportRouteTypesIssue(
          `next-vite-router could not remove the outdated route declaration ${legacyPath}: ` +
          `${error instanceof Error ? error.message : String(error)}. Delete it, or TypeScript ` +
          `merges it with ${ROUTE_DECLARATION_FILE_NAME} and reports duplicate identifiers.`,
        );
      }
    }
  }

  function writeRouteTypes(): void {
    // `routes.d.ts` is a name an application may well own - hand-written route
    // tables use it - so the plugin writes only files it recognises as its own.
    // Refusing costs typed completion, which is reported; overwriting would
    // silently destroy code the project authored.
    const existing = readDeclaration(declarationPath);
    if (existing !== undefined && !existing.includes(ROUTE_DECLARATION_MARKER)) {
      reportRouteTypesIssue(
        `next-vite-router did not write route types: ${declarationPath} is not a file this plugin ` +
        "generated. Rename or move that file, and the declaration will be written on the next build; " +
        "until then `next-vite-router/routes` has no declaration and TypeScript cannot resolve it.",
      );
      return;
    }

    const content = createRouteTypes(
      collectRoutePaths(pagesRoot, fileOptions, normalizedPagesDir),
      routerSpecifier,
    );
    try {
      // The declaration file sits next to the pages directory, which may not
      // exist on a misconfigured project; create it instead of letting the
      // write crash the whole build with an unexplained ENOENT.
      fs.mkdirSync(path.dirname(declarationPath), { recursive: true });
      fs.writeFileSync(declarationPath, content, "utf-8");
    } catch (error) {
      reportRouteTypesIssue(
        `next-vite-router could not write route types to ${declarationPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    // Only once the current declaration exists: if the write failed, the older
    // copy is still the best completion available.
    removeLegacyDeclarations();
  }

  return {
    name: "next-vite-router",
    // `pre` so resolveId runs before Vite's node/commonjs resolver: the
    // `next-vite-router/routes` alias has no entry in the package "exports" map,
    // and the default resolver would reject it before the alias is honored.
    enforce: "pre",
    config(userConfig) {
      // The same root Vite resolves (`config.root`, else the working directory);
      // Vite merges the config file and the CLI overrides before running this
      // hook, so the router packages are looked up where the build will run.
      const root = userConfig.root ? path.resolve(userConfig.root) : process.cwd();
      routerResolveRoot = root;
      routerSpecifier = resolveRouterSpecifier(root);
      if (routerSpecifier === ROUTER) {
        // The application resolved through `react-router`, so every
        // `react-router-dom` import - this package's `dist`, the generated module,
        // and the application's own files - has to land on the same module
        // instance, not on a specifier it never installed.
        return {
          resolve: { alias: [routerDomToRouterAlias] },
        };
      }
    },
    configResolved(config) {
      // Same root, now with a logger: the one case that is neither aliased nor
      // buildable (a v6 `react-router` with no shim installed) is reported here.
      if (routerResolveRoot) {
        routerSpecifier = resolveRouterSpecifier(routerResolveRoot, config.logger);
      }
      pagesRoot = path.resolve(config.root, normalizedPagesDir);
      declarationPath = path.join(path.dirname(pagesRoot), ROUTE_DECLARATION_FILE_NAME);
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
        const module = server.moduleGraph.getModuleById(resolvedRoutesModuleId);
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
      if (id === routesModuleId) {
        return resolvedRoutesModuleId;
      }
    },

    load(id) {
      if (id === resolvedRoutesModuleId) {
        const pagesGlobPath = `/${normalizedPagesDir}/**/${pageFile}`;
        const layoutsGlobPath = `/${normalizedPagesDir}/**/${layoutFile}`;
        const notFoundGlobPath = `/${normalizedPagesDir}/**/${notFoundFile}`;
        // Layouts stay eager unless asked otherwise, so the default output is
        // unchanged. `lazyLayouts` flips the glob AND declares the record shape it
        // just produced: a component and a loader are both functions, so the shape
        // travels with the record instead of being guessed by calling a value.
        const layoutsGlobSource = lazyLayouts
          ? `import.meta.glob(${JSON.stringify(layoutsGlobPath)})`
          : `import.meta.glob(${JSON.stringify(layoutsGlobPath)}, { eager: true })`;
        const routeTreeOptions = lazyLayouts ? ', { layoutShape: "loader" }' : "";
        // The public pattern drops the catch-all folder name, so re-derive it from
        // the type traversal and forward it to the generated href/Link; without it
        // the runtime could only address the splat as "*" and could not reject a
        // misspelled key.
        const catchAllMetadata = collectCatchAllMetadata(
          collectRoutePaths(pagesRoot, fileOptions, normalizedPagesDir),
        );
        // The navigation engine ships as `dist/plugin-runtime.js`, a build entry
        // that is NOT in the package "exports" map, so application code cannot
        // import it. This generated module reaches it by resolved file path
        // instead of a bare specifier: `import.meta.url` is this plugin's own
        // module URL (bundled next to plugin-runtime in dist), and the emitted
        // path never resolves back to a `next-vite-router/...` specifier.
        const engineEntry = fileURLToPath(new URL("./plugin-runtime.js", import.meta.url));
        return `
import { buildRouteTree, treeToRoutes, useParams, useCatchAll, href as hrefBase, createTypedLink } from ${JSON.stringify(engineEntry)};
import { useRoutes } from '${routerSpecifier}';

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
  // One flag per path-bearing route, from the plugin option: React Router
  // matches case-insensitively unless a route opts in, so the generated module
  // has to carry the Next.js default (true) into the conversion.
  const routes = treeToRoutes(tree, true, "", undefined, undefined, ${JSON.stringify(caseSensitive)});
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
