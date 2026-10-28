import React, { Suspense } from "react";
import { useLocation } from "react-router-dom";
import type { ComponentType } from "react";
import type { RouteObject } from "react-router-dom";
import type { RouteErrorComponent, RouteNode } from "../types/index.type";
import { RouteLoadingProvider } from "./loading-context";
import { normalizedSegment } from "../utils/index.utils";

type BoundaryProps = {
  /** This folder's own `loading.tsx`, when it declared one. */
  loading?: ComponentType;
  /** This folder's own `error.tsx`, when it declared one. */
  error?: RouteErrorComponent;
  children: React.ReactNode;
};

/**
 * Render the failure of a subtree in place of the subtree.
 *
 * Written as a class because that is the only way React exposes a boundary, and
 * deliberately not React Router's `errorElement`: that one works only under a
 * data router (`createBrowserRouter` + `RouterProvider`), while this package
 * hands out plain `RouteObject[]` that apps mount with `useRoutes` as well. A
 * boundary of our own behaves the same under both.
 *
 * `resetKey` is the current pathname: without it, an error caught on one URL
 * would still be on screen after the user navigated to another page of the same
 * folder, because `error.tsx` belongs to the folder and not to the URL. The
 * `reset` handed to the component covers the deliberate retry.
 */
export class RouteErrorBoundary extends React.Component<
  {
    error: RouteErrorComponent;
    resetKey: string;
    children: React.ReactNode;
  },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  componentDidUpdate(previous: { resetKey: string }): void {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }

    const Error = this.props.error;
    return React.createElement(Error, {
      error: this.state.error,
      reset: this.reset,
    });
  }
}

/**
 * The `loading.tsx` / `error.tsx` boundary of one folder, carried as the element
 * of a path-less route between that folder's layout and its content.
 *
 * Next.js stacks the conventions as `layout > error > loading > not-found >
 * page`, and this reproduces that order from the inside out: the page - and the
 * `not-found` that can replace it - sits inside the `Suspense`, which sits
 * inside the boundary, which renders inside the folder's layout. Two
 * consequences follow from that position, and both are the Next.js ones: an
 * error thrown by a folder's own `layout.tsx` is caught by its *parent's*
 * `error.tsx`, never by its own, and `not-found.tsx` renders inside both.
 */
export function SegmentBoundary(props: BoundaryProps): React.ReactElement {
  // Read the pathname at render time, never at conversion time: the route array
  // is built once and reused, so a value captured during the build would be
  // frozen at whatever URL triggered it.
  const { pathname } = useLocation();

  let content: React.ReactNode = props.children;

  if (props.loading) {
    // The provider names the placeholder for every page suspended below - each
    // page still suspends inside its own `Suspense`, deeper than this one, and
    // only a context can reach that fallback (see `RouteLoadingProvider`).
    content = React.createElement(
      RouteLoadingProvider,
      { loading: props.loading, children: content },
      React.createElement(Suspense, {
        fallback: React.createElement(props.loading),
        children: content,
      }),
    );
  }

  // Outside the `Suspense`, so a chunk that fails to load is caught on its way
  // out of the placeholder instead of painting one that never ends.
  if (props.error) {
    content = React.createElement(RouteErrorBoundary, {
      error: props.error,
      resetKey: pathname,
      children: content,
    });
  }

  return React.createElement(React.Fragment, null, content);
}

/**
 * Wrap `children` in `node`'s boundary, or return it untouched when `node`
 * declares neither file. The folder's `loading.tsx` and `error.tsx` both apply at
 * full strength here; the layout-aboves-its-own-boundary ordering is produced by
 * *which* folder a given element is attributed to in the walk, not by a weaker
 * wrapper shape.
 */
function createBoundaryElement(
  node: RouteNode,
  children: React.ReactNode,
): React.ReactNode {
  if (!node.loading && !node.error) {
    return children;
  }

  return React.createElement(SegmentBoundary, {
    loading: node.loading,
    error: node.error,
    children,
  });
}

/**
 * The child node a route in `node`'s own children array came from, if any.
 *
 * `processChildren` sorts a folder's children by code unit and emits their
 * routes in that order, so matching the route's `path` against each child's own
 * segment path identifies the owner. Anything that does not match - the
 * folder's index route, its `*` fallback, its base guard, the guard index a
 * required catch-all contributes beside its splat - belongs to the folder itself.
 */
function matchChildNode(node: RouteNode, path: string): RouteNode | undefined {
  // Matched on the map key, which is what `processChildren` emits as the
  // route's path - a hand-built node may name itself differently, and the
  // emitted tree, not the node, is what this pass has to classify.
  for (const [key, child] of node.children) {
    if (normalizedSegment(key) === path) {
      return child;
    }
  }

  // No direct match: a page declared under a route group is emitted at the
  // enclosing folder's level (the group owns no URL segment), so resolve it
  // through the transparent children that carry no path of their own.
  for (const [key, child] of node.children) {
    if (normalizedSegment(key) === "" && child.children.size > 0) {
      const found = matchChildNode(child, path);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Wrap each folder's outlet content in that folder's boundary, at every depth.
 *
 * The order Next.js stacks - `layout > error > loading > page` - falls out of
 * *which* folder owns which element:
 *
 * - A child route that still has children below it is that child's `layout.tsx`.
 *   It renders in `node`'s outlet, so `node`'s boundary wraps it: a child layout
 *   error is caught by the parent's `error.tsx`, never its own, exactly as
 *   Next.js specifies.
 * - A leaf child route (a page with no sub-tree) is content of its own folder, so
 *   it is wrapped in the child's boundary (inner) then `node`'s (outer).
 * - The folder's own index, `*` fallback and base guard render in its outlet and
 *   carry the folder's boundary.
 *
 * The recursion then descends into each route's children as that child's folder,
 * so a nested layout sits outside its own boundary and inside its parent's.
 *
 * Only folders that declare a file are wrapped, and the pass runs only when the
 * tree declares one somewhere: an app without `loading.tsx` or `error.tsx`
 * keeps the route array it had before these conventions existed, byte for byte.
 */
export function wrapSegmentBoundaries(
  routes: RouteObject[],
  node: RouteNode,
): void {
  for (const route of routes) {
    const owner = route.path === undefined
      ? undefined
      : matchChildNode(node, route.path);

    if (route.element) {
      // Inner-first: the child's own boundary for a leaf, then the enclosing
      // folder's boundary around everything it renders in its outlet.
      let element: React.ReactNode = route.element;
      if (owner && !route.children) {
        element = createBoundaryElement(owner, element);
      }
      route.element = createBoundaryElement(node, element) as React.ReactElement;
    }

    if (route.children) {
      wrapSegmentBoundaries(route.children, owner ?? node);
    }
  }
}
