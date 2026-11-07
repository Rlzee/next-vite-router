# Flow-control signals, render outcomes and the SSR response contract

Status: **design, pending technical validation — no implementation approved.**
Decisions taken (this is the contract those decisions fix):

| decision | outcome |
| --- | --- |
| D1 — converter | A. The converter emits the 404 owner marker. `getRouteStatus()` is not modified. |
| D2 — second SSR render | Yes, for `notFound()` discovered before the shell is committed. Guarantees and non-guarantees in §7.4. |
| D3 — SSR API surface | New subpath export `next-vite-router/ssr`, platform-neutral: no `node:*` and no `react-router-dom` import. |
| D4 — redirect statuses | `redirect()` → `307`, `permanentRedirect()` → `308`. `replace` is a client navigation option only and never touches HTTP. |

Sequencing decision kept from review: **signals → SSR protocol → boundaries → converter → `notFound()`
end to end → redirects → error/500 split → compatibility → documented limits.** The SSR contract is
designed before the boundaries because the boundary shape is a consequence of "the record is the truth,
the throw is only how React stops".

Out of scope, stated so nobody reads it in: `global-error.tsx`, middleware, data loaders or a cache
layer, `revalidate`/tag invalidation, `after()`, and the package owning an HTTP server.

---

## 1. Vocabulary

- **Segment** — a folder in the pages directory that owns a URL prefix, and therefore owns the
  `not-found.tsx` that answers it (possibly inherited).
- **Owner** — the segment whose `not-found` fallback answers a `notFound()` call. Resolved during
  conversion, never at call time.
- **Render signal** — a branded `Error` subclass carrying control flow: `NotFoundSignal`,
  `RedirectSignal`. Signals are *recorded* and *thrown*; nothing downstream infers a status from a
  caught exception.
- **Render outcome** — the per-request object a signal is recorded into. One per request; never
  module-scoped; never shared; never reused.
- **Render plan** — the pure result of `planResponse(outcome)`: status, headers, which pass to render,
  whether the body is sent at all.
- **Commit** — the single act of writing status and headers. Before it, everything is provisional.
  After it, the status is frozen and the plan is marked `degraded` when it disagrees.
- **Pre-flight** — the answer the route table alone gives, i.e. `getRouteStatus(routes, pathname)`.

## 2. Layers

```
React Router                matching, params, layout hierarchy, navigation, history
        │  element tree
Flow conventions            notFound() · redirect() · permanentRedirect()  →  signals
        │  record + throw
Render outcome (per request)  page · not-found · redirect · error
        │
   ┌────┴─────────────────────────────┐
   Client                          Server / prerender
   NotFoundBoundary, RedirectGate  planResponse + commit + RenderOutput
   (exception-driven paint)         (value-driven decision, exception only stops the render)
        │                                 │
        └────── the same fallback ────────┘   (one resolution, one nesting, two mechanisms)
```

The two right-hand columns must never own different answers to "whose 404 is this". That is the whole
reason the owner is computed by the converter (§6) and carried by one component (§5).

## 3. Signals

New module `src/router/flow.ts`; reached by applications only through the generated
`next-vite-router/routes` module, exactly like `href`/`Link`/`useParams`.

```ts
/** Branded: matched by the brand, never by `instanceof Error` and never by message. */
declare const signalBrand: unique symbol;

export class NotFoundSignal extends Error {
  readonly [signalBrand] = "not-found" as const;
  /** The segment that owned the decision when it was recorded. */
  readonly owner: string;
}

export class RedirectSignal extends Error {
  readonly [signalBrand] = "redirect" as const;
  readonly to: string;
  readonly permanent: boolean;
  /** Client navigation option; has no HTTP meaning. */
  readonly replace: boolean;
}

/** Stops the current render. Records into the request's outcome first, always. */
export function notFound(): never;

export type RedirectOptions = { replace?: boolean };

/** 307 on the server, `Navigate replace` on the client. */
export function redirect(to: string | URL, options?: RedirectOptions): never;

/** 308 on the server, `Navigate replace` on the client. */
export function permanentRedirect(to: string | URL, options?: RedirectOptions): never;

/** Public predicates: a user's own root boundary must be able to decline to swallow control flow. */
export function isNotFoundSignal(value: unknown): value is NotFoundSignal;
export function isRedirectSignal(value: unknown): value is RedirectSignal;
export function isRenderSignal(value: unknown): value is NotFoundSignal | RedirectSignal;
```

Rules:

- `notFound()` outside a route render — no outcome in context — throws a plain diagnostic `Error`
  instead of pretending to work. A control-flow signal that escaped a render (event handler,
  `setTimeout`, bare `async` callback) is a page bug; the package says so rather than 404ing the site.
- `to` is forwarded to `Location` verbatim after `String()`; a relative value is left relative
  (the browser resolves it), and no `href()`-style encoding is applied — `redirect()` is an HTTP
  answer, not a typed navigation.
