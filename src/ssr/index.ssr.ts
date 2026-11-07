import React, { type ReactElement } from "react";
import {
  useRoutes,
  type RouteObject,
} from "react-router-dom";
import { StaticRouter } from "react-router-dom/server";
import {
  normalizeRequestTarget,
} from "../router/request-target";
import type {
  PreparedRequest,
  RenderOutcome,
  RenderSignal,
} from "../router/render-outcome";
import {
  createRenderOutcome,
  RenderContext,
} from "../router/render-outcome";
import {
  isNotFoundSignal,
  isRedirectSignal,
  isRenderSignal,
} from "../router/flow";

export type { PreparedRequest, RenderOutcome, RenderSignal } from "../router/render-outcome";
export type { RouteObject };

export function prepareRequest(url: string): PreparedRequest {
  const queryStart = url.indexOf("?");
  const hashStart = url.indexOf("#");
  const searchStart = queryStart >= 0
    && (hashStart < 0 || queryStart < hashStart)
    ? queryStart
    : -1;
  const fragmentStart = hashStart >= 0 ? hashStart : -1;

  return {
    pathname: normalizeRequestTarget(url),
    search: searchStart >= 0
      ? url.slice(searchStart, fragmentStart >= 0 ? fragmentStart : undefined)
      : "",
    hash: fragmentStart >= 0 ? url.slice(fragmentStart) : "",
  };
}

export type RenderPlan = Readonly<
  | { kind: "page"; status: 200; headers: Headers; pass: 1; sendBody: true; forceOwner: null }
  | { kind: "not-found"; status: 404; headers: Headers; pass: 1; sendBody: true; forceOwner: null; degraded: false }
  | { kind: "not-found"; status: 404; headers: Headers; pass: 2; sendBody: true; forceOwner: string; degraded: false }
  | { kind: "not-found"; status: 200; headers: Headers; pass: 2; sendBody: true; forceOwner: string; degraded: true }
  | { kind: "not-found"; status: 404; headers: Headers; pass: 3; sendBody: true; forceOwner: string; degraded: false }
  | { kind: "redirect"; status: 307 | 308; headers: Headers; pass: 1; sendBody: false; forceOwner: null }
  | { kind: "error"; status: 500 | 200; headers: Headers; pass: 1 | 2 | 3; sendBody: boolean; forceOwner: null; error: unknown; degraded: boolean }
>;

type PlanOptions = {
  preFlight?: 200 | 404;
  headers?: Headers;
  noindexOnFallback?: boolean;
  noStoreOnRedirect?: boolean;
};

function headersFor(options: PlanOptions): Headers {
  const headers = new Headers(options.headers);
  headers.delete("location");
  return headers;
}

function withFallbackHeaders(headers: Headers, noindex: boolean): Headers {
  if (noindex && !headers.has("x-robots-tag")) {
    headers.set("x-robots-tag", "noindex");
  }
  return headers;
}

function signalKind(signal: RenderSignal): "not-found" | "redirect" {
  return signal.kind;
}

function planSignal(
  signal: RenderSignal,
  headers: Headers,
  outcome: RenderOutcome,
  noindex: boolean,
  noStore: boolean,
): RenderPlan {
  if (signalKind(signal) === "redirect") {
    const redirect = signal as Extract<RenderSignal, { kind: "redirect" }>;
    headers.set("location", redirect.to);
    if (noStore && !headers.has("cache-control")) {
      headers.set("cache-control", "no-store");
    }
    return {
      kind: "redirect",
      status: redirect.permanent ? 308 : 307,
      headers,
      pass: 1,
      sendBody: false,
      forceOwner: null,
    };
  }

  const notFound = signal as Extract<RenderSignal, { kind: "not-found" }>;
  if (notFound.reentrant) {
    return {
      kind: "not-found",
      status: 404,
      headers: withFallbackHeaders(headers, noindex),
      pass: 3,
      sendBody: true,
      forceOwner: notFound.owner,
      degraded: false,
    };
  }
  if (outcome.committed) {
    return {
      kind: "not-found",
      status: 200,
      headers: withFallbackHeaders(headers, noindex),
      pass: 2,
      sendBody: true,
      forceOwner: notFound.owner,
      degraded: true,
    };
  }
  return {
    kind: "not-found",
    status: 404,
    headers: withFallbackHeaders(headers, noindex),
    pass: 2,
    sendBody: true,
    forceOwner: notFound.owner,
    degraded: false,
  };
}

