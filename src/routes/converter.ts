import React from "react";
import {
  useParams as useReactRouterParams,
  type RouteObject,
} from "react-router-dom";
import type { RouteModuleLoader, RouteNode } from '../index';
import {
  createLazyCache,
  createLazyElement,
  compareOrdinal,
  parseRouteSegments,
  normalizedSegment,
  type LazyComponentCache,
} from '../utils/index.utils';
import { CatchAllParamProvider } from '../router/params-context';
import { wrapSegmentBoundaries } from '../router/boundary';
import { hasSegmentBoundaries } from '../router/boundary-registry';

function isOptionalCatchAll(segment: string): boolean {
  const parsed = parseRouteSegments(segment)[0];
  return parsed?.kind === "catchAll" && parsed.optional;
}

function isRequiredCatchAll(segment: string): boolean {
  const parsed = parseRouteSegments(segment)[0];
  return parsed?.kind === "catchAll" && !parsed.optional;
}

/**
 * Lazily rendered `not-found` element for a base guard: the folder's own
 * `not-found` when it has one, else the nearest ancestor's. Without any
 * `not-found` the guard renders nothing, the same blank 404 Next.js paints for
 * an app without a `not-found.tsx`.
 *
 * One rule for both guards - the required catch-all's and a page-less
 * folder's - so a folder answers its base with the same `not-found` its `*`
 * splat shows for everything below it (`docs/not-found.tsx` serving both
 * `/docs` and `/docs/missing`).
 */
function createNotFoundFallbackElement(
  node: RouteNode,
  cache: LazyComponentCache,
  inheritedFallback: RouteModuleLoader | undefined,
  cacheKey: string,
): React.ReactElement | undefined {
  const fallbackLoader = node.notFound ?? inheritedFallback;
  if (!fallbackLoader) {
    return undefined;
  }

  return createLazyElement(
    async () => ({ default: (await fallbackLoader()).default }),
    cacheKey,
    cache,
  );
}

/**
 * Element rendered at the base URL of a *required* catch-all (`[...slug]`).
 *
 * React Router's `*` splat consumes zero or more segments, and no pattern can
 * raise that floor to one: a splat branch always claims its base URL (`/blog`),
 * because the static parent matches it even when the splat child does not.
 * Next.js treats a required catch-all as one-or-more segments, so the base is
 * a 404. This guard lives on an index route at the base and reproduces that:
 * an empty splat renders the nearest ancestor `not-found` (nothing, when the
 * app declares none) instead of the page below.
 *
 * The index route makes the base a real leaf match, which also stops the
 * splat branch's static parent from swallowing the base before a `not-found`
 * splat elsewhere in the tree can be considered.
 */
function CatchAllBaseGuard({ fallback, children }: {
  fallback?: React.ReactNode;
  children?: React.ReactNode;
}): React.ReactNode {
  // Read React Router's own params, not the package `useParams`: the guard
  // renames nothing, and it may render the not-found without any provider.
  const splat = useReactRouterParams()["*"];
  const hasSegments = splat !== undefined && splat.split("/").some(Boolean);

  return hasSegments ? children ?? null : fallback ?? null;
}

/**
 * `*` route rendering the not-found of the folder that owns it. A child that
 * claims the splat region suppresses it (see `processChildren`), because its
 * own splat already covers that region.
 */
function createNotFoundRoute(
  node: RouteNode,
  cache: LazyComponentCache,
  loader: RouteModuleLoader = node.notFound!,
  cacheKey: string = `notfound:${node.fullPath}`,
): RouteObject {
  return {
    path: "*",
    element: createLazyElement(
      async () => {
        const mod = await loader();
        return { default: mod.default };
      },
      cacheKey,
      cache,
    ),
  };
}

function createNotFoundRoutes(
  node: RouteNode,
  cache: LazyComponentCache,
): RouteObject[] {
  return node.notFound ? [createNotFoundRoute(node, cache)] : [];
}

function createIndexRoute(
  node: RouteNode,
  nodePath: string,
  cache: LazyComponentCache,
): RouteObject {
  return createPageRoute(node, nodePath, cache, true);
}