- Nothing may `catch` a signal and keep rendering. `RouteErrorBoundary` is changed (§6.3) so a signal
  climbs past every `error.tsx` to its owner.

## 4. Render outcome

New module `src/router/render-outcome.ts`.

```ts
/** What `prepareRequest` settled: one reading, used by the plan and by the router alike. */
export type PreparedRequest = Readonly<{
  pathname: string;   // normalizeRequestTarget(req.url)
  search: string;     // "" when the target carried none
  hash: string;
}>;

export type RenderSignal =
  | Readonly<{ kind: "not-found"; owner: string; reentrant: boolean }>
  | Readonly<{ kind: "redirect"; to: string; permanent: boolean; replace: boolean }>;

export interface RenderOutcome {
  readonly request: PreparedRequest;
  /** The initial signal from the page pass. It is immutable once recorded. */
  readonly signal: RenderSignal | null;
  /** At most one signal recorded while rendering a fallback; schedules only the bounded pass 3. */
  readonly reentrantSignal: RenderSignal | null;
  /** The first uncaught ordinary failure, together with the pass that observed it. */
  readonly failure: Readonly<{ error: unknown; pass: 1 | 2 | 3 }> | null;
  /** Set by `commit()` only. A signal arriving after it cannot change the status: the plan degrades. */
  readonly committed: boolean;
  /** True once `committed` is set and a signal was recorded afterwards. */
  readonly degraded: boolean;
  recordSignal(signal: RenderSignal, phase: "page" | "fallback"): void;
  recordFailure(error: unknown, pass: 1 | 2 | 3): void;
  markCommitted(): void;
}

export function createRenderOutcome(request: PreparedRequest): RenderOutcome;

/** Provided by the SSR helper around the app element; absent in the browser. */
export function useRenderOutcome(): RenderOutcome | undefined;
/** Provided by the owner marker; the answer to "whose 404 would catch me". */
export function useNotFoundOwner(): string | undefined;
/** "fallback" makes a nested notFound() reentrant and routes it to the parent owner. */
export function useRenderPhase(): "page" | "fallback" | undefined;
```

**Architectural invariant (from review, kept as a hard rule):** the outcome reaches a component only
through React context, created per request. A module-level outcome is forbidden — it is the exact
shape that leaks between concurrent SSR requests, and it would make the concurrency test in §8/I14
pass by accident instead of by construction. `useRenderOutcome()` returning `undefined` in the browser
is what makes the client mechanism exception-driven. `signal` and `reentrantSignal` are separate
slots: first record wins within each slot, while the fallback phase is allowed to create the second
slot. `planResponse` consumes the initial slot only; the fallback phase decides whether the second slot
is a bounded parent escalation or an ordinary failure.

## 5. Propagation

One component, two mechanisms, one position in the tree.

```
layout element
└── SegmentBoundary(error)                 ← existing; must re-throw signals (§6.3)
    └── Suspense(loading)                  ← existing; createLazyElement's own boundary
        └── NotFoundBoundary(owner, fallback)   ← NEW, one per owner
            └── CatchAllParamProvider      ← existing; names the splat for page and fallback alike
                └── page element
```

```ts
export function NotFoundBoundary(props: {
  /** The segment this boundary answers, as the converter computed it. */
  owner: string;
  /** The resolved fallback: this folder's `not-found`, else the nearest ancestor's, else built-in. */
  fallback: RouteErrorComponent | ComponentType;
  children: React.ReactNode;
}): React.ReactElement;
```

### 5.1 Client

`getDerivedStateFromError` cannot decline to catch: having one makes this boundary the nearest handler,
so declining is done by **re-throwing at render time** - the mechanism React documents for passing an
error to a parent boundary, and the one that behaves identically on React 18 and 19.

- `render()`: `state.owned ? <fallback/> : children`.
- The recorded value is classified in `render()`:
  - a `NotFoundSignal` whose `owner` is this boundary's `owner` → paint the fallback;
  - any other signal → re-throw, so it climbs to the owner (or to the root, R4) - this boundary paints
    nothing;
  - an **ordinary failure** → re-throw as well, and the enclosing `RouteErrorBoundary` paints this
    folder's `error.tsx` exactly as it does today. The only difference is one extra hop in React's
    unwind; the handler that owns the failure is unchanged.
- When this boundary paints its fallback, it re-arms the catch in **fallback phase** and supplies the
  parent owner (or `"/"`) through context. A `notFound()` from the child `not-found.tsx` is therefore
  caught once by the parent owner and paints that parent's fallback. If the current fallback is already
  the root fallback, the call becomes a plain diagnostic error. The same one-step escalation is used
  on the server and on the client; it is not a third render pass (§5.3, I5).
- The URL does not change and no navigation is pushed: `notFound()` answers the URL the reader is on.

### 5.2 Server / prerender

