import type { ComponentType } from 'react';
import type {
  LayoutRecordShape,
  RouteErrorComponent,
  RouteFileRecords,
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

type RouteFileType = 'layout' | 'page' | 'notFound' | 'loading' | 'error';

/**
 * The slots a route node stores route files in. `lazyLayout` shares the
 * `layout` label and validation, but holds a loader instead of a component.
 */
type RouteFileSlot = RouteFileType | 'lazyLayout';

const ROUTE_FILE_LABELS: Record<RouteFileType, string> = {
  layout: 'layout',
  page: 'page',
  notFound: 'not-found',
  loading: 'loading',
  error: 'error',
};

const DEFAULT_EXPORT_EXAMPLES: Record<RouteFileType, string> = {
  layout: 'export default function Layout({ children }) { ... }',
  page: 'export default function Page() { ... }',
  notFound: 'export default function NotFound() { ... }',
  loading: 'export default function Loading() { ... }',
  error: 'export default function Error({ error, reset }) { ... }',
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
 * Read the component out of an eagerly imported `loading.tsx` / `error.tsx`
 * entry.
 *
 * Both conventions are read eagerly by the plugin, and only eagerly makes sense:
 * a placeholder that arrives by chunk would wait for a chunk to announce that a
 * chunk is loading, and an error boundary that has not loaded yet cannot report
 * the failure it exists for. Both files are a handful of lines by nature, so the
 * cost of keeping them in the entry chunk is negligible.
 *
 * A bare function is refused rather than read as an unwrapped component: unlike
 * a layout, these globs have no declared shape to point at, so accepting one
 * would be guessing that the caller unwrapped the glob.
 */
function readEagerRouteComponent(
  filePath: string,
  fileType: 'loading' | 'error',
  module: any,
): ComponentType | RouteErrorComponent {
  if (typeof module === 'function') {
    const label = ROUTE_FILE_LABELS[fileType];
    throw new Error(
      `Route ${label} "${filePath}" must come from an eager glob: \`import.meta.glob(pattern, { eager: true })` +
      '` yields the module, whose `default` is the component.\n' +
      `Received a bare function, which this package will not read as either a component or a loader.`,
    );
  }

  const component = resolveRouteComponent(module);
  assertComponentType(filePath, fileType, component);
  return component;
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

/**
 * Whether a layouts record entry claims the root - the folder the pages
 * directory itself is, not any segment below it.
 *
 * `extractRoutePath` is the same derivation `addFileToTree` uses, so a record
 * keyed `src/app/layout.tsx` and one keyed `/src/app/layout.tsx` answer alike.
 * A caller that hands over bare keys without file options (`layout.tsx`) does
 * not name the pages directory, so the path keeps its file name and the entry
 * lands on a `/layout` route - where it has always landed.
 */
function isRootLayoutPath(filePath: string, fileOptions: RouteFileOptions | undefined): boolean {
  const routePath = extractRoutePath(filePath, fileOptions);
  return routePath === "" || routePath === "/";
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

export function buildRouteTree(records: RouteFileRecords, options?: RouteTreeOptions): RouteNode;
export function buildRouteTree(
  pages: Record<string, () => Promise<any>>,
  layouts?: Record<string, any>,
  notFounds?: Record<string, () => Promise<any>>,
  fileOptions?: RouteFileOptions,
  options?: RouteTreeOptions,
): RouteNode;
/**
 * Build the route tree a set of glob records describes.
 *
 * Two calling styles, on purpose. The records-object style names every kind
 * (`pages`, `layouts`, `notFounds`, `loadings`, `errors`), carries the file-name
 * options inside the bag as `fileOptions`, and takes the tree options as its
 * second argument; it is the one to use for the two conventions added here,
 * because a fifth and sixth positional slot between the loaders and the file
 * options would have been impossible to read at the call site. The positional
 * style keeps the three-record shape it has always had, so
 * `buildRouteTree(pages, layouts, notFounds, fileOptions, options)` written for
 * an older release still compiles and still behaves - it simply carries no
 * loading or error files, because there is no place to put them.
 *
 * The styles are told apart by the required `pages` key: a records bag always
 * names it, while a positional pages record is keyed by file path (`page.tsx`
 * files, never a bare `pages`), so the two can only collide on an impossible
 * glob key. Checking that the value is an object too seals it: a positional
 * `pages` route is a loader or an eager module, and `pages` is not a route name.
 *
 * One record shape is refused rather than read: a **loader** entry that claims
 * the root, because the root layout cannot suspend - see the layouts walk below.
 */
export function buildRouteTree(
  first: RouteFileRecords | Record<string, () => Promise<any>>,
  second?: Record<string, any> | RouteTreeOptions,
  third?: Record<string, () => Promise<any>>,
  fourth?: RouteFileOptions,
  fifth?: RouteTreeOptions,
): RouteNode {
  const asRecords = isRouteFileRecords(first);
  const records: RouteFileRecords = asRecords
    ? first
    : { pages: first, layouts: second as Record<string, any> | undefined, notFounds: third };
  // Records style reads its options from inside the bag and its tree options from
  // the second argument; the positional style keeps the fourth and fifth slots.
  const fileOptions = asRecords ? first.fileOptions : fourth;
  const options = (asRecords ? second : fifth) as RouteTreeOptions | undefined;

  // The positional style's fourth slot is the file options: a tree-options
  // object passed there (`layoutShape`, `caseSensitive`) would otherwise be read
  // as a set of unknown file names and the declared shape would silently not
  // apply. The records style has no such slot, so this only guards positional.
  if (!asRecords && fourth !== undefined && !isRouteFileOptions(fourth as Record<string, any>)) {
    throw new Error(
      'buildRouteTree: the fourth positional argument is the file options (`pagesDir`, `pageFile`, '
      + '`layoutFile`, `notFoundFile`, `loadingFile`, `errorFile`), and the fifth is the tree options. '
      + 'Pass the tree options as the fifth argument, or use the records-object form: '
      + '`buildRouteTree({ pages, layouts, notFounds, loadings, errors, fileOptions }, options)`.',
    );
  }

  assertNoRouteConflicts(
    Object.keys(records.pages),
    Object.keys(records.notFounds ?? {}),
    fileOptions,
  );
  // Same rule as the other kinds: two files of one kind claiming one route is a
  // coin flip over which renders, so it is reported instead of decided later.
  assertNoDuplicateRoutes(Object.keys(records.loadings ?? {}), fileOptions);
  assertNoDuplicateRoutes(Object.keys(records.errors ?? {}), fileOptions);

  const root: RouteNode = {
    segment: "",
    fullPath: "",
    children: new Map(),
  };

  // The record's shape is declared, never inferred: a component and a loader are
  // both functions, and nothing here calls one to find out which it is. Each
  // shape therefore accepts exactly what its glob produces and rejects what it
  // cannot tell apart.
  const shape: LayoutRecordShape = options?.layoutShape ?? 'module';

  Object.entries(records.layouts ?? {}).forEach(([filePath, module]) => {
    const isFunction = typeof module === 'function';
    // The root layout never suspends, whatever shape the record declares: a lazy
    // route has no ancestor boundary that could paint a placeholder for it, so
    // the shell would leave the whole application on an empty screen while its
    // chunk arrives - there is not even a `loading.tsx` that could cover it,
    // because the root boundary renders inside the layout it would have to
    // replace. Next.js loads the root layout eagerly for the same reason.
    const isRoot = isRootLayoutPath(filePath, fileOptions);

    if (shape === 'loader' && isFunction && isRoot) {
      // The root entry is a loader, which nothing can turn into a component
      // while the tree is being built - the chunk is not here yet. Refusing it
      // names the one record shape that cannot describe this folder, instead of
      // emitting a shell that suspends outside every boundary.
      throw new Error(
        `Route layout "${filePath}" claims the root, and the root layout cannot come from a non-eager glob: ` +
        `a lazy route suspends outside every boundary, so nothing could paint a placeholder while the shell loads.\n` +
        'Read the root layout eagerly - the plugin emits a second glob for it, ' +
        '`import.meta.glob("<pagesDir>/layout.tsx", { eager: true })` - and keep ' +
        'the non-eager glob for the layouts below it.',
      );
    }

    if (shape === 'loader') {
      // A function is the loader the record just declared. Module entries stay
      // eager components, which is what keeps a mixed record readable - and a
      // root module entry is exactly how the plugin delivers the eager shell.
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

  Object.entries(records.pages).forEach(([filePath, loader]) => {
    addFileToTree(root, filePath, checkedLoader(filePath, 'page', loader), 'page', fileOptions);
  });

  Object.entries(records.notFounds ?? {}).forEach(([filePath, loader]) => {
    addFileToTree(root, filePath, checkedLoader(filePath, 'notFound', loader), 'notFound', fileOptions);
  });

  Object.entries(records.loadings ?? {}).forEach(([filePath, module]) => {
    addFileToTree(
      root,
      filePath,
      readEagerRouteComponent(filePath, 'loading', module),
      'loading',
      fileOptions,
    );
  });

  Object.entries(records.errors ?? {}).forEach(([filePath, module]) => {
    addFileToTree(
      root,
      filePath,
      readEagerRouteComponent(filePath, 'error', module),
      'error',
      fileOptions,
    );
  });

  return root;
}

/**
 * Whether the first argument is a records bag rather than the pages record of
 * the positional style.
 *
 * A records bag always carries the required `pages` key mapped to a record; a
 * positional pages record is keyed by file path, so `pages` is at best a route
 * folder and never a top-level key whose value is an object. Requiring the value
 * to be an object also reads a positional call that mistypes a page as an eager
 * module (`{ "about/page.tsx": { default: ... } }`) as positional, which is what
 * lets `checkedLoader` name the offending file instead of this helper guessing.
 */
function isRouteFileRecords(value: unknown): value is RouteFileRecords {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const pages = (value as { pages?: unknown }).pages;
  return typeof pages === 'object' && pages !== null;
}

/** The file options of the positional style, used to reject a misplaced argument. */
function isRouteFileOptions(value: Record<string, any>): boolean {
  const known: Array<string> = [
    'pagesDir',
    'pageFile',
    'layoutFile',
    'notFoundFile',
    'loadingFile',
    'errorFile',
  ];
  // An empty object is a valid (if useless) file-options bag, and the walk
  // resolves every missing key to its default, so nothing can go wrong there.
  return Object.keys(value).every((key) => known.includes(key))
    && Object.values(value).every((entry) => entry === undefined || typeof entry === 'string');
}