function toRenderSignal(error: unknown): RenderSignal {
  if (isNotFoundSignal(error)) {
    return {
      kind: "not-found",
      owner: error.owner,
      reentrant: error.reentrant,
    };
  }
  if (isRedirectSignal(error)) {
    return {
      kind: "redirect",
      to: error.to,
      permanent: error.permanent,
      replace: error.replace,
    };
  }
  throw new Error("Expected a render signal");
}

export function planResponse(
  outcome: RenderOutcome,
  options: PlanOptions = {},
): RenderPlan {
  const headers = headersFor(options);
  const noindex = options.noindexOnFallback !== false;
  const noStore = options.noStoreOnRedirect !== false;
  const signal = outcome.reentrantSignal ?? outcome.signal;

  if (options.preFlight === 404 && signal === null) {
    return {
      kind: "not-found",
      status: 404,
      headers: withFallbackHeaders(headers, noindex),
      pass: 1,
      sendBody: true,
      forceOwner: null,
      degraded: false,
    };
  }

  if (signal !== null) {
    return planSignal(signal, headers, outcome, noindex, noStore);
  }

  if (outcome.failure !== null) {
    return {
      kind: "error",
      status: outcome.committed ? 200 : 500,
      headers,
      pass: outcome.failure.pass,
      sendBody: true,
      forceOwner: null,
      error: outcome.failure.error,
      degraded: outcome.committed,
    };
  }

  return {
    kind: "page",
    status: 200,
    headers,
    pass: 1,
    sendBody: true,
    forceOwner: null,
  };
}

export function renderApp(
  routes: RouteObject[],
  context: { outcome: RenderOutcome; plan: RenderPlan; request?: PreparedRequest },
): ReactElement {
  const forced = context.plan.forceOwner;
  const request = context.request ?? context.outcome.request;
  return React.createElement(
    StaticRouter,
    {
      location: `${request.pathname}${request.search}${request.hash}`,
    },
    React.createElement(
      RenderContext.Provider,
      {
        value: {
          outcome: context.outcome,
          owner: forced ?? undefined,
          phase: forced === null ? "page" : "fallback",
        },
      },
      React.createElement(RouteRenderer, { routes }),
    ),
  );
}

function RouteRenderer({ routes }: { routes: RouteObject[] }): ReactElement | null {
  return useRoutes(routes) as ReactElement | null;
}

export interface RenderCallbacks {
  onShellReady(): void;
  onAllReady(): void;
  onShellError(error: unknown): void;
  onError(error: unknown): void;
}

export interface RenderAttempt {
  pipeTo(sink: RenderSink): void;
  stream: ReadableStream<Uint8Array> | null;
  abort(): void;
  readonly shellReady: Promise<void>;
  readonly allReady: Promise<void>;
}

type InternalRenderAttempt = RenderAttempt & {
  readonly shellCommitted: boolean;
};

export type RenderEngine = (
  element: ReactElement,
  callbacks: RenderCallbacks,
) => RenderAttempt | Promise<RenderAttempt>;

export interface RenderSink {
  write(chunk: string | Uint8Array): unknown;
  end(chunk?: string | Uint8Array): unknown;
}

export interface ResponseAdapter {
  head(status: number, headers: Headers): void;
  send(attempt: RenderAttempt): void | Promise<void>;
  abandon(attempt: RenderAttempt): void;
  fail?(status: 500, error: unknown): void | Promise<void>;
}

export type RenderFailure =
  Readonly<{ request: PreparedRequest; pass: 1 | 2 | 3 }> &
  (
    | Readonly<{ kind: "signal"; signal: RenderSignal }>
    | Readonly<{ kind: "error"; error: unknown }>
    | Readonly<{ kind: "timeout"; afterMs: number }>
  );

function recordRenderError(
  outcome: RenderOutcome,
  error: unknown,
  pass: 1 | 2 | 3,
): void {
  if (isRenderSignal(error)) {
    const phase = pass === 1 ? "page" : "fallback";
    outcome.recordSignal(
      isNotFoundSignal(error)
        ? { kind: "not-found", owner: error.owner, reentrant: phase === "fallback" }
        : {
          kind: "redirect",
          to: error.to,
          permanent: error.permanent,
          replace: error.replace,
        },
      phase,
    );
    return;
  }
  outcome.recordFailure(error, pass);
}