- The class catch is not a reliable SSR fallback mechanism: React does not render a class
  `ErrorBoundary` fallback during server rendering. `render()` consults the outcome instead: when
  `outcome.signal?.kind === "not-found" && outcome.signal.owner === this.owner`, it renders the
  fallback. This is why the component's *position* is the same on both sides — the second pass cannot
  disagree with what a client boundary would have caught.
- `redirect()` records and throws; on the server the plan discards the body, so the redirect needs no
  owner and no per-segment boundary. The client renders `RedirectGate` once, at the top of `Router`:

```ts
export function RedirectGate(props: { children: React.ReactNode }): React.ReactElement;
// state: { kind: "redirect", to, replace } → React Router's <Navigate to replace={replace} />
```

`RedirectGate` imports `Navigate` from `react-router-dom` and therefore lives on the
app-facing/generated-module side, not in `next-vite-router/ssr` (§9 constraint C2).

### 5.3 Resolution and loop rules

| # | rule | why |
| --- | --- | --- |
| R1 | A signal is owned by the nearest `NotFoundBoundary` whose `owner` equals the context owner at the throw site. | Same answer as `createNotFoundFallbackElement` gives during conversion. |
| R2 | `notFound()` called from a **layout** is owned by the nearest *ancestor* owner, never by the segment that layout belongs to. | A boundary cannot replace the tree that is throwing: that is an infinite loop. |
| R3 | While a fallback is rendering, the outcome context changes to `phase: "fallback"` and carries the parent owner (or `"/"`). A `notFound()` from that fallback records one **reentrant** signal for that parent owner; if the fallback is already the root fallback, it records an ordinary `RenderFailure` instead. | This is explicit escalation, bounded at one step, and cannot re-enter the same fallback. |
| R4 | No owner anywhere → the eager built-in `DefaultNotFound` at owner `"/"`. | Identical to the pre-flight base-guard answer; the two paths cannot disagree. |
| R5 | Server: at most **two** passes for an initial page signal. If pass 2 records the one permitted reentrant signal from R3, the protocol aborts pass 2 and performs exactly one final pass 3 with the parent owner. No signal in pass 3 schedules another pass. | The exceptional third pass is explicit and bounded; it is not hidden inside `first record wins`. |
| R6 | Client: a signal that no boundary owns climbs to the root and paints R4's fallback; it must never reach `error.tsx`. | §3's "not a generic error" requirement, made structural by §6.3. |

## 6. Converter delta (D1) — targeted, and the only `src/routes/` change

### 6.1 Where the owner and the fallback are decided

`buildRouteTree` already threads the inherited fallback down the walk, and `convertNode` already knows
`node.notFound`, `node.fullPath`, `node.segment`, and the built-in. The new helper mirrors
`boundaryOutletElement` in shape:

```ts
/** This folder's 404 owner marker element when a `notFound()` below it has somewhere to land. */
function notFoundOwnerElement(node: RouteNode, inherited: RouteModuleLoader | undefined): ReactElement | undefined;
```

It wraps **the page element only** (never the layout element: R2), in `createPageRoute`, `createIndexRoute`
and the base-guard/`not-found` emission paths where a leaf page can call `notFound()`. `owner` is
`node.fullPath || "/"` — the same identity used for lazy cache keys, so keys and owners cannot drift.

### 6.2 What must not change

- Route **shapes** stay byte-identical for apps that never call `notFound()`: the wrapper is a context
  provider and a boundary around an element, not a new route object. The existing shape assertions in
  `test/routes.test.js` and the traversal-cost test in the same file stay green (no second subtree walk
  is added: the owner is computed where the element is already built).
- `NOT_FOUND_ROUTE_HANDLE`, `isNotFoundRoute`, `isUnmatched`, `getRouteStatus`,
  `normalizeRequestTarget`: **no signature, no behavior, no wording change** in this step.
- `handle` still describes the *route*; the outcome still describes the *render*. Nothing moves a
  decision from one to the other.

### 6.3 `RouteErrorBoundary`: one added branch

```ts
render() {
  if (this.state.hasError && isRenderSignal(this.state.error)) throw this.state.error;  // NEW
  ...as today
}
```

`getDerivedStateFromError` still records any thrown value (the two-field `hasError`/`error` state keeps
`throw null` correct); the branch is at render time, which is the mechanism React documents for passing
an error to a parent boundary and behaves the same on React 18 and 19. A test in the existing lifecycle
block pins "a control-flow signal is not a failure this boundary owns".

## 7. `next-vite-router/ssr` (D3)

New build entry (`src/ssr/index.ssr.ts` → `dist/ssr.js` / `dist/ssr.cjs` / `dist/ssr.d.ts` + `.d.cts`).

### 7.1 API

