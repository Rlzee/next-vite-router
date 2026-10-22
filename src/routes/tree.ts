import type { ComponentType } from 'react';
import type { RouteModuleLoader, RouteNode, RouteTreeOptions } from '../index';
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

type RouteFileType = 'layout' | 'page' | 'notFound';

/**
 * The slots a route node stores route files in. `lazyLayout` shares the
 * `layout` label and validation, but holds a loader instead of a component.
 */
type RouteFileSlot = RouteFileType | 'lazyLayout';

const ROUTE_FILE_LABELS: Record<RouteFileType, string> = {
  layout: 'layout',
  page: 'page',
  notFound: 'not-found',
};

const DEFAULT_EXPORT_EXAMPLES: Record<RouteFileType, string> = {
  layout: 'export default function Layout({ children }) { ... }',
  page: 'export default function Page() { ... }',
  notFound: 'export default function NotFound() { ... }',
};

/**
 * `$$typeof` tags React uses for its wrapped component types. A React element
 * (`Symbol.for('react.element')`) or portal carries a different tag, so these
 * are checked by symbol instead of accepting any object that has `$$typeof`:
 * an element is *not* a usable component type.
 */
const COMPONENT_TYPE_SYMBOLS = new Set<unknown>([
  Symbol.for('react.memo'),
  Symbol.for('react.forward_ref'),
  Symbol.for('react.lazy'),
]);

/**
 * A route file can only be rendered when its default export is usable as a
 * React component type: a function (plain or class component) or one of the
 * wrapper objects `memo`, `forwardRef`, `lazy`.
 */
function isComponentType(value: unknown): value is ComponentType {
  if (typeof value === 'function') {
    return true;
  }
  return typeof value === 'object'
    && value !== null
    && COMPONENT_TYPE_SYMBOLS.has((value as { $$typeof?: symbol }).$$typeof);
}

/**
 * Wrap an eager layout that arrived as a bare function so a misconfigured lazy
 * glob is named at render instead of failing as a nameless `[object Promise]`.
 *
 * With `lazyLayouts` off, a function layout is ambiguous: an
 * `{ import: "default" }` glob yields the component itself, while a non-eager
 * `import.meta.glob` yields `() => import("...")` loaders. The two are
 * indistinguishable until rendered, so calling the component and rejecting a
 * thenable is the only safe way to tell them apart. Class components cannot be
 * invoked as functions but can also never be an `import()` loader, so they are
 * returned untouched.
 */
function guardEagerLayout(filePath: string, Layout: ComponentType): ComponentType {
  if (typeof Layout !== 'function') {
    return Layout;
  }

  const prototype = (Layout as { prototype?: { render?: unknown } }).prototype;
  if (prototype && typeof prototype.render === 'function') {
    return Layout;
  }

  const Component = Layout as ((props: any) => any) & { displayName?: string };
  function GuardedLayout(props: any): any {
    const rendered = Component(props);
    if (rendered !== null && typeof rendered === 'object'
      && typeof (rendered as { then?: unknown }).then === 'function') {
      throw new Error(
        `Route layout "${filePath}" rendered a Promise instead of a component.\n` +
        `Layouts are read as eager components unless told otherwise: pair a non-eager \`import.meta.glob\` of loaders with \`{ lazyLayouts: true }\`, or import the layout eagerly (\`{ eager: true }\`) to keep it a component.`,
      );
    }
    return rendered;
  }
  (GuardedLayout as { displayName?: string }).displayName =
    Component.displayName || Component.name || undefined;
  return GuardedLayout;
}

function assertComponentType(
  filePath: string,
  fileType: RouteFileType,
  value: unknown,
): asserts value is ComponentType {
  if (isComponentType(value)) {
    return;
  }

  const label = ROUTE_FILE_LABELS[fileType];
  throw new Error(
    `Route ${label} "${filePath}" does not default-export a React component.\n` +
    `Add \`export default\` to the file, for example: \`${DEFAULT_EXPORT_EXAMPLES[fileType]}\`.`,
  );
}

/**
 * Read a component out of a route file value, accepting both a module namespace
 * (`import.meta.glob(pattern, { eager: true })`) and an already unwrapped
 * default export (`import.meta.glob(pattern, { eager: true, import: "default" })`).
 */
function resolveRouteComponent(value: any): ComponentType | undefined {
  if (isComponentType(value)) {
    return value;
  }
  return isComponentType(value?.default) ? value.default : undefined;
}

/**
 * Read the component out of an eagerly imported layout module.
 *
 * The layout used to be stored as `undefined` when the file had no default
 * export, which dropped the layout from the generated routes without any error.
 * Layouts imported lazily go through `checkedLoader` instead, because their
 * module only exists once the chunk resolves.
 */
function readLayoutComponent(filePath: string, module: any): RouteNode['layout'] {
  const layout = resolveRouteComponent(module);
  assertComponentType(filePath, 'layout', layout);
  // Only a bare-function glob entry is ambiguous; a module (`{ eager: true }`)
  // resolves to its `default` and its loaders are unambiguous, so leave those
  // untouched and keep the resolved component identity stable.
  return typeof module === 'function' ? guardEagerLayout(filePath, layout) : layout;
}

/**
 * Keep a page, layout, or not-found loader, but report a missing default export
 * with the source file instead of letting React fail during render with an
 * "Element type is invalid" error that names nothing.
 *
 * These modules are code-split, so their exports only exist once the dynamic
 * import resolves; the check cannot run while the tree is being built.
 */
function checkedLoader(
  filePath: string,
  fileType: RouteFileType,
  loader: unknown,
): RouteModuleLoader {
  if (typeof loader !== 'function') {
    const label = ROUTE_FILE_LABELS[fileType];
    throw new Error(
      `Route ${label} "${filePath}" must be a lazy loader function such as \`async () => import("...")\`.\n` +
      `Keep the ${label} glob lazy (no \`{ eager: true }\`); received ` +
      `${loader === null ? 'null' : typeof loader}.`,
    );
  }

  const source = loader as RouteModuleLoader;
  return async () => {
    const component = resolveRouteComponent(await source());
    assertComponentType(filePath, fileType, component);
    return { default: component };
  };
}

function addFileToTree(
  root: RouteNode,
  filePath: string,
  fileContent: any,
  fileType: RouteFileSlot,
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
  options?: RouteTreeOptions,
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

  // `lazyLayouts` only says how to read a function: a non-eager layout glob
  // yields `() => import("...")` loaders, while a component and a loader are
  // indistinguishable once they are plain values. Module entries stay eager
  // either way, so an `eager: true` glob is still accepted in lazy mode.
  const lazyLayouts = options?.lazyLayouts === true;

  Object.entries(layouts).forEach(([filePath, module]) => {
    const lazy = lazyLayouts && typeof module === 'function';
    addFileToTree(
      root,
      filePath,
      lazy
        ? checkedLoader(filePath, 'layout', module)
        : readLayoutComponent(filePath, module),
      lazy ? 'lazyLayout' : 'layout',
      fileOptions,
    );
  });

  Object.entries(pages).forEach(([filePath, loader]) => {
    addFileToTree(root, filePath, checkedLoader(filePath, 'page', loader), 'page', fileOptions);
  });

  Object.entries(notFounds).forEach(([filePath, loader]) => {
    addFileToTree(root, filePath, checkedLoader(filePath, 'notFound', loader), 'notFound', fileOptions);
  });

  return root;
}
