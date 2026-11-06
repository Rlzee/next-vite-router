# Flow-control signals, render outcomes and the SSR response contract

Status: **design, approved for specification — no implementation approved.**
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
  /** The first signal recorded. First record wins: a second one is a page bug, not a negotiation. */
  readonly signal: RenderSignal | null;
  /** Set by `commit()` only. A signal arriving after it cannot change the status: the plan degrades. */
  readonly committed: boolean;
  /** True once `committed` is set and a signal was recorded afterwards. */
  readonly degraded: boolean;
  record(signal: RenderSignal): void;
  markCommitted(): void;
}

export function createRenderOutcome(request: PreparedRequest): RenderOutcome;

/** Provided by the SSR helper around the app element; absent in the browser. */
export function useRenderOutcome(): RenderOutcome | undefined;
/** Provided by the owner marker; the answer to "whose 404 would catch me". */
export function useNotFoundOwner(): string | undefined;
```

**Architectural invariant (from review, kept as a hard rule):** the outcome reaches a component only
through React context, created per request. A module-level outcome is forbidden — it is the exact
shape that leaks between concurrent SSR requests, and it would make the concurrency test in §8/I14
pass by accident instead of by construction. `useRenderOutcome()` returning `undefined` in the browser
is what makes the client mechanism exception-driven.

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
- The fallback is rendered with this boundary's catch re-armed as **inert**: a second `notFound()`
  inside a not-found page becomes a plain diagnostic error, never a re-entry (§5.3, I5).
- The URL does not change and no navigation is pushed: `notFound()` answers the URL the reader is on.

### 5.2 Server / prerender

- The class catch never runs. `render()` consults the outcome instead: when
  `outcome.signal?.kind === "not-found" && outcome.signal.owner === this.owner`, it renders the
  fallback. This is why the component's *position* is the same on both sides — the second pass cannot
  disagree with what a boundary would have caught.
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
| R3 | `notFound()` called from a **fallback** escalates once, then becomes a plain error at the root. | Bounded, diagnosable, never silent. |
| R4 | No owner anywhere → the eager built-in `DefaultNotFound` at owner `"/"`. | Identical to the pre-flight base-guard answer; the two paths cannot disagree. |
| R5 | Server: at most **two** passes (`maxRenderPasses: 1` re-render). A signal recorded in pass 2 resolves through R3/R4 only. | The cap the review asked for, expressed as a number. |
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
  | { kind: "redirect";  status: 307 | 308; headers: Headers; pass: 1; sendBody: false; forceOwner: null }
  | { kind: "error";     status: 500 | 200; headers: Headers; pass: 1; sendBody: boolean; forceOwner: null; error: unknown; degraded: boolean }
>;

/** The element to hand to the caller's router. `pass`/`forceOwner` come from the plan. */
export function renderApp(
  routes: RouteObject[],
  context: { outcome: RenderOutcome; plan: RenderPlan },
): ReactElement;   // outcome provider + (pass 2) forced-owner provider; no router inside

export interface RenderSink {
  write(chunk: string | Uint8Array): unknown;
  end(chunk?: string | Uint8Array): unknown;
}

/** Platform-neutral adapter: Node's ServerResponse satisfies RenderSink structurally. */
export interface ResponseAdapter {
  head(status: number, headers: Headers): void;   // exactly once, before any byte
  send(body: RenderBody): void | Promise<void>;    // no-op for a redirect plan
  abandon(body: RenderBody): void;                  // discard an aborted pass, never reach the client
}

export type RenderBody = Readonly<{
  /** Web-standard when present; a `Response` can be built from it directly. */
  stream: ReadableStream<Uint8Array> | null;
  /** Node path: attach React's output to the sink. Silently unused when `stream` is null. */
  pipeTo(sink: RenderSink): void;
}>;

/** The whole protocol for one request, given React's own render API. */
export async function renderResponse(input: {
  routes: RouteObject[];
  url: string;
  adapter: ResponseAdapter;
  render(element: ReactElement): Promise<RenderBody> | { pipe(sink: RenderSink): void; abort(): void };
  streaming?: boolean;              // false = one awaited render, exact statuses (prerender default)
  shellTimeoutMs?: number;
  onFailure?(failure: RenderFailure): void;
}): Promise<RenderPlan>;            // the plan actually committed, for the app's own logging

export type RenderFailure =
  | Readonly<{ kind: "signal"; signal: RenderSignal }>   // control flow: expected, never logged as an error
  | Readonly<{ kind: "error"; error: unknown }>          // ordinary render failure
  | Readonly<{ kind: "timeout"; afterMs: number }>;
```