```ts
/** The one reading of the target: normalizeRequestTarget plus the query/fragment it dropped. */
export function prepareRequest(url: string): PreparedRequest;

/** Pure. Total. Same outcome in, same plan out — testable with no server and no stream. */
export function planResponse(
  outcome: RenderOutcome,
  options?: {
    /** The route table's answer, from getRouteStatus(). Omitted = the plan computes it. */
    preFlight?: 200 | 404;
    /** Headers the app insists on; they win, except `location`, which the plan owns. */
    headers?: Headers;
    noindexOnFallback?: boolean;   // default true
    noStoreOnRedirect?: boolean;   // default true
  },
): RenderPlan;

export type RenderPlan = Readonly<
  | { kind: "page";      status: 200; headers: Headers; pass: 1; sendBody: true;  forceOwner: null }
  | { kind: "not-found"; status: 404; headers: Headers; pass: 1; sendBody: true;  forceOwner: null;  degraded: false }
  | { kind: "not-found"; status: 404; headers: Headers; pass: 2; sendBody: true;  forceOwner: string; degraded: false }
  | { kind: "not-found"; status: 200; headers: Headers; pass: 2; sendBody: true;  forceOwner: string; degraded: true }
  | { kind: "not-found"; status: 404; headers: Headers; pass: 3; sendBody: true;  forceOwner: string; degraded: false }
  | { kind: "redirect";  status: 307 | 308; headers: Headers; pass: 1; sendBody: false; forceOwner: null }
  | { kind: "error";     status: 500 | 200; headers: Headers; pass: 1 | 2 | 3; sendBody: boolean; forceOwner: null; error: unknown; degraded: boolean }
>;

/** The element to hand to the caller's router. `pass`/`forceOwner` come from the plan. */
export function renderApp(
  routes: RouteObject[],
  context: { outcome: RenderOutcome; plan: RenderPlan },
): ReactElement;   // outcome provider + (pass 2) forced-owner provider; no router inside

export interface RenderCallbacks {
  /** The shell is renderable, but no bytes have been written by this adapter yet. */
  onShellReady(): void;
  /** The complete tree is renderable; used by non-streaming/prerender callers. */
  onAllReady(): void;
  /** No usable shell exists. The adapter must not call onShellReady afterwards. */
  onShellError(error: unknown): void;
  /** Reports an ordinary React error or a render signal with its request/pass context. */
  onError(error: unknown): void;
}

/**
 * Required adaptation boundary around ReactDOMServer.
 *
 * A Node adapter maps renderToPipeableStream's callbacks and pipe/abort directly.
 * A Web adapter maps renderToReadableStream's promise to the same callbacks:
 * stream availability is onShellReady, `shellReady` resolves at that boundary,
 * `allReady` is onAllReady, rejection before
 * shell is onShellError, and the renderer's onError option is onError. The adapter
 * must retain the stream without consuming it until the protocol calls send().
 */
export interface RenderAttempt {
  pipeTo(sink: RenderSink): void;
  stream: ReadableStream<Uint8Array> | null;
  abort(): void;
  readonly shellReady: Promise<void>;
  readonly allReady: Promise<void>;
}

export type RenderEngine = (
  element: ReactElement,
  callbacks: RenderCallbacks,
) => RenderAttempt | Promise<RenderAttempt>;

export interface RenderSink {
  write(chunk: string | Uint8Array): unknown;
  end(chunk?: string | Uint8Array): unknown;
}

/** Platform-neutral adapter: Node's ServerResponse satisfies RenderSink structurally. */
export interface ResponseAdapter {
  head(status: number, headers: Headers): void;   // exactly once, before any byte
  send(attempt: RenderAttempt): void | Promise<void>; // no-op for a redirect plan
  abandon(attempt: RenderAttempt): void;              // discard an aborted pass, never reach the client
  fail(status: 500, error: unknown): void | Promise<void>; // independent pre-shell fallback
}

/** The whole protocol for one request, given React's own render API. */
export async function renderResponse(input: {
  routes: RouteObject[];
  url: string;
  adapter: ResponseAdapter;
  render: RenderEngine;
  streaming?: boolean;              // false = non-streamed rendering, up to three awaited attempts (prerender default)
  shellTimeoutMs?: number;
  onFailure?(failure: RenderFailure): void;
}): Promise<RenderPlan>;            // the plan actually committed, for the app's own logging

export type RenderFailure =
  Readonly<{ request: PreparedRequest; pass: 1 | 2 | 3 }> &
  (
    | Readonly<{ kind: "signal"; signal: RenderSignal }> // expected control flow
    | Readonly<{ kind: "error"; error: unknown }>       // ordinary render failure
    | Readonly<{ kind: "timeout"; afterMs: number }>
  );
```

