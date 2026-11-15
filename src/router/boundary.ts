import React, { Suspense } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { ComponentType } from "react";
import type { RouteErrorComponent } from "../types/index.type";
import { RouteLoadingProvider } from "./loading-context";
import {
  isNotFoundSignal,
  isRenderSignal,
  NotFoundSignal,
} from "./flow";
import {
  RenderContext,
  type RenderContextValue,
} from "./render-outcome";

const NOT_FOUND_MARKER_ID = "__NVR_NOT_FOUND__";

// The server pass 2 paints the fallback before the client bundle runs. Without a
// marker, the client's first render would be the page, which throws: React then
// abandons hydration and reports a recoverable error even though the fallback it
// paints is the same tree. The marker is an inert JSON script beside the fallback;
// the boundary that owns it renders the same fallback on its first render, so
// hydration compares like with like.
//
// Reading is deliberately side-effect free. React may build an instance it never
// keeps (StrictMode, an abandoned concurrent render), and a module-level "already
// read" flag would let that throwaway instance hide the marker from the instance
// React commits. No consumption is needed either: the marker only exists inside
// the server-painted fallback, so the client navigation that replaces that
// fallback also removes the script with it.
function readNotFoundMarker(owner: string): NotFoundSignal | null {
  if (typeof document === "undefined") {
    return null;
  }
  const element = document.getElementById(NOT_FOUND_MARKER_ID);
  if (!element?.textContent) {
    return null;
  }
  try {
    const marker = JSON.parse(element.textContent) as {
      kind?: string;
      owner?: string;
    };
    if (marker.kind !== "not-found" || marker.owner !== owner) {
      return null;
    }
    return new NotFoundSignal(marker.owner);
  } catch {
    return null;
  }
}

// The marker lives in a `<script type="application/json">` element, so the
// serialized JSON must not be able to close that element or start a new one:
// `<`, `>` and `&` are escaped, as are the two line separators JSON allows raw
// but HTML does not.
function serializeNotFoundMarker(owner: string): string {
  return JSON.stringify({ kind: "not-found", owner })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

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

    if (isRenderSignal(this.state.error)) {
      throw this.state.error;
    }

    const Error = this.props.error;
    return React.createElement(Error, {
      error: this.state.error,
      reset: this.reset,
    });
  }

}

type NotFoundBoundaryProps = {
  owner: string;
  fallback: React.ComponentType;
  children: React.ReactNode;
  /** The owner to use when the fallback calls notFound() again. */
  parentOwner?: string;
};

type NotFoundBoundaryState = {
  hasError: boolean;
  error: unknown;
};

const healthyNotFoundState = (): NotFoundBoundaryState => ({
  hasError: false,
  error: undefined,
});

/**
 * Paints only the not-found signal owned by this segment. Other signals and
 * ordinary failures are re-thrown so the next applicable boundary can decide.
 */
export class NotFoundBoundary extends React.Component<
  NotFoundBoundaryProps,
  NotFoundBoundaryState
> {
  static contextType = RenderContext;
  declare context: React.ContextType<typeof RenderContext>;

  private readonly markerSeeded: boolean;

  constructor(props: NotFoundBoundaryProps) {
    super(props);
    const seeded = readNotFoundMarker(props.owner);
    this.markerSeeded = seeded !== null;
    this.state = seeded
      ? { hasError: true, error: seeded }
      : healthyNotFoundState();
  }

  static getDerivedStateFromError(error: unknown): NotFoundBoundaryState {
    return { hasError: true, error };
  }

  private fallbackElement(withMarker: boolean): React.ReactNode {
    const parentOwner = this.props.parentOwner
      ?? (this.context?.owner === this.props.owner ? undefined : this.context?.owner)
      ?? "/";
    const parentContext: RenderContextValue = {
      outcome: this.context?.outcome,
      owner: parentOwner,
      phase: "fallback",
    };
    const Fallback = this.props.fallback;
    const fallback = React.createElement(Fallback);
    const content = withMarker
      ? React.createElement(
          React.Fragment,
          null,
          fallback,
          React.createElement("script", {
            type: "application/json",
            id: NOT_FOUND_MARKER_ID,
            dangerouslySetInnerHTML: {
              __html: serializeNotFoundMarker(this.props.owner),
            },
          }),
        )
      : fallback;
    return React.createElement(
      RenderContext.Provider,
      { value: parentContext },
      content,
    );
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      // Server pass 2/3: the class catch never runs under `react-dom/server`, so
      // the recorded signal is what tells this boundary to paint. The owner match
      // is the same rule the client catch applies, so both passes agree on whose
      // 404 this is. The marker is part of the server paint so the client's first
      // render is the same fallback, not a throw that hydration has to recover.
      const outcome = this.context?.outcome;
      const signal = outcome?.reentrantSignal ?? outcome?.signal;
      if (signal?.kind === "not-found" && signal.owner === this.props.owner) {
        return this.fallbackElement(true);
      }
      return this.props.children;
    }

    if (!isNotFoundSignal(this.state.error)
      || this.state.error.owner !== this.props.owner) {
      throw this.state.error;
    }

    return this.fallbackElement(this.markerSeeded);
  }
}

type RedirectGateState = {
  signal: { to: string; replace: boolean } | null;
};

/**
 * Converts a redirect signal thrown during client rendering into React Router
 * navigation. Non-redirect values continue through the surrounding boundaries.
 *
 * The boundary instance stays mounted across navigations: only its redirect
 * state is cleared when the location changes. Remounting it (a `key`) would
 * remount the whole route tree, and with it every `RouteErrorBoundary` below -
 * clearing a caught `error.tsx` on a query-only navigation, which belongs to the
 * path and must survive it.
 */
export class RedirectGateBoundary extends React.Component<
  { children: React.ReactNode; resetKey: string },
  RedirectGateState
> {
  state: RedirectGateState = { signal: null };

  static getDerivedStateFromError(error: unknown): RedirectGateState {
    if (isRenderSignal(error) && !isNotFoundSignal(error)) {
      return {
        signal: {
          to: error.to,
          replace: error.replace,
        },
      };
    }
    throw error;
  }

  componentDidUpdate(previous: { resetKey: string }): void {
    if (this.state.signal && previous.resetKey !== this.props.resetKey) {
      this.setState({ signal: null });
    }
  }

  render(): React.ReactNode {
    if (this.state.signal) {
      return React.createElement(Navigate, {
        to: this.state.signal.to,
        replace: this.state.signal.replace,
      });
    }
    return this.props.children;
  }
}

export function RedirectGate(props: { children: React.ReactNode }): React.ReactElement {
  const location = useLocation();
  return React.createElement(
    RedirectGateBoundary,
    { resetKey: location.key, children: props.children },
  );
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