/**
 * Expose a catch-all folder under the name it declares (`[...slug]` -> `slug`)
 * to everything rendered below this element.
 *
 * React Router only ever reports the splat under the unnamed `*` key, so the
 * package's `useParams` and `useCatchAll` read this context to rename it.
 */
function withCatchAllParam(
  rawSegment: string,
  element: React.ReactElement,
): React.ReactElement {
  const routeSegment = parseRouteSegments(rawSegment)[0];
  return routeSegment?.kind === "catchAll"
    ? React.createElement(CatchAllParamProvider, {
        name: routeSegment.name,
        children: element,
      })
    : element;
}

function createPageRoute(
  node: RouteNode,
  nodePath: string,
  cache: LazyComponentCache,
  isIndex: boolean = false
): RouteObject {
  const page = node.page;
  if (!page) {
    throw new Error(`Route node "${node.fullPath}" has no page loader`);
  }

  const element = createLazyElement(
    async () => {
      const mod = await page();
      return { default: mod.default };
    },
    `page:${node.fullPath || nodePath}`,
    cache,
  );

  const routeElement = withCatchAllParam(node.segment, element);

  return isIndex
    ? { index: true, element: routeElement }
    : { path: normalizedSegment(node.segment), element: routeElement };
}

/**
 * Element a layout route renders.
 *
 * An eager layout renders its component directly, inside the entry chunk. A
 * layout coming from a non-eager glob (`lazyLayout`) goes through the shared
 * lazy cache, so one generation memoizes a single `React.lazy` component per
 * layout and suspends behind the configured fallback while Vite loads its
 * chunk. The subtree is rendered by the layout's own `Outlet`, so it waits for
 * the layout chunk instead of being requested alongside it.
 *
 * The catch-all provider wraps the layout element itself, not only the page, so
 * a layout declared inside the catch-all folder can read the parameter.
 */
function createLayoutElement(
  node: RouteNode,
  nodePath: string,
  cache: LazyComponentCache,
): React.ReactElement {
  const element = node.lazyLayout
    ? createLazyElement(
        node.lazyLayout,
        `layout:${node.fullPath || nodePath}`,
        cache,
      )
    : React.createElement(node.layout!);

  return withCatchAllParam(node.segment, element);
}

function hasLayout(node: RouteNode): boolean {
  return Boolean(node.layout || node.lazyLayout);
}

function createLayoutRoute(
  nodeSegment: string,
  element: React.ReactElement,
  children: RouteObject[],
): RouteObject {
  return {
    ...(nodeSegment ? { path: nodeSegment } : {}),
    element,
    children: children.length > 0 ? children : undefined,
  };
}

/**
 * What a converted node contributes at the level of the route array it was
 * emitted into - the enclosing folder's own children.
 *
 * `emitsIndex`: an index route sits there, answering the enclosing folder's
 * base URL. A page folder emits one inside its own path (so not at this
 * level), a pathless group passes its own page up to this level, and a
 * required catch-all page emits its base guard here.
 *
 * `claimsSplats`: a `*` route sits there, owning everything below this level,
 * so the enclosing folder must not add a competing `not-found` splat.
 *
 * A URL-bearing folder's own base guard is nested inside its path, so it
 * contributes neither: only what lands at the parent's level is reported.
 */
type LevelClaims = { emitsIndex: boolean; claimsSplats: boolean };

const NO_CLAIMS: LevelClaims = { emitsIndex: false, claimsSplats: false };

/** Routes plus the claims they make at the level they were emitted into. */
type NodeConversion = { routes: RouteObject[]; claims: LevelClaims };

/**
 * The tree walk of one folder's children: the routes each child contributes
 * plus the claims gathered from the same walk.
 *
 * `childEmitsIndex` - some child already answers this folder's own URL with an
 * index route, so the folder's base guard must not duplicate it.
 *
 * `childClaimsSplats` - some child owns the splat region at this level (a
 * required catch-all), so the folder's own `not-found` must not also emit a
 * `*` there - it becomes that guard's base fallback instead
 * (`blog/not-found.tsx` serving `/blog`).
 *
 * `childCount` - the size of the enumeration the walk already did: asking
 * `node.children.size` separately would read the subtree a second time, which
 * the traversal-cost test in `routes.test.js` pins to one read per node.
 */