`RenderCallbacks` are part of the contract, not optional notifications. `renderResponse` supplies
them for every pass and associates each callback with the current request, `RenderOutcome`, and pass
number. `onError` first classifies branded signals, records them with `recordSignal`, and records
ordinary renderer failures with `recordFailure`; on the server there is no class-boundary fallback
that can make such a failure handled. `onFailure` is an observer after that classification, not the
storage mechanism. `onShellError` is an ordinary pre-shell failure unless it is a signal.
The adapter must call `onShellReady` at most once and must never pipe before it. This contract is
implementable with both React engines, but the P1/P2 tests must verify the mappings above before the
entry point is frozen.

The renderer does not use a class boundary to produce an SSR `error.tsx` fallback. An ordinary
failure before the shell is therefore recorded as an uncaught failure and plans `500`; an ordinary
failure after the shell leaves the already committed `200` response and is reported to the client
boundary during hydration. A folder `error.tsx` can provide the client fallback in the latter case,
but cannot turn a pre-shell server failure into a `200` document.

### 7.2 State machine (streaming)

```
prepareRequest ──► planResponse(pre-flight)
                        │
        404 from the route table? ──yes──► render once ─► head(404 + noindex) ─► send
                        │ no
                        ▼
              pass 1 render (buffered, not piped)
                        │
        ┌───────────────┼────────────────────────┐
   no signal        redirect signal        not-found signal
        │                   │                       │
  head(200)            head(3xx, location)     abandon(pass 1)
  pipe pass 1          abandon body            planResponse(signal)
                                               head(404 + noindex)
                                               pass 2 render ─► pipe
                                               (signal again in pass 2 → abandon pass 2)
                                               → plan parent owner
                                               → pass 3 render ─► pipe
        └───────────────────────────────────────────────────────────┘
   signal recorded after head() ─► status frozen ─► plan.degraded = true
                                   fallback paints at hydration (client boundary)
```

`renderResponse` calls `adapter.head()` exactly once for the selected pass, inside that pass's
`onShellReady`, never earlier and never twice; nothing is piped before that call. A pass that is
abandoned before its shell is committed is aborted and its `RenderAttempt` is never piped. For R3,
the pass-2 attempt is abandoned before piping, `reentrantSignal` supplies the parent `forceOwner`,
and `renderApp()` constructs a fresh tree for pass 3. Pass 3 is the final selected attempt; a signal
from it is handled by R4 as the root fallback or becomes the ordinary root failure, never pass 4. That is
the property `test/http-integration.test.js` must prove for headers-before-body, extended to "no
abandoned-pass byte ever reached the sink".

### 7.3 Status and header matrix

| situation | status | body | `x-robots-tag` / meta robots | passes |
| --- | --- | --- | --- | --- |
| URL matches no page (pre-flight `404`) | `404` | the fallback tree, **inside its layouts**; no leaf page component runs | header + meta when `noindexOnFallback` is enabled | 1 |
| `notFound()` before `onShellReady` | `404` | pass-2 fallback tree | header + meta | 2 |
| `notFound()` after the shell flushed | `200`, frozen | shell + client-painted fallback | **impossible**; meta only if the fallback HTML is streamed after the flush | 1 (+ client) |
| `redirect()` / `permanentRedirect()` before commit | `307` / `308` + `location` | none | n/a | 1 (body abandoned) |
| `redirect()` after commit | client-side `<Navigate>`; HTTP status already `200` | as streamed | n/a | 1 |
| ordinary error before shell commit, uncaught | `500` | the renderer's error document or no body according to the adapter | header + meta | 1 |
| ordinary error after shell commit, in a folder with `error.tsx` | `200` (frozen) | shell + client-painted `error.tsx` | no header; meta only if already in the committed shell | 1 |
| ordinary error in final pass 3 | `500` before commit, or `200` if already committed | explicit error or already streamed parent fallback | follows commit state | 3, never 4 |
| prerender / `streaming: false` | exact for every row above | complete HTML or explicit error | meta when the selected plan requests it, header optional | maximum 3; two when no pass-2 fallback escalation occurs |

Row 1 is the correction from review, written as the guarantee really is: pre-flight `404` does **not**
mean "no component runs". It means no *leaf page* of the requesting URL runs — the fallback, the
layouts above it, and their own providers do, and they are what makes the 404 look like the site.

### 7.4 Second render: what is guaranteed, and what is not

Guaranteed, each with its test in §9:

- **G1** nothing from an abandoned pass reaches the client: zero bytes before `head()`, and no
  chunk from an abandoned pass 1 or pass 2 in the committed body.
- **G2** at most one re-render for an initial page `notFound()`. A `notFound()` from the pass-2
  fallback is the sole exception: it causes one final pass 3 for the parent fallback, never pass 4.
  Normal pages, redirects, and pre-flight 404s render once.
- **G3** `useEffect`/`useLayoutEffect` never run in any pass: React does not run effects during
  `renderToPipeableStream`/`renderToString`. Duplicated *effects* are therefore impossible in SSR.
- **G4** the fallback identity is the same one a client boundary would have caught (same component,
  same owner, one resolution function).