async function createAttempt(
  input: {
    render: RenderEngine;
    element: ReactElement;
    outcome: RenderOutcome;
    pass: 1 | 2 | 3;
    onFailure?: (failure: RenderFailure) => void;
  },
): Promise<InternalRenderAttempt> {
  let resolveShell!: () => void;
  let rejectShell!: (error: unknown) => void;
  const shellReady = new Promise<void>((resolve, reject) => {
    resolveShell = resolve;
    rejectShell = reject;
  });
  const seenErrors = new Set<unknown>();
  let shellReached = false;
  let shellCommitted = false;
  const notifyFailure = (error: unknown): void => {
    if (seenErrors.has(error)) {
      return;
    }
    seenErrors.add(error);
    if (shellReached) {
      input.outcome.markCommitted();
    }
    recordRenderError(input.outcome, error, input.pass);
    input.onFailure?.(
      isRenderSignal(error)
        ? {
          request: input.outcome.request,
          pass: input.pass,
          kind: "signal",
          signal: toRenderSignal(error),
        }
        : {
          request: input.outcome.request,
          pass: input.pass,
          kind: "error",
          error,
        },
    );
  };
  const callbacks: RenderCallbacks = {
    onShellReady() {
      shellReached = true;
      if (input.outcome.signal === null && input.outcome.failure === null) {
        shellCommitted = true;
        input.outcome.markCommitted();
      }
      resolveShell();
    },
    onAllReady() {},
    onShellError(error) {
      notifyFailure(error);
      rejectShell(error);
    },
    onError(error) {
      notifyFailure(error);
    },
  };
  const attempt = await input.render(input.element, callbacks);
  return {
    ...attempt,
    shellReady,
    get shellCommitted() {
      return shellCommitted;
    },
  };
}

export async function renderResponse(input: {
  routes: RouteObject[];
  url: string;
  adapter: ResponseAdapter;
  render: RenderEngine;
  streaming?: boolean;
  shellTimeoutMs?: number;
  onFailure?(failure: RenderFailure): void;
}): Promise<RenderPlan> {
  const request = prepareRequest(input.url);
  const outcome = createRenderOutcome(request);
  let pass: 1 | 2 | 3 = 1;
  let plan: RenderPlan = {
    kind: "page",
    status: 200,
    headers: new Headers(),
    pass: 1,
    sendBody: true,
    forceOwner: null,
  };

  while (true) {
    const attempt = await createAttempt({
      render: input.render,
      element: renderApp(input.routes, { outcome, plan, request }),
      outcome,
      pass,
      onFailure: input.onFailure,
    });
    let shellFailed = false;
    try {
      await waitForShell(attempt.shellReady, input.shellTimeoutMs, () => {
        const timeout = input.shellTimeoutMs ?? 0;
        const error = new Error(`SSR shell timed out after ${timeout}ms`);
        shellFailed = true;
        outcome.recordFailure(error, pass);
        input.onFailure?.({
          request,
          pass,
          kind: "timeout",
          afterMs: timeout,
        });
      });
    } catch {
      shellFailed = true;
    }
    if (shellFailed) {
      abortAttempt(input.adapter, attempt);
      await failBeforeShell(input.adapter, outcome.failure?.error);
      throw new Error("SSR render failed before shell became ready");
    }
    if ((attempt as InternalRenderAttempt).shellCommitted) {
      outcome.markCommitted();
    }
    if (input.streaming === false && outcome.failure === null) {
      try {
        await attempt.allReady;
      } catch (error) {
        outcome.recordFailure(error, pass);
        abortAttempt(input.adapter, attempt);
        await failBeforeShell(input.adapter, error);
        throw error;
      }
    }
    const nextPlan = planResponse(outcome);

    if (pass === 1 && nextPlan.kind === "not-found" && nextPlan.pass === 2) {
      abortAttempt(input.adapter, attempt);
      plan = nextPlan;
      pass = 2;
      continue;
    }
    if (pass === 2 && outcome.reentrantSignal !== null) {
      abortAttempt(input.adapter, attempt);
      plan = planResponse(outcome);
      pass = 3;
      continue;
    }

    input.adapter.head(nextPlan.status, nextPlan.headers);
    outcome.markCommitted();
    if (nextPlan.sendBody) {
      await input.adapter.send(attempt);
    } else {
      abortAttempt(input.adapter, attempt);
    }
    return nextPlan;
  }
}

function abortAttempt(adapter: ResponseAdapter, attempt: RenderAttempt): void {
  attempt.abort();
  adapter.abandon(attempt);
}

async function failBeforeShell(
  adapter: ResponseAdapter,
  error: unknown,
): Promise<void> {
  if (adapter.fail) {
    await adapter.fail(500, error);
  }
}

async function waitForShell(
  shellReady: Promise<void>,
  timeoutMs: number | undefined,
  onTimeout: () => void,
): Promise<void> {
  if (timeoutMs === undefined) {
    await shellReady;
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      shellReady,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          onTimeout();
          resolve();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