function processChildren(
  node: RouteNode,
  currentPath: string,
  cache: LazyComponentCache,
  notFoundFallback: RouteModuleLoader | undefined,
): {
  routes: RouteObject[];
  childEmitsIndex: boolean;
  childClaimsSplats: boolean;
  childCount: number;
} {
  const routes: RouteObject[] = [];
  let childEmitsIndex = false;
  let childClaimsSplats = false;

  // Enumerated once through the counted `children` getter: this is the only
  // pass over the folder's children.
  const childEntries = [...node.children.entries()];

  // Ordinal, not locale-aware: children order the emitted route array, and a
  // collation that varies with the machine would reorder the generated tree.
  childEntries.sort(([left], [right]) => compareOrdinal(left, right));

  for (const [segment, childNode] of childEntries) {
    const childSegment = normalizedSegment(segment);
    const childPath = childSegment
      ? (currentPath ? `${currentPath}/${childSegment}` : `/${childSegment}`)
      : currentPath;

    const { routes: childRoutes, claims } = convertNode(
      childNode,
      false,
      childPath,
      cache,
      notFoundFallback,
    );
    routes.push(...childRoutes);
    childEmitsIndex = childEmitsIndex || claims.emitsIndex;
    childClaimsSplats = childClaimsSplats || claims.claimsSplats;
  }

  return {
    routes,
    childEmitsIndex,
    childClaimsSplats,
    childCount: childEntries.length,
  };
}

/**
 * Index route holding the base guard of a required catch-all.
 *
 * The fallback is the folder's own `not-found` when it has one, else the
 * nearest ancestor's. Without any `not-found` the guard renders nothing, the
 * same blank 404 Next.js paints for an app without a `not-found.tsx`.
 */
function createCatchAllBaseRoute(
  node: RouteNode,
  cache: LazyComponentCache,
  inheritedFallback: RouteModuleLoader | undefined,
): RouteObject {
  return {
    index: true,
    element: React.createElement(CatchAllBaseGuard, {
      fallback: createNotFoundFallbackElement(
        node,
        cache,
        inheritedFallback,
        `notfound:${node.fullPath}:base`,
      ),
    }),
  };
}

/**
 * Index route answering the base URL of a folder that has no `page.tsx`.
 *
 * Next.js gives such a folder no route at its own URL: `/docs` is a 404 even
 * when `docs/intro/page.tsx` exists, and the same holds one level deeper
 * (`/docs/deep` with `docs/deep/leaf/page.tsx`) and under a dynamic segment
 * (`/shop/a` with `shop/[cat]/[item]/page.tsx`). React Router instead keeps the
 * folder's static segment as a valid partial match, which used to paint the
 * layouts below the first page-less level with an empty outlet. A guard index
 * makes the base a real leaf match, so the chain stops there and the nearest
 * `not-found` renders inside the layouts above - nothing, when the app declares
 * none, the same blank 404 Next.js paints without a `not-found.tsx`.
 */
function createEmptyFolderBaseRoute(
  node: RouteNode,
  cache: LazyComponentCache,
  inheritedFallback: RouteModuleLoader | undefined,
): RouteObject {
  return {
    index: true,
    // A real element, not `null`: React Router warns and renders an empty
    // outlet for a leaf without one, which is the very shape this guard
    // replaces. `undefined` renders nothing, the declared no-not-found case.
    element: createNotFoundFallbackElement(
      node,
      cache,
      inheritedFallback,
      `notfound:${node.fullPath}:empty-base`,
    ) ?? React.createElement(BaseNotFound),
  };
}

/** Placeholder leaf for a page-less folder in an app without any `not-found`. */
function BaseNotFound(): React.ReactNode {
  return null;
}

/**
 * Routes a required catch-all page folder contributes to its parent: a guard
 * index that answers the base URL (`/blog`) plus the splat route carrying the
 * page for everything below it.
 *
 * React Router's `*` consumes zero or more segments and its static parents
 * partial-match, so no pattern lifts that floor to one segment: a splat branch
 * always claims `/blog`, which used to paint the layout with an empty outlet
 * (or the page with an empty catch-all). Placing a guard on an index route one
 * level up makes the base a real leaf match, so Next.js's one-or-more contract
 * holds: `/blog` answers with the nearest `not-found`, and only `/blog/...`
 * renders the page.
 */
