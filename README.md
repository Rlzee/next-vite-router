# Next Vite Router

File-based routing for React + Vite.

Define routes with folders and let the package generate the
[React Router](https://reactrouter.com/) `RouteObject[]`. It does not replace
React Router, navigation, history, or application state.

## Table of contents

- [Quick start](#quick-start)
- [File-based routing](#file-based-routing)
- [Navigation and params](#navigation-and-params)
- [Features](#features)
- [Advanced API](#advanced-api)
- [Compatibility](#compatibility)
- [Examples](#examples)
- [Development](#development)
- [License](#license)

## Imports at a glance

Three entry points, each with one job. **This is the source of truth for imports**
— everything else in this README follows it.

| Import from | Provides | Use it for |
| --- | --- | --- |
| `next-vite-router/routes` | `Router`, `generateRoutes`, `useRoutes`, `href`, `Link`, `useParams`, `useCatchAll`, and the types `RoutePath` / `RouteParams` / `LinkProps` | application code (pages, layouts, components) |
| `next-vite-router` | `configureRouter`, `createRouteGenerator`, `buildRouteTree`, `treeToRoutes`, and the path/lazy utils | configuration and advanced / manual routing |
| `next-vite-router/plugin` | `nextViteRouter` | `vite.config.ts` only |

The navigation helpers are generated per project (they are bound to your route
metadata), so they are served **only** from `next-vite-router/routes`. The
package root does **not** export `href`, `Link`, `useParams`, or `useCatchAll`;
importing them from `next-vite-router` does not resolve. There is no `virtual:`
specifier to remember — `next-vite-router/routes` is the single import path for
the generated module.

## Quick start

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install next-vite-router
```

Add the plugin to `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nextViteRouter } from "next-vite-router/plugin";

export default defineConfig({
  plugins: [react(), nextViteRouter()],
});
```

Create a route tree under `src/app`:

```text
src/app/
├── page.tsx
└── users/
    ├── page.tsx
    └── [id]/
        └── page.tsx
```

Render the generated router inside a React Router provider:

```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { BrowserRouter } from "react-router-dom";
import { Router } from "next-vite-router/routes";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Router />
    </BrowserRouter>
  </StrictMode>,
);
```

That is the whole setup. Run it:

```bash
npm run dev
```

The tree above generates `/`, `/users`, and `/users/:id`.

### Setup notes

- `next-vite-router` declares `react-router-dom` as a peer dependency. Recent
  npm versions install peers automatically; if your package manager does not,
  install `react-router-dom` explicitly.
- The plugin ships both ESM and CJS, so it works when `package.json` has no
  `"type": "module"` (Vite 5 loads `vite.config.ts` with `require()` in that
  case). Rename the file to `vite.config.mts` to force ESM.

## File-based routing

Routes are a folder tree under `pagesDir` (default `src/app`). The plugin reads
it and produces the matching `RouteObject[]`.

| File or folder | Result |
| --- | --- |
| `page.tsx` | Route page |
| `layout.tsx` | Nested layout rendered with React Router's `Outlet` |
| `not-found.tsx` | `*` route for that subtree, and the fallback for a catch-all base path |
| `[id]` | Dynamic segment `:id` |
| `[...slug]` | Catch-all `*` segment (one or more segments; its base path 404s) |
| `[[...slug]]` | Optional catch-all `*` segment (also matches the base path) |
| `(admin)` | Route group omitted from the URL |

### Dynamic segments

`[id]` compiles to a single `:id` segment. `users/[id]/page.tsx` becomes
`/users/:id`; read the value with [`useParams()`](#useparams).

### Layouts

A nested `layout.tsx` wraps its subtree and renders an `Outlet` where the child
route appears:

```text
src/app/
├── layout.tsx
└── dashboard/
    ├── layout.tsx
    └── page.tsx
```

```tsx
import { Outlet } from "react-router-dom";

export default function DashboardLayout() {
  return (
    <div>
      <nav>{/* dashboard-scoped navigation and providers */}</nav>
      <Outlet />
    </div>
  );
}
```

Authorization belongs in the same place; see [Auth guards](#auth-guards).

### Route groups

A `(name)` folder groups routes without adding a URL segment, which is how an
auth guard is scoped to a subtree (see [Auth guards](#auth-guards)).

### Catch-all routes

`[...slug]` and `[[...slug]]` map onto React Router's single `*` splat:
`blog/[...slug]/page.tsx` becomes `/blog/*`, matching `/blog/a`, `/blog/a/b`,
and so on. `[[...slug]]` (double brackets) additionally matches the base path
(`/blog`).

A required catch-all does **not** match its base path, exactly as in Next.js.
React Router's `*` consumes zero or more segments and a static parent matches
`/blog` on its own, so the converter answers the base with a guard route that
renders the nearest `not-found.tsx` (`blog/not-found.tsx`, else the one further
up) inside the layouts above: `/blog` shows that not-found, and only `/blog/...`
reaches the page. `href("/blog/*", { slug: "" })` throws for the same reason —
the two sides agree on what a required catch-all accepts. With no `not-found.tsx`
anywhere the guard renders nothing, so you get the layouts with an empty outlet
where Next.js would show its built-in 404 page. Use `[[...slug]]` when the base
should render the page instead.

The folder name (`slug`) is what you use everywhere:

- **Read it** — `useParams().slug` returns the matched remainder as **one
  string** (`"a/b"`), matching the value type of React Router's own `useParams`.
  `useCatchAll()` returns the **segment array** (`["a", "b"]`, the Next.js shape).
- **Link to it** — `href("/blog/*", { slug: ... })` and
  `<Link href="/blog/*" params={{ slug: ... }} />` (a string or the
  `useCatchAll()` array).
- **Scope** — the name reaches the page and a `layout.tsx` declared *in the same
  folder* (`docs/[...slug]/layout.tsx`). A layout *above* that segment
  (`docs/layout.tsx`) cannot read it: it renders before the splat is part of the
  match.

A `not-found.tsx` inside the catch-all folder itself (`blog/[...slug]/not-found.tsx`)
would claim the same splat as the page, so it is rejected during route
validation. Put it in the folder holding the catch-all (`blog/not-found.tsx`),
where it answers the base URL. See [Navigation and params](#navigation-and-params)
for the `href`/`useCatchAll` signatures.

A catch-all directly in `pagesDir` (`src/app/[...slug]/page.tsx`) has `/` as its
base, so it cannot sit beside a root `page.tsx`: both would answer `/`. Keep one
of them — the catch-all alone (`/` renders the not-found), or `page.tsx` alone
with the catch-all moved under a folder.

### Not-found routes

A `not-found.tsx` becomes a `*` route for its subtree. Nest it under a layout to
give a section its own fallback. Beside a required catch-all folder it does not
become a `*` route — the catch-all page already owns every URL below the base —
so it is used as the fallback for that folder's base URL instead.

### Custom file names and pages directory

The Vite plugin accepts custom `pageFile`, `layoutFile`, and `notFoundFile`
names. `createRouteGenerator` accepts the same options plus `pagesDir` as its
optional fourth argument. For the plugin, `pagesDir` is relative to the Vite
project root (default `src/app`); the lower-level route-path utility also accepts
an absolute `pagesDir`, useful for custom generators.

## Navigation and params

All the helpers below come from `next-vite-router/routes`.

### `Link`

`Link` puts a route pattern in `href`, the way Next.js does, and checks it
against the generated routes: a renamed folder, a missing id, or a catch-all key
the route does not declare fails instead of rendering a 404 link. Every other
`Link` prop (`className`, `replace`, `state`, children, …) is forwarded to React
Router.

```tsx
import { Link } from "next-vite-router/routes";

<Link href="/users/:id" params={{ id: user.id }}>Profile</Link>
<Link href="/users">All users</Link>
<Link href="/blog/*" params={{ slug: ["guide", "api"] }}>Guide</Link>
```

`href` must be a generated route. Anything outside the route tree — an external
URL, for instance — goes through React Router's own `Link` (its `to` prop) or a
plain anchor. React Router's `Link`, `NavLink`, and `useNavigate` stay available
from `react-router-dom`; give them the value returned by `href`:

```tsx
import { Link } from "react-router-dom";
import { href } from "next-vite-router/routes";

<Link to={href("/users/:id", { id: user.id })}>Profile</Link>
```

### `href()`

`RoutePath` lists patterns (`/users/:id`), not URLs, so `href` fills a pattern in
and returns the address:

```ts
import { href } from "next-vite-router/routes";

href("/users/:id", { id: "123" });   // "/users/123"
href("/blog/*", { slug: "guide/api" }); // "/blog/guide/api"
href("/about");                      // "/about"
```

TypeScript requires the second argument as soon as the pattern has parameters,
and rejects a pattern that is not a route. A catch-all is keyed by its declared
folder name (see [Catch-all routes](#catch-all-routes)); a `:name` param stays a
single string.

#### `href()` reference (behavior and edge cases)

Beyond filling the pattern, `href` guarantees a correct, safe URL:

- **Percent-encodes each substituted segment** itself rather than delegating to
  React Router's `generatePath`, whose behavior differs between v6 (values
  verbatim) and v7 (values encoded). The result is identical on either version,
  and there is nothing to encode by hand first
  (`href("/users/:id", { id: "a/b?x#y" })` is `/users/a%2Fb%3Fx%23y`). A
  catch-all keeps `/` as the separator between its segments
  (`href("/blog/*", { slug: ["a b", "c?d"] })` is `/blog/a%20b/c%3Fd`).
- **Drops empty segments** the way `useCatchAll` reads them, so a leading or
  trailing slash (`"a/b/"`) or a blank array entry (`["a", "", "b"]`) cannot
  inject `//` into the path.
- **Rejects `.` and `..` values.** No encoding stops a browser (or React Router)
  from resolving a bare dot-segment out of the path (`/users/..` becomes `/`), so
  a segment that is exactly `.` or `..` throws instead of producing a link that
  escapes its own segment. Longer values (`...`, `a.b`) and pre-encoded ones
  (`%2e%2e`, escaped again) stay safe.
- **Validates catch-all keys at runtime.** The public pattern is `/blog/*`, which
  does not carry the folder name, so the plugin generates that name into a
  metadata map and passes it to `href`/`Link`. `href("/blog/*", { slug: ... })`
  fills the splat, while `href("/blog/*", { other: ... })` throws instead of being
  routed onto the catch-all — a misspelled or renamed key fails loudly rather
  than 404ing. React Router's `"*"` stays accepted as the splat alias.
- **Rejects a required value that is missing or empty.** A required `:name`
  (`href("/users/:id", { id: "" })`) and a required `[...slug]` (`href("/blog/*", {})`)
  throw, because encoding an empty `:name` or leaving a required splat empty
  resolves to a different route. An optional `[[...segments]]` still collapses to
  its base path (`href("/docs/*", {})` is `/docs`).

### `useParams()`

Reads the matched parameters. `[id]` and a catch-all both arrive as **strings**,
so nothing needs narrowing — `useParams` keeps the same value type as React
Router's own.

```tsx
import { useParams } from "next-vite-router/routes";

// users/[id]/page.tsx rendering /users/42
const { id } = useParams();          // "42"
// blog/[...slug]/page.tsx rendering /blog/guide/api
const { slug } = useParams();        // "guide/api" (one string)
```

A named catch-all is surfaced under its folder name (`slug`) only through this
package's `useParams`; React Router's own returns it under `params["*"]`.

### `useCatchAll()`

Returns a catch-all as its individual segments (`string[]`), split on `/`. It
yields `[]` whenever no catch-all matched, including the base path of an optional
catch-all and any layout rendered above the catch-all segment.

```tsx
import { useCatchAll } from "next-vite-router/routes";

// docs/[[...segments]]/page.tsx rendering /docs/guide/api
useCatchAll();          // ["guide", "api"]
useCatchAll("segments"); // the same, by folder name
```

The array is first-class on the write side too: `href`/`Link` accept it, so
reading and re-linking share one shape —
`<Link href="/blog/*" params={{ slug: useCatchAll() }}>This article</Link>`.

### Typed routes

The Vite plugin generates `virtual-next-vite-router.d.ts` automatically, so no
manual declaration is required. Invalid paths and missing dynamic parameters are
reported by TypeScript.

```tsx
import type { RouteParams, RoutePath } from "next-vite-router/routes";

const path = "/users/:id" satisfies RoutePath;
const params: RouteParams<typeof path> = { id: "123" };
```

### Using React Router directly

`Router` is only a convenience wrapper around `useRoutes(generateRoutes())`. If
you want to own the render, both are available from `next-vite-router/routes`,
and every other React Router API (`useNavigate`, `useLocation`, `Outlet`, `Link`
with `to`) comes from `react-router-dom` as usual.

```tsx
import { generateRoutes, useRoutes } from "next-vite-router/routes";
import { Link } from "react-router-dom";

const routes = generateRoutes();

export default function App() {
  const element = useRoutes(routes);

  return (
    <>
      <Link to="/users">Users</Link>
      {element}
    </>
  );
}
```

The generated `RouteObject[]` carries page, layout, and not-found elements only.
There is no file convention that produces React Router route `loader` or `action`
functions, and those data APIs run only under a data router (`createBrowserRouter`
+ `RouterProvider`), not under `BrowserRouter` with `useRoutes`. Fetch data
inside your page components instead.

## Features

### Lazy loading

Pages and `not-found.tsx` files use Vite's non-eager `import.meta.glob`, so Vite
emits a separate chunk per page. Layouts are eager by default: a layout wraps its
whole subtree, so keeping it in the entry chunk avoids a fallback flash and a
chunk round-trip before the page can be requested.

`lazyLayouts` code-splits layouts like pages:

```ts
// vite.config.ts
import { nextViteRouter } from "next-vite-router/plugin";

export default defineConfig({
  plugins: [react(), nextViteRouter({ lazyLayouts: true })],
});
```

Each layout then gets its own chunk, rendered behind a `Suspense` boundary that
`loadingFallback` covers; its subtree renders through the layout's own `Outlet`,
so a nested page is requested only after the layout chunk arrives. That trade is
worth it for large or rarely visited shells, not for the root.

### Router configuration

`configureRouter` (from the `next-vite-router` root) sets the lazy-loading
fallback and toggles lazy loading:

```tsx
import { configureRouter } from "next-vite-router";

configureRouter({
  loadingFallback: () => <div>Loading route...</div>,
});
```

The fallback is read when a route suspends during render, so the order of
`configureRouter` relative to `generateRoutes()` does not matter.
`enableLazyLoading: false` is available for compatibility and testing; it does
not turn Vite's asynchronous imports into synchronous ones.

### Hot reload (HMR)

Vite handles ordinary content changes to pages, layouts, and `not-found.tsx`
through its normal HMR. Creating, deleting, or renaming a route file also
refreshes the generated route module and route declarations; because Vite cannot
reliably preserve a cached route tree when an `import.meta.glob` entry is added
or removed, those structural changes trigger a full-page reload as a fallback.
Lazy-loaded route components stay lazy across normal navigation.

### Auth guards

Protect a subtree with a layout inside a route group: the group name stays out of
the URL, and the layout decides whether to render its `Outlet`.

```tsx
// src/app/(protected)/layout.tsx
import { Navigate, Outlet } from "react-router-dom";

export default function ProtectedLayout() {
  const isAuthed = useAuth();
  return isAuthed ? <Outlet /> : <Navigate to="/login" replace />;
}
```

Every page under `src/app/(protected)/` is then guarded by `useAuth()`.

### CLI

For an interactive setup:

```bash
npx next-vite-router create
```

The CLI creates a Vite React project, installs the package and
`react-router-dom@^7.0.0`, configures the plugin, and adds an example route tree.
It is published as part of `next-vite-router`; `create-next-vite-router` is its
executable name, not a separate npm package.

## Advanced API

For custom glob layouts and manual routing, the `next-vite-router` root exports
the route engine (the navigation helpers are **not** here — they come from
`next-vite-router/routes`):

```ts
import {
  buildRouteTree,
  createRouteGenerator,
  treeToRoutes,
} from "next-vite-router";
```

The pipeline is:

```text
filesystem -> buildRouteTree() -> treeToRoutes() -> RouteObject[] -> React Router
```

`buildRouteTree()` and `createRouteGenerator()` receive the glob records as Vite
produces them. Their last argument, `{ lazyLayouts: true }`, says the layouts
record comes from a non-eager glob (each entry is a loader); without it an entry
is read as an eagerly imported module or component. The flag has to match the
glob, because a loader and a component are both functions.

`createRouteGenerator(pages, layouts, notFounds, fileOptions, options)` returns a
zero-argument `generateRoutes()`; use it when you drive the globs yourself instead
of the Vite plugin.

## Compatibility

| Package | Supported versions |
| --- | --- |
| React / React DOM | `>=18 <20` |
| React Router DOM | `>=6 <8` |
| Vite | `>=5 <9` |
| Node | `>=20` |

The compatibility workflow tests React 18 and 19 with React Router 6 and 7 across
Vite 5, 6, 7, and 8, and runs the unit tests on Node 20, 22, and 24. Each
combination installs the published tarball into the app under
[`test/compat-app`](./test/compat-app), builds it for the browser and for the
server, then renders its route tree through `renderToPipeableStream`, so a
combination has to paint layouts, dynamic and catch-all parameters, `not-found`
and the generated `href`/`Link` — not merely compile.

## Examples

The repository includes a runnable showcase in [`examples/`](./examples/):
`basic`, `layouts`, `dynamic-routes`, `(protected)`, and `typed-routes`.

```bash
cd examples
pnpm install
pnpm dev
```

The app opens a small navigation menu so each example can be tested immediately.
The `predev` script builds the local package automatically.

## Development

```bash
pnpm install
pnpm run build
pnpm run test            # full suite
pnpm run test:compatibility
```

The route matrix lives in [`test/routes.test.js`](./test/routes.test.js) and
includes React Router `matchRoutes` assertions for dynamic parameters, route
groups, nested `not-found.tsx` fallbacks, and catch-all pages under layouts.
`test/test-route-types.js` covers the generated TypeScript declarations and HMR
updates, and `test/test-compatibility.js` checks the supported dependency ranges,
the generated production bootstrap, and that the compatibility matrix pins
versions inside those ranges and really renders them.

Any matrix combination can be reproduced locally by building the fixture app the
workflow uses against a packed tarball of this package:

```bash
pnpm run build
pnpm pack --pack-destination ..        # next-vite-router-<version>.tgz
cp -R test/compat-app ../compat-app    # add a package.json that installs the
                                       # tarball plus the versions to check
cd ../compat-app && pnpm install
pnpm exec vite build                   # browser bundle
pnpm exec vite build --ssr src/entry-server.tsx --outDir dist-ssr
NODE_ENV=production node dist-ssr/entry-server.js
```

## License

MIT