- **G5** the plan is a pure function of the outcome, so `404`/`307`/`500` can be tested without a
  stream, a socket or React.

Explicitly **not** guaranteed, and this is the reservation kept in the spec:

- **N1** a single execution of a component. React renders a component more than once inside one pass
  (Suspense re-renders, a re-armed boundary, dev StrictMode, future React internals). The second pass
  makes that more visible, it does not create it. **Render bodies must be idempotent reads**: data
  fetched during render may be fetched twice, so the package gives no dedup and the README must not
  imply one. A page that must not repeat work owns that concern (its own request cache, or reads that
  are safe to repeat).
- **N2** cost. Pass 2 costs a second render of the tree up to the owner, plus a load of the
  `not-found` chunk when the folder has one (that loader is lazy, like every fallback today).
- **N2a** a reentrant fallback costs a third render of the tree up to the parent owner. This is
  intentional and is limited to the malformed or unusual case where a fallback calls `notFound()`.
- **N3** status and headers after commit. The degraded row of the matrix is a limitation, not a bug
  to fix later. A late fallback cannot retroactively add a `<meta>` element to a flushed `<head>`.

### 7.5 Headers, cookies, and what an abandoned pass loses

- The caller owns the initial `Headers` object. `planResponse` never mutates it: it clones it once
  and returns a new `Headers` instance. The caller must pass the same initial headers when planning
  pass 2; headers produced while rendering abandoned pass 1 are not implicitly visible to pass 2.
- There is no separate cookie exception or hidden cookie bag. Every `Set-Cookie` value supplied in
  the initial headers is copied to the committed plan; cookies produced by an abandoned pass are
  discarded with that pass. When applying the plan, an adapter uses `headers.getSetCookie()` when
  available (the Node 20 compatibility probe must verify this) and otherwise forwards the single
  `Headers.get("set-cookie")` value without attempting to split on commas. This fallback is
  lossless for a single cookie and avoids corrupting `Expires` attributes; callers requiring
  multiple cookies on a runtime without `getSetCookie()` must provide them through the adapter's
  platform-specific response mechanism.
- Application headers win by default. The plan adds `cache-control: no-store` and
  `x-robots-tag: noindex` only when the application did not provide those names. `location` is the
  sole plan-owned header: a redirect always replaces an application `location`, and non-redirect
  plans remove it. This makes the conflict rule deterministic while retaining application cache and
  robots policy when explicitly supplied.
- `renderApp` adds the robots meta element at the document root when the selected plan has
  `noindexOnFallback`. It is rendered in the initial document tree for pre-flight 404s and pass-2
  fallback renders, not in `NotFoundBoundary` itself. For a late signal, the protocol cannot
  promise a meta element: it is present only if the fallback markup is streamed after the existing
  document/head position and the application document accepts it; no post-flush head mutation is
  attempted.