function createRequiredCatchAllRoutes(
  node: RouteNode,
  nodePath: string,
  cache: LazyComponentCache,
  notFoundFallback: RouteModuleLoader | undefined,
): RouteObject[] {
  return [
    createCatchAllBaseRoute(node, cache, notFoundFallback),
    createPageRoute(node, nodePath, cache),
  ];
}

/**
 * Children of a folder that renders nothing itself: the page index (when the
 * folder has a page), the walked children, the folder's `not-found` splat
 * (suppressed when a child owns the splat region), and the base guard
 * answering a folder that owns no content at its own URL.
 *
 * `hasUrl` tells a folder that owns a URL (any static/dynamic folder, and the
 * root) from a pathless group. A group adds no guard of its own - it has no
 * base to answer - and reports what its children emit instead, so exactly one
 * index answers each URL.
 */
function createNodeChildren(
  node: RouteNode,
  currentPath: string,
  cache: LazyComponentCache,
  notFoundFallback: RouteModuleLoader | undefined,
  hasUrl: boolean,
): {
  routes: RouteObject[];
  childEmitsIndex: boolean;
  childClaimsSplats: boolean;
} {
  const {
    routes,
    childEmitsIndex,
    childClaimsSplats,
    childCount,
  } = processChildren(node, currentPath, cache, notFoundFallback);

  // A folder with a URL, no page, and no child index at its base owns no
  // content there: a guard index makes that base a leaf match rendering the
  // nearest `not-found`, the Next.js 404. With no `not-found` in the app the
  // leaf renders nothing, the same blank 404 the required catch-all guard
  // paints for an app without a `not-found.tsx`.
  const addsBaseGuard = hasUrl && !node.page && !childEmitsIndex && childCount > 0;

  const children: RouteObject[] = [];

  if (node.page) {
    children.push(createIndexRoute(node, currentPath || "/", cache));
  }

  children.push(...routes);

  if (!childClaimsSplats) {
    children.push(...createNotFoundRoutes(node, cache));
  }

  // Appended last: the routes the children contribute keep the positions the
  // emitted tree had before the base guard existed.
  if (addsBaseGuard) {
    children.push(createEmptyFolderBaseRoute(node, cache, notFoundFallback));
  }

  return { routes: children, childEmitsIndex, childClaimsSplats };
}

function createPageRoutes(
  node: RouteNode,
  currentPath: string,
  nodePath: string,
  nodeSegment: string,
  descendants: RouteObject[],
  notFound: RouteObject[],
  cache: LazyComponentCache,
  notFoundFallback: RouteModuleLoader | undefined,
): NodeConversion {
  if (isOptionalCatchAll(node.segment)) {
    const catchAllChildren = [...descendants, ...notFound];
    return {
      // The base index renders the page, so it answers the enclosing folder's
      // URL; the splat below it is optional and claims nothing.
      claims: { emitsIndex: true, claimsSplats: false },
      routes: [
        createIndexRoute(node, currentPath, cache),
        {
          path: nodeSegment,
          element: createPageRoute(node, nodePath, cache).element,
          children: catchAllChildren.length > 0 ? catchAllChildren : undefined,
        },
      ],
    };
  }

  if (isRequiredCatchAll(node.segment)) {
    return {
      // The guard index answers the enclosing folder's base and the splat owns
      // everything below it.
      claims: { emitsIndex: true, claimsSplats: true },
      routes: [
        ...createRequiredCatchAllRoutes(node, nodePath, cache, notFoundFallback),
        // A hand-built tree can still attach files under the catch-all folder;
        // file validation rejects them, but keep them reachable rather than
        // silently dropping them here.
        ...descendants,
        ...notFound,
      ],
    };
  }

  if (descendants.length > 0 || notFound.length > 0) {
    return {
      claims: NO_CLAIMS,
      routes: [{
        path: nodeSegment,
        children: [
          createIndexRoute(node, nodePath, cache),
          ...descendants,
          ...notFound,
        ],
      }],
    };
  }

  return {
    claims: NO_CLAIMS,
    routes: [{
      path: nodeSegment,
      element: createPageRoute(node, nodePath, cache).element,
    }],
  };
}

