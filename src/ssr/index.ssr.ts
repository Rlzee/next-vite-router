import {
  normalizeRequestTarget,
} from "../router/not-found";
import type {
  PreparedRequest,
  RenderOutcome,
  RenderSignal,
} from "../router/render-outcome";

export type { PreparedRequest, RenderOutcome, RenderSignal } from "../router/render-outcome";

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
  return new Headers(options.headers);
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

export function planResponse(
  outcome: RenderOutcome,
  options: PlanOptions = {},
): RenderPlan {
  const headers = headersFor(options);
  const noindex = options.noindexOnFallback !== false;
  const noStore = options.noStoreOnRedirect !== false;
  const signal = outcome.reentrantSignal ?? outcome.signal;

  if (options.preFlight === 404 && outcome.signal === null) {
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
