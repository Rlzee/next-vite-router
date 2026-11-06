import React, { Suspense } from "react";
import { useLocation } from "react-router-dom";
import type { ComponentType } from "react";
import type { RouteErrorComponent } from "../types/index.type";
import { RouteLoadingProvider } from "./loading-context";

type BoundaryProps = {
  /** This folder's own `loading.tsx`, when it declared one. */
  loading?: ComponentType;
  /** This folder's own `error.tsx`, when it declared one. */
  error?: RouteErrorComponent;
  children: React.ReactNode;
};

/**
 * What the boundary tracks for itself: whether a value was captured, and that
 * value. The two are separate fields because a thrown value can be *any*
 * JavaScript value - `throw null` is legal - and a boundary that read the error
 * itself as "no failure" would render the failing subtree again instead of the
 * folder's `error.tsx`, sending the value to the next boundary up. Nothing here
 * is ever compared to decide the branch.
 */
type BoundaryState = {
  hasError: boolean;
  error: unknown;
};

/**
 * The healthy state. A function rather than one shared object, so the reference
 * handed to `setState` is always a fresh one React is free to merge.
 */
const healthyState = (): BoundaryState => ({ hasError: false, error: undefined });

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
 *
 * The key is deliberately the path rather than the whole URL. A navigation that
 * changes only the query is the same page under the same `error.tsx`, so its
 * screen stays - even when the value just switched to would have rendered fine.
 * Dismissing that is `reset()`'s job and not navigation's: only a reader who
 * asks for a retry says what to do with a failure whose cause may be gone, while
 * the path changing always means the content the boundary guards is another one.
 */
export class RouteErrorBoundary extends React.Component<
  {
    error: RouteErrorComponent;
    resetKey: string;
    children: React.ReactNode;
  },
  BoundaryState
> {
  state: BoundaryState = healthyState();

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { hasError: true, error };
  }

  componentDidUpdate(previous: { resetKey: string }): void {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState(healthyState());
    }
  }

  private reset = (): void => {
    this.setState(healthyState());
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
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
 *
 * `children` is normally React Router's `<Outlet/>`, so the boundary wraps every
 * route the folder emits at its own URL - the page index, the `not-found`, the
 * base guard, and every deeper folder's route, at any depth. A leaf that has no
 * descendants may instead receive the page element directly; both shapes give
 * the same rendering contract.
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