function createPathlessNodeRoutes(
  node: RouteNode,
  nodePath: string,
  descendants: RouteObject[],
  notFound: RouteObject[],
  cache: LazyComponentCache,
  childEmitsIndex: boolean,
  childClaimsSplats: boolean,
): NodeConversion {
  const children = [
    ...(node.page ? [createIndexRoute(node, nodePath, cache)] : []),
    ...descendants,
    ...notFound,
  ];

  return {
    // A group is transparent: whatever its subtree emits at its own level is
    // what the enclosing folder sees.
    claims: {
      emitsIndex: node.page !== undefined || childEmitsIndex,
      claimsSplats: childClaimsSplats,
    },
    routes: [{
      children: children.length > 0 ? children : undefined,
    }],
  };
}

function createRootRoutes(
  node: RouteNode,
  cache: LazyComponentCache,
): RouteObject[] {
  const notFoundFallback = node.notFound;
  // Folds an unclaimed base into a guard index before the shape below wraps
  // the children, so every root shape answers "/" like Next.js: the not-found
  // inside the root layout when one exists. "/" is a URL, so the root always
  // passes `hasUrl`.
  const { routes: children } = createNodeChildren(
    node,
    "",
    cache,
    notFoundFallback,
    true,
  );

  if (hasLayout(node)) {
    return [{
      path: "/",
      element: createLayoutElement(node, "/", cache),
      children,
    }];
  }

  if (node.page) {
    if (children.length > 1) {
      return [{ path: "/", children }];
    }

    return [{
      path: "/",
      element: createPageRoute(node, "/", cache, false).element,
    }];
  }

  if (node.notFound) {
    return [{ path: "/", children }];
  }

  return children;
}

/**
 * Opt every path-bearing route into (or out of) case-sensitive matching.
 *
 * React Router compiles a route's pattern to a regexp and adds the `i` flag
 * unless the route says `caseSensitive: true`, so a left-to-its-own-devices
 * tree answers `/USERS` from a `users/` folder - the opposite of Next.js.
 * `caseSensitive` is per route, and the conversion builds each route deep
 * inside its branch, so one recursive pass over the finished array stamps
 * them all here. Index and pathless routes are skipped: they own no segment
 * to compare, and React Router reads the flag only for path routes.
 */
function applyCaseSensitivity(
  routes: RouteObject[],
  caseSensitive: boolean,
): void {
  for (const route of routes) {
    if (route.path !== undefined) {
      route.caseSensitive = caseSensitive;
    }
    if (route.children) {
      applyCaseSensitivity(route.children, caseSensitive);
    }
  }
}

/**
 * Public entry: the route array for a tree. `isRoot` nodes are the whole
 * application; every other node is converted as the children of its parent's
 * URL. The conversion is a single top-down walk, and claims travel back up
 * with the routes they belong to.
 *
 * `caseSensitive` defaults to `true`, the Next.js contract: see
 * `applyCaseSensitivity` for why React Router's own default is not usable.
 *
 * `loading.tsx` / `error.tsx` are applied last, and only when the tree declares
 * one: an app without those files gets the route array it had before the
 * conventions existed - no extra path-less route, no changed element.
 */
export function treeToRoutes(
  node: RouteNode,
  isRoot = false,
  currentPath = "",
  cache: LazyComponentCache = createLazyCache(),
  notFoundFallback: RouteModuleLoader | undefined = undefined,
  caseSensitive = true,
): RouteObject[] {
  const routes = convertNode(node, isRoot, currentPath, cache, notFoundFallback).routes;
  applyCaseSensitivity(routes, caseSensitive);
  if (hasSegmentBoundaries(node)) {
    wrapSegmentBoundaries(routes, node);
  }
  return routes;
}