- `Headers` is a Web global (Node ≥ 18, Edge, browsers) — which is why the API takes it and not
  `NodeHttp.OutgoingHttpHeaders` (D3's constraint).

## 8. Invariants, and the test that pins each

| # | invariant | tier |
| --- | --- | --- |
| I1 | `notFound()` records before it throws; the recorded owner equals the context owner. | T1 unit |
| I2 | A signal is never treated as an ordinary failure: `error.tsx` does not paint for it, on either side. | T1 + T3 |
| I3 | `notFound()` outside a route render throws a diagnostic error, never a signal. | T1 |
| I4 | R2: a layout's `notFound()` is owned by an ancestor, and the layout is not replaced by itself. | T1 + T3 |
| I5 | R3/R5: a signal inside a fallback escalates once, then resolves in one final parent-fallback pass; no fourth pass is possible. | T1 + T2 |
| I20 | An ordinary failure recorded in pass 3 produces the corresponding `500`/degraded `200` plan, retains `pass: 3`, and never schedules pass 4. | T1 + T2 |
| I6 | R4: no owner anywhere ⇒ built-in `DefaultNotFound` at owner `"/"`, identical to the base guard. | T1 + T3 |
| I7 | The fallback resolution is one function used by client and server (no second table). | code review + I4 |
| I8 | Route shapes and traversal cost unchanged when nothing calls `notFound()`. | T1 (`routes.test.js`) |
| I9 | `getRouteStatus()` signature, behavior and wording unchanged by this work. | T1 (existing) |
| I10 | Pre-flight `404` renders the fallback **and its layouts**, and never the leaf page. | T2 |
| I11 | `planResponse` is pure and total; first record wins independently for the initial and reentrant signal slots, and for the ordinary-failure slot. | T1 |
| I12 | A redirect sends `location` and no body; `307`/`308` exactly; `replace` never changes a status. | T1 + T2 |
| I13 | `head()` is called exactly once, before the first byte, and never after a write. | T2 |
| I14 | **Concurrency**: two outcomes interleaved (A signals `notFound()`, B does not, promises resolve in reverse order) commit `404` and `200` respectively, with each other's content absent from both bodies. | T2 |
| I15 | No module-level outcome exists: `next-vite-router/ssr` holds no mutable state between requests. | static check + I14 |
| I16 | G1: no abandoned-pass byte reaches the sink; G3: no effect ran in any pass. | T2 |
| I17 | A document streamed for `notFound()` hydrates without a recoverable/mismatch error. | T4 |
| I18 | The client reproduces the server's decision: same page code, same fallback, same URL kept. | T3 |
| I19 | Adding `NotFoundBoundary` does not move who owns an ordinary failure: with the new boundary in place, a page that throws still paints **its folder's** `error.tsx`, not the root's and not a fallback. | T1 + T3 |

## 9. Compatibility constraints the design has to respect

- **C1** React `>=18 <20`: nothing may rely on React 19-only options (`abort(reason)`,
  `onCaughtError`), and the re-throw-at-render path is chosen because it behaves identically on both.
- **C2** `react-router` `>=6 <8`, and the **`react-router`-only** job has no `react-router-dom`:
  `next-vite-router/ssr` and `src/router/flow.ts` must import only `react`. `Navigate` lives behind
  the generated module (like `Link`), never in the `ssr` entry.
- **C3** ESM and CJS builds: `dist/ssr.js`, `dist/ssr.cjs`, `dist/ssr.d.ts`, `dist/ssr.d.cts`. The
  `package.json` `build` script's `.d.cts` copy list and the `exports` map both gain an entry; the
  `files` list already ships `dist`.
- **C4** No `node:*` import in the `ssr` entry, so the same code runs in Edge and in a prerender
  worker (D3's nuance), and `RenderSink` is duck-typed instead of `ServerResponse`.
- **C5** `renderToReadableStream` (Web) and `renderToPipeableStream` (Node) both fit through
  `RenderEngine` + `RenderAttempt`.

## 10. Files that will change (implementation step, later — none now)

| file | change |
| --- | --- |
| `src/router/flow.ts` **new** | signals, `notFound`/`redirect`/`permanentRedirect`, predicates |
| `src/router/render-outcome.ts` **new** | outcome type/factory, the two context hooks |
| `src/router/boundary.ts` | `NotFoundBoundary`, `RedirectGate` (client), signal re-throw in `render()` |
| `src/routes/converter.ts` | `notFoundOwnerElement(node, inherited)` around page elements only |
| `src/router/not-found.ts` | **no change** (documentation wording may; behavior none) |
| `src/ssr/index.ssr.ts` **new** | `prepareRequest`, `planResponse`, `renderApp`, `renderResponse`, types |
| `src/plugin-runtime.ts` | export the flow API for the generated module to re-export |
| `src/index.ts` | export the predicates (public, for user root boundaries) |
| `src/plugin/index.plugin.ts` | generated module re-exports `notFound`/`redirect`/`permanentRedirect`; `createRouteTypes` template gains their declarations |
| `src/routes.placeholder.d.ts`, `**/src/routes.placeholder.d.ts` | same declarations for the fallback shape |
| `vite.config.ts` | `ssr` lib entry |
| `package.json` | `exports["./ssr"]`, `.d.cts` copy list |
| `README.md` | "Flow control" section, the SSR contract, the HTTP-status rewrite, imports table |
| `CHANGELOG.MD` | user-managed release metadata (unchanged by me) |

## 11. Test matrix to build with the implementation

- **T1 unit (`node:test`, static render + direct lifecycle calls)** — I1, I3–I12, I15, I20, purity of
  `planResponse`, owner resolution table, escalation counts, and an ordinary pass-3 failure.
  Follows the existing style:
  `renderToStaticMarkup` cannot run a class catch, so the boundary's lifecycle is pinned directly and
  the *paint* is proven through the gate path, which does run server-side.
- **T2 real HTTP (`test/http-integration.test.js`, extended)** — I10, I13, I14, I16, I20, G1, G2, G3,
  the matrix rows, and "no pass-1/pass-2 byte". Keeps the existing discipline: the status on the wire and the
  committed plan are asserted from the same outcome, never re-derived by the test.
- **T3 browser (Playwright, `test/browser-app`)** — I2, I4, I6, I18, I19: a click that runs `notFound()`
  paints the folder's not-found inside the root layout with the URL unchanged; a folder that has both
  `error.tsx` and `not-found.tsx` shows the 404; back/forward over a 404 answer; `redirect()` from a
  link click.
- **T4 compatibility (`compatibility.yml`)** — `test/compat-app` gains `notFound()`/`redirect()` SSR
  cases plus a hydration leg (I17) on React 18.3.1 / 19.2.0 × Router 6.30.6 / 7.18.4 × ESM/CJS ×
  `react-router`-only. This is the tier where "boundaries do not catch on the server" is proven, not
  assumed, so it is not optional.
- **T5 package surface (`test-modules.js`, `test-package.js`)** — `next-vite-router/ssr` resolves in
  both formats, its `.d.cts` exists, and the ESM/CJS plans agree on the same outcome.

## 12. Probes to run before the first line of the implementation

The reservation kept from review is exactly this list; each is answerable in a throwaway script, and
each decides something in §7 that must not be guessed.

1. **P1 buffering and callback adaptation** — on React 18.3.1 and 19.2.0, does an un-piped
   `renderToPipeableStream` hold every chunk until `pipe()` and does the
   `renderToReadableStream` promise expose the same shell/all-ready ordering? Does `abort()` before
   piping leave the sink untouched in both adapters? Decides whether G1 needs a workaround.
2. **P2 error timing and classification** — for a synchronous throw inside the shell, is `onError`
   guaranteed to fire before `onShellReady`, and is the value our signal instance, unmodified and
   un-wrapped? For an ordinary throw, which callback order distinguishes pre-shell `500` from a
   committed `200`? Decides the pass-2 trigger and failure-recording rules (both majors).
3. **P3 suspended signal** — a `notFound()` thrown from inside a Suspense boundary that resolves after
   the shell: which callbacks fire, and can the fallback HTML still be streamed? Decides the degraded
   row's honest wording.
4. **P4 hydration** — hydrating a fallback-painted document: does the client boundary path produce a
   clean tree, and which callback reports a mismatch on each React major? Decides I17 and whether the
   fallback needs a stable marker element to keep hydration quiet.
5. **P5 `Navigate`** — `<Navigate to replace>` rendered by a gate during hydration on Router 6.30.6 vs
   7.18.4, including a relative `to`. Decides whether the client redirect path needs an effect instead.
6. **P6 `Headers`** — `Object.fromEntries`/`getSetCookie` availability at the Node floor (`>=20`) and
   in the CJS bundle. Decides the header merge rules in §7.5.

### 12.1 Probe results

The probes were run in an isolated temporary project on Node `22.19.0`, with the following
matrices: React/ReactDOM `18.3.1` + Router DOM `6.30.6`, and React/ReactDOM `19.2.0` + Router DOM
`7.18.4`. Both React versions produced the same result:

| probe | observed result | contract consequence |
| --- | --- | --- |
| P1 | On both React 18.3.1 and 19.2.0, `onShellReady` and `onAllReady` fired once; no chunk was observed before `pipe()`; the complete Node document arrived after piping. Aborting before `pipe()` left the Node sink with zero chunks. The Web renderer returned an unlocked `ReadableStream`; cancelling its reader before consumption produced no delivered chunks. | Both render engines provide the required body timing and pre-emission abandonment. The callback mapping for the Web renderer remains an adapter responsibility and must be covered by P1/P2 implementation tests. |
| P2 | A synchronous render error produced no shell, then `onError`, then `onShellError`; the error was reported twice overall. | Failure recording must be idempotent and must not treat a duplicate callback as a second failure. |
| P3 | A shell committed with Suspense fallback; after the promise resolved, the late error produced `onError` after the shell and `onAllReady` still fired. | The status is already frozen after `onShellReady`; this is the degraded post-commit case, not a second pass. |
| P4 | Hydrating matching fallback markup produced no recoverable errors. | A stable fallback document can hydrate cleanly. This probe does not prove every boundary transition; I17 still requires the T4 browser case. |
| P5 | `Navigate` is exported as a function in Router 6.30.6 and 7.18.4. | The generated client-side gate can use `Navigate`; relative-target behavior remains a T3/T4 test. |
| P6 | On Node 22.19.0, `Headers` cloning preserved repeated `Set-Cookie` entries and `getSetCookie()` was available. No Node 20 runtime was available in this environment. | The plan does not require `getSetCookie()` to exist: use it when available and otherwise forward the combined `set-cookie` value without comma-splitting. The Node 20 compatibility job remains mandatory before implementation is approved. |

These probes validate the adapter shape and the post-commit limitation, but do not validate the
library implementation: no source file outside this document was changed, and P4 used a matching
fallback tree rather than the eventual `NotFoundBoundary` implementation. P6 is not closed for the
package's Node `>=20` floor until the compatibility job runs on Node 20.

## 13. Documentation deltas the contract commits to

- README: a new **Flow control** section (`notFound()`, `redirect()`, `permanentRedirect()`,
  which fallback answers, URL unchanged on a 404, the client/server mechanism split); the HTTP-status
  section rewritten so `getRouteStatus()` is described as pre-flight and `planResponse()` as the final
  plan; the imports table gains `next-vite-router/ssr`; the limits table gains the streamed-404 row and
  N1 ("render bodies must be idempotent reads; a component may run more than once").
- Semver: a new subpath export plus new app-facing functions is a **minor** bump by the package's own
  rule. No breaking change is proposed: the `error.tsx` signal re-throw only affects values carrying
  the brand.
