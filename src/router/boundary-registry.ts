import type { RouteNode } from "../types/index.type";

/**
 * Roots whose tree declares at least one `loading.tsx` or `error.tsx`.
 *
 * `buildRouteTree` records them here as it reads the records, so `treeToRoutes`
 * can skip the boundary pass entirely for an app that uses neither convention -
 * that pass would otherwise re-scan every folder's children and undo the single
 * traversal the converter is built around. Kept in its own module, apart from the
 * React boundary components, so the tree builder never pulls in `react-router`.
 *
 * A WeakSet keys membership on the root object itself, so it adds nothing to the
 * public `RouteNode` shape and releases with the tree. Each `buildRouteTree` call
 * returns a fresh root, so one test's marking can never leak into another's.
 */
const boundaryTreeRoots = new WeakSet<RouteNode>();

/** Mark a built tree as containing `loading.tsx` / `error.tsx` files. */
export function markSegmentBoundaries(root: RouteNode): void {
  boundaryTreeRoots.add(root);
}

/** Whether `treeToRoutes` has boundaries to apply to this tree. */
export function hasSegmentBoundaries(root: RouteNode): boolean {
  return boundaryTreeRoots.has(root);
}