function convertNode(
  node: RouteNode,
  isRoot = false,
  currentPath = "",
  cache: LazyComponentCache = createLazyCache(),
  notFoundFallback: RouteModuleLoader | undefined = undefined,
): NodeConversion {
  if (isRoot) {
    return { routes: createRootRoutes(node, cache), claims: NO_CLAIMS };
  }

  // Folders below this one can use its `not-found` as the base fallback for a
  // required catch-all; a folder's own `not-found` shadows an ancestor's.
  const inheritedNotFound = node.notFound ?? notFoundFallback;

  const nodeSegment = normalizedSegment(node.segment);
  const isPathless = !nodeSegment;
  const nodePath = isPathless
    ? currentPath
    : currentPath + "/" + nodeSegment;

  // `processChildren` walks the whole subtree, so every branch that needs the
  // walk must do it exactly once. Computing the descendants eagerly here and
  // letting `createNodeChildren` walk the subtree again doubled the work per
  // nested layout level, which grows as 2^depth.
  if (hasLayout(node)) {
    if (isRequiredCatchAll(node.segment) && node.page) {
      // A catch-all folder with both a layout and a page: the layout stays on
      // the splat route, and the page - provider included - moves to a `*`
      // child rendered through the layout's Outlet. The guard index is the
      // splat's sibling, so the base URL answers without pretending the
      // catch-all matched, and the not-found still renders inside this
      // folder's layout.
      const pageRoute = createPageRoute(node, nodePath, cache);
      return {
        claims: { emitsIndex: true, claimsSplats: true },
        routes: [
          createCatchAllBaseRoute(node, cache, notFoundFallback),
          {
            path: nodeSegment,
            element: createLayoutElement(node, nodePath, cache),
            children: [{ path: "*", element: pageRoute.element }],
          },
        ],
      };
    }

    // `createNodeChildren` folds an unclaimed base into a guard index.
    const { routes: layoutChildren, childEmitsIndex, childClaimsSplats } =
      createNodeChildren(node, nodePath, cache, inheritedNotFound, !isPathless);

    return {
      // A page-less catch-all folder puts its splat route (and, when it has
      // children, the guard nested inside it) at this level, so the splat
      // region belongs to that branch either way.
      claims: isPathless
        ? { emitsIndex: node.page !== undefined || childEmitsIndex, claimsSplats: childClaimsSplats }
        : isRequiredCatchAll(node.segment)
          ? { emitsIndex: false, claimsSplats: true }
          : NO_CLAIMS,
      routes: [createLayoutRoute(
        isPathless ? "" : nodeSegment,
        createLayoutElement(node, nodePath, cache),
        layoutChildren,
      )],
    };
  }

  const {
    routes: descendants,
    childEmitsIndex,
    childClaimsSplats,
    childCount,
  } = processChildren(node, nodePath, cache, inheritedNotFound);
  const notFound = createNotFoundRoutes(node, cache);

  if (node.page && !isPathless) {
    return createPageRoutes(
      node,
      currentPath,
      nodePath,
      nodeSegment,
      descendants,
      notFound,
      cache,
      notFoundFallback,
    );
  }

  if (node.page || node.notFound || !isPathless) {
    // Same base guard as the layout branch: a folder with a URL, no page, and
    // no child index at its base renders the nearest `not-found` there instead
    // of leaving an empty outlet to the partial match.
    const addsBaseGuard = !isPathless
      && !node.page
      && !childEmitsIndex
      && childCount > 0;
    const ownNotFound = childClaimsSplats ? [] : notFound;

    if (isPathless) {
      return createPathlessNodeRoutes(
        node,
        nodePath,
        descendants,
        ownNotFound,
        cache,
        childEmitsIndex,
        childClaimsSplats,
      );
    }

    return {
      // A page-less required catch-all is emitted as its own `*` route right
      // here, so it owns the folder's splat region even though its base guard
      // (a child of that splat) is not the folder's answer. Any other folder
      // keeps everything it emits inside its own segment: no claim here.
      claims: isRequiredCatchAll(node.segment)
        ? { emitsIndex: false, claimsSplats: true }
        : NO_CLAIMS,
      routes: [{
        path: nodeSegment,
        children: [
          ...(node.page ? [createIndexRoute(node, nodePath, cache)] : []),
          ...descendants,
          ...ownNotFound,
          ...(addsBaseGuard
            ? [createEmptyFolderBaseRoute(node, cache, inheritedNotFound)]
            : []),
        ],
      }],
    };
  }

  // A pathless folder with nothing of its own: its children's routes stand on
  // their own, and so do their claims.
  return {
    claims: { emitsIndex: childEmitsIndex, claimsSplats: childClaimsSplats },
    routes: descendants,
  };
}