### 7.2 State machine (streaming)

```
prepareRequest ──► planResponse(pre-flight)
                        │
        404 from the route table? ──yes──► head(404 + noindex) ─► render once ─► pipe
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
                                               (signal again in pass 2 → R3/R4, no pass 3)
        └───────────────────────────────────────────────────────────┘
   signal recorded after head() ─► status frozen ─► plan.degraded = true
                                   fallback paints at hydration (client boundary)
```

`renderResponse` calls `adapter.head()` **inside** React's `onShellReady`, never earlier and never
twice; nothing is piped before that call. That is the property `test/http-integration.test.js`
already proves for headers-before-body, extended to "no pass-1 byte ever reached the sink".

### 7.3 Status and header matrix

| situation | status | body | `x-robots-tag` / meta robots | passes |
| --- | --- | --- | --- | --- |
| URL matches no page (pre-flight `404`) | `404` | the fallback tree, **inside its layouts**; no leaf page component runs | header when not yet committed, meta always | 1 |
| `notFound()` before `onShellReady` | `404` | pass-2 fallback tree | header + meta | 2 |
| `notFound()` after the shell flushed | `200`, frozen | shell + client-painted fallback | **impossible**; meta only if the fallback HTML is streamed after the flush | 1 (+ client) |
| `redirect()` / `permanentRedirect()` before commit | `307` / `308` + `location` | none | n/a | 1 (body abandoned) |
| `redirect()` after commit | client-side `<Navigate>`; HTTP status already `200` | as streamed | n/a | 1 |
| ordinary error before commit, uncaught | `500` | the app's own error document | header + meta | 1 |
| ordinary error inside a folder with `error.tsx` | `200` (a page matched) | shell + `error.tsx` at hydration | none | 1 |
| prerender / `streaming: false` | exact for every row above | complete HTML | meta always, header optional | ≤2 |

Row 1 is the correction from review, written as the guarantee really is: pre-flight `404` does **not**
mean "no component runs". It means no *leaf page* of the requesting URL runs — the fallback, the
layouts above it, and their own providers do, and they are what makes the 404 look like the site.

### 7.4 Second render: what is guaranteed, and what is not

Guaranteed, each with its test in §9:

- **G1** nothing from an abandoned pass reaches the client: zero bytes before `head()`, and no
  pass-1 chunk in the committed body.
- **G2** at most one re-render, in exactly one situation (a recorded `not-found` before commit).
  Normal pages, redirects, and pre-flight 404s render once.
- **G3** `useEffect`/`useLayoutEffect` never run in either pass: React does not run effects during
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
- **N3** status after commit. The degraded row of the matrix is a limitation, not a bug to fix later.

### 7.5 Headers, cookies, and what an abandoned pass loses

- A page has no header API. `Set-Cookie` and friends belong to the app's server; the plan only ever
  *adds* `location`, `cache-control: no-store`, and `x-robots-tag: noindex`.
- Headers the app accumulated for a pass that got abandoned are **discarded**, except the app's own
  `cookies` bag if it passes one to `planResponse({ headers })`: those are re-attached to the
  committed plan, and the spec says so rather than leaving it implicit.
