import type { ComponentType } from 'react';
import type {
  LayoutRecordShape,
  RouteModuleLoader,
  RouteNode,
  RouteTreeOptions,
} from '../index';
import {
  compareOrdinal,
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
  // Canonical base path -> the page file that renders it, used to tell when a
  // required catch-all sits beside another page of the same folder.
  const pageByPath = new Map<string, string>();
  for (const filePath of pageFiles) {
    for (const routePath of normalizedRoutePaths(filePath, fileOptions)) {
      if (!pageByPath.has(routePath)) {
        pageByPath.set(routePath, filePath);
      }
    }
  }

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
    const paths = new Set([fullPath]);

    // A required catch-all no longer claims its base URL (`/blog`): the guard
    // index in the converter answers it with the folder's `not-found` (or the
    // nearest ancestor's), and the folder's own `*` route - which would
    // compete with the catch-all page - is not emitted at all. So the splat
    // region is the only collision. An optional `[[...slug]]` does render its
    // base and keeps claiming it, exactly like a page file there.
    const parentSegments = canonicalSegments.slice(0, -1);
    const parentPath = parentSegments.length > 0
      ? `/${parentSegments.join("/")}`
      : "/";
    if (lastSegment.optional) {
      paths.add(parentPath);
    } else if (parentPath === "/" && pageByPath.has("/")) {
      // Directly under the root the base URL is "/". A root `page.tsx` renders
      // an index there and the guard adds a second one, leaving two claimants
      // of "/" whose winner depends on route ordering. Next.js rejects the
      // same combination; make it an error instead of a coin flip.
      const pageFile = pageByPath.get("/")!;
      throw new Error(
        'Conflicting routes "/" detected:\n' +
        `  page: ${pageFile}\n` +
        `  catch-all page: ${filePath}\n` +
        'A root page and a root-level required catch-all cannot both answer "/". ' +
        "Remove one of the two files, or move the catch-all into a folder.",
      );
    }

    return [{ filePath, paths }];
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
        .sort((left, right) => compareOrdinal(left.routePath, right.routePath))
        .map(({ routePath, pageFile, notFoundFile }) =>
          `Conflicting fallback routes "${routePath}" detected:\n` +
          `  catch-all page: ${pageFile}\n` +
          `  not-found file: ${notFoundFile}\n` +
          "A not-found route and a catch-all page cannot claim the same splat. " +
          'Move the not-found to the folder holding the catch-all (e.g. "blog/not-found.tsx" ' +
          'beside "blog/[...slug]/page.tsx"), where it answers the catch-all\'s base URL.',
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
    .sort(([left], [right]) => compareOrdinal(left, right));

  if (duplicates.length > 0) {
    throw new Error(
      duplicates
        .map(([routePath, entries]) =>
          `${entries[0].kind === "pattern" ? "Ambiguous route pattern" : "Duplicate route"} "${routePath}" detected:\n${entries
            .sort((left, right) => compareOrdinal(left.filePath, right.filePath))
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
 * Read the component out of an eagerly imported layout record entry.
 *
 * The layout used to be stored as `undefined` when the file had no default
 * export, which dropped the layout from the generated routes without any error.
 * Layouts imported lazily go through `checkedLoader` instead, because their
 * module only exists once the chunk resolves.
 *
 * Nothing here asks a bare function what it is: `layoutShape` declares the
 * record, and `buildRouteTree` rejects a value the declaration cannot cover
 * before it gets here.
 */
function readLayoutComponent(filePath: string, module: any): RouteNode['layout'] {
  const layout = resolveRouteComponent(module);
  assertComponentType(filePath, 'layout', layout);
  // Returned exactly as resolved - a module yields its `default`, a bare function
  // yields itself - so the component keeps the identity React compares against.
  return layout;
}

/**
 * The error for the one value two opposite glob shapes produce identically.
 *
 * An eager `{ import: "default" }` glob and a non-eager glob both hand over a
 * bare function. Reading it by calling it was removed - that meant running user
 * code to classify it - so the record's shape has to be declared, and this says
 * so at build time instead of leaving React to fail on `[object Promise]` later.
 *
 * Nothing is sniffed here either: not the value's `prototype`, not its source
 * text. A shape rule that reads the code's form would still be a guess, just a
 * quieter one, and a class layout declared as `"module"` is refused for the same
 * reason a function one is - the record said namespaces.
 */
function ambiguousLayoutError(filePath: string): Error {
  return new Error(
    `Route layout "${filePath}" is a bare function, which an eager and a non-eager glob produce alike, so the router will not assume which one it is.\n` +
    'Declare the shape of the layouts record:\n' +
    '  { layoutShape: "loader" }    entries are `() => import("...")` from a non-eager `import.meta.glob`\n' +
    '  { layoutShape: "component" } entries are unwrapped components or classes from `{ eager: true, import: "default" }`\n' +
    'Or keep the default `"module"` shape by leaving the glob eager without unwrapping: `import.meta.glob(layouts, { eager: true })`.',
  );
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

  // The record's shape is declared, never inferred: a component and a loader are
  // both functions, and nothing here calls one to find out which it is. Each
  // shape therefore accepts exactly what its glob produces and rejects what it
  // cannot tell apart.
  const shape: LayoutRecordShape =
    options?.layoutShape ?? (options?.lazyLayouts === true ? 'loader' : 'module');

  Object.entries(layouts).forEach(([filePath, module]) => {
    const isFunction = typeof module === 'function';

    if (shape === 'loader') {
      // A function is the loader the record just declared. Module entries stay
      // eager components, which is what keeps a mixed record readable.
      addFileToTree(
        root,
        filePath,
        isFunction
          ? checkedLoader(filePath, 'layout', module)
          : readLayoutComponent(filePath, module),
        isFunction ? 'lazyLayout' : 'layout',
        fileOptions,
      );
      return;
    }

    // `"module"` and `"component"` both read eager values, and a module namespace
    // means the same thing to either. Only a bare function is ambiguous, and it is
    // ambiguous solely under the default shape - `"component"` is the caller
    // declaring that it unwrapped the glob, which the router has to believe. A
    // class is refused exactly like a function component: accepting it because a
    // class cannot be a loader would be telling the value's shape from its code,
    // which is the kind of guessing this API stopped doing.
    if (shape === 'module' && isFunction) {
      throw ambiguousLayoutError(filePath);
    }

    addFileToTree(
      root,
      filePath,
      readLayoutComponent(filePath, module),
      'layout',
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