- `Headers` is a Web global (Node ≥ 18, Edge, browsers) — which is why the API takes it and not
  `NodeHttp.OutgoingHttpHeaders` (D3's constraint).

## 8. Invariants, and the test that pins each

| # | invariant | tier |
| --- | --- | --- |
| I1 | `notFound()` records before it throws; the recorded owner equals the context owner. | T1 unit |
| I2 | A signal is never treated as an ordinary failure: `error.tsx` does not paint for it, on either side. | T1 + T3 |
| I3 | `notFound()` outside a route render throws a diagnostic error, never a signal. | T1 |
| I4 | R2: a layout's `notFound()` is owned by an ancestor, and the layout is not replaced by itself. | T1 + T3 |
| I5 | R3/R5: a signal inside a fallback escalates once, then becomes a plain error; ≤ 2 passes total. | T1 + T2 |
| I6 | R4: no owner anywhere ⇒ built-in `DefaultNotFound` at owner `"/"`, identical to the base guard. | T1 + T3 |
| I7 | The fallback resolution is one function used by client and server (no second table). | code review + I4 |
| I8 | Route shapes and traversal cost unchanged when nothing calls `notFound()`. | T1 (`routes.test.js`) |
| I9 | `getRouteStatus()` signature, behavior and wording unchanged by this work. | T1 (existing) |
| I10 | Pre-flight `404` renders the fallback **and its layouts**, and never the leaf page. | T2 |
| I11 | `planResponse` is pure and total; `first record wins` on the outcome. | T1 |
| I12 | A redirect sends `location` and no body; `307`/`308` exactly; `replace` never changes a status. | T1 + T2 |
| I13 | `head()` is called exactly once, before the first byte, and never after a write. | T2 |
| I14 | **Concurrency**: two outcomes interleaved (A signals `notFound()`, B does not, promises resolve in reverse order) commit `404` and `200` respectively, with each other's content absent from both bodies. | T2 |
| I15 | No module-level outcome exists: `next-vite-router/ssr` holds no mutable state between requests. | static check + I14 |
| I16 | G1: no abandoned-pass byte reaches the sink; G3: no effect ran in either pass. | T2 |
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
  `render(...)` + `RenderBody`.

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

- **T1 unit (`node:test`, static render + direct lifecycle calls)** — I1, I3–I12, I15 purity of
  `planResponse`, owner resolution table, escalation counts. Follows the existing style:
  `renderToStaticMarkup` cannot run a class catch, so the boundary's lifecycle is pinned directly and
  the *paint* is proven through the gate path, which does run server-side.
- **T2 real HTTP (`test/http-integration.test.js`, extended)** — I10, I13, I14, I16, G1, G2, G3,
  the matrix rows, and "no pass-1 byte". Keeps the existing discipline: the status on the wire and the
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

1. **P1 buffering** — does an un-piped `renderToPipeableStream` on React 18.3.1 and 19.2.0 hold every
   chunk until `pipe()` with no loss or duplication, and does `abort()` before any `pipe()` leave the
   sink untouched? Decides whether G1 needs a workaround (e.g. a counting sink).
2. **P2 error timing** — for a synchronous throw inside the shell, is `onError` guaranteed to fire
   *before* `onShellReady`, and is the value our signal instance, unmodified and un-wrapped? Decides
   the pass-2 trigger condition (both majors).
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

## 13. Documentation deltas the contract commits to

- README: a new **Flow control** section (`notFound()`, `redirect()`, `permanentRedirect()`,
  which fallback answers, URL unchanged on a 404, the client/server mechanism split); the HTTP-status
  section rewritten so `getRouteStatus()` is described as pre-flight and `planResponse()` as the final
  plan; the imports table gains `next-vite-router/ssr`; the limits table gains the streamed-404 row and
  N1 ("render bodies must be idempotent reads; a component may run more than once").
- Semver: a new subpath export plus new app-facing functions is a **minor** bump by the package's own
  rule. No breaking change is proposed: the `error.tsx` signal re-throw only affects values carrying
  the brand.
