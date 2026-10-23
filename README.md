# Next Vite Router

File-based routing for React + Vite.

Define routes with folders and let the package generate the
[React Router](https://reactrouter.com/) `RouteObject[]`. It does not replace
React Router, navigation, history, or application state.

## Start here

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install next-vite-router
```

`next-vite-router` declares `react-router-dom` as a peer dependency. Recent
versions of npm install this dependency automatically; if your package manager
does not resolve peer dependencies automatically, install
`react-router-dom` explicitly.

Add the plugin to `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nextViteRouter } from "next-vite-router/plugin";

export default defineConfig({
  plugins: [react(), nextViteRouter()],
});
```

The plugin ships both ESM and CJS, so this works when `package.json` has no
`"type": "module"` (Vite 5 loads `vite.config.ts` with `require()` in that
case). You can also rename the file to `vite.config.mts` to force ESM.

Create your route tree:

```text
src/app/
├── page.tsx
├── about/
│   └── page.tsx
└── users/
    ├── page.tsx
    └── [id]/
        └── page.tsx
```

This generates:

```text
/
/about
/users
/users/:id
```

Use the generated router inside a normal React Router provider:

```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { BrowserRouter } from "react-router-dom";
import { Router } from "virtual:next-vite-router";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Router />
    </BrowserRouter>
  </StrictMode>,
);
```

That is the complete setup. Run:

```bash
npm run dev
```

## Use React Router directly

`Router` is only a convenience wrapper around `useRoutes(routes)`. The
lazy-loading behavior and `loadingFallback` configured through `configureRouter`
are read at render time, so they take effect even when `generateRoutes()` runs
at module scope before application setup finishes. You can keep using React
Router APIs:

```tsx
import {
  generateRoutes,
  useRoutes,
  useParams,
} from "virtual:next-vite-router";
import { Link, useNavigate } from "react-router-dom";

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

Keep using React Router's navigation and hooks from `react-router-dom`
(`useNavigate`, `useLocation`, `Link`, `Outlet`). The virtual module's own `Link`
is the typed, Next.js-shaped one (`href`), so React Router's `Link` — the one
that takes `to` — comes from `react-router-dom`. For parameters, import
`useParams` from the virtual module instead of `react-router-dom`: dynamic
`[id]` segments work with either hook, but named catch-all segments
(`[...slug]`, `[[...slug]]`) are only surfaced as `slug` through the package
`useParams`. React Router's own `useParams` returns them under `params["*"]`.

A catch-all param stays a single string, unlike Next.js, which hands the same
parameter over as an array: `/docs/guide/api` matched by
`docs/[[...segments]]` gives `params.segments === "guide/api"`. `useCatchAll`
returns the array form, split on `/`:

```tsx
import { useCatchAll } from "virtual:next-vite-router";

// docs/[[...segments]]/page.tsx rendering /docs/guide/api
const segments = useCatchAll();        // ["guide", "api"]
const named = useCatchAll("segments"); // the same, by folder name
```

It yields `[]` whenever no catch-all matched, which includes the base path of an
optional catch-all and any layout rendered above the catch-all segment.

The string shape is deliberate: `useParams` keeps the same value type as
React Router's own, so a `[id]` param and a catch-all both arrive as strings and
need no narrowing. The array is not second-class either — every catch-all value
accepted by `href` and `Link` also takes the `string[]` `useCatchAll()` returns,
so reading a route and linking back to it share one shape:

```tsx
<Link href="/blog/*" params={{ slug: useCatchAll() }}>This article</Link>
```

The generated `RouteObject[]` carries page, layout, and not-found elements only.
There is no file convention that produces React Router route `loader` or
`action` functions, and those data APIs run only under a data router
(`createBrowserRouter` + `RouterProvider`), not under `BrowserRouter` with
`useRoutes`. Fetch data inside your page components instead.

## File conventions

| File or folder | Result |
| --- | --- |
| `page.tsx` | Route page |
| `layout.tsx` | Nested layout rendered with React Router's `Outlet` |
| `not-found.tsx` | `*` route for that subtree |
| `[id]` | Dynamic segment `:id` |
| `[...slug]` | Catch-all `*` segment; `slug` is one string, `useCatchAll` gives the segments |
| `[[...slug]]` | Optional catch-all `*` segment; `slug` is `undefined` on the base path |
| `(admin)` | Route group omitted from the URL |

Catch-all pages and `not-found.tsx` at the same level both use React Router's
`*` path and are rejected during route validation because their fallback
behavior would be ambiguous.

The catch-all name reaches the page and a `layout.tsx` declared in the same
folder (`docs/[...slug]/layout.tsx`). A layout *above* that segment
(`docs/layout.tsx`) cannot read it: it renders before the splat becomes part of
the match, so the package `useParams` has nothing to report there.

The Vite plugin accepts custom `pageFile`, `layoutFile`, and `notFoundFile`
names. `createRouteGenerator` accepts the same options, plus `pagesDir`, as
its optional fourth argument when custom glob paths or extensions are used.
For the Vite plugin, `pagesDir` is relative to the Vite project root (the
default is `src/app`). The lower-level route path utility also accepts an
absolute `pagesDir`, which is useful for custom route generators.

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

Authorization belongs in the same place; see [Auth guards](#auth-guards) for the
guard pattern.

The Vite plugin is a Node/Vite integration and should be imported from
`next-vite-router/plugin`; the main `next-vite-router` entry remains safe for
browser application code.

## Type-safe paths

The Vite plugin generates `virtual-next-vite-router.d.ts` automatically:

```tsx
import type {
  RouteParams,
  RoutePath,
} from "virtual:next-vite-router";

const path = "/users/:id" satisfies RoutePath;
const params: RouteParams<typeof path> = { id: "123" };
```

Invalid paths and missing dynamic parameters are reported by TypeScript.
No manual declaration for the virtual module is required.

### Turning a pattern into a URL

`RoutePath` lists patterns (`/users/:id`), not URLs, so `href` fills the pattern
in and returns the address to navigate to:

```ts
import { href } from "virtual:next-vite-router";

href("/users/:id", { id: "123" }); // "/users/123"
href("/blog/*", { slug: "guide/api" }); // "/blog/guide/api"
href("/about"); // "/about"
```

A catch-all is addressed by its folder name, the same key `useParams` reports,
instead of React Router's unnamed `*` splat: `blog/[...slug]` becomes
`href("/blog/*", { slug: "..." })`, and the optional `docs/[[...segments]]`
resolves to its base path when empty (`href("/docs/*", {})` is `/docs`).
A catch-all value may also be the segment array `useCatchAll()` returns
(`href("/blog/*", { slug: ["guide", "api"] })`); a `:name` param stays a string,
because one folder matches exactly one segment. TypeScript requires the second
argument as soon as the chosen pattern has parameters, and rejects a pattern that
is not a route. `href` fills the pattern itself and percent-encodes each
substituted path segment (so `href("/blog/*", { slug: ["a b", "c?d"] })` is
`/blog/a%20b/c%3Fd`), keeping `/` as the separator inside a catch-all value.
Empty segments are dropped first, the same way `useCatchAll` drops them, so a
trailing slash (`href("/blog/*", { slug: "/a/b/" })`) or a blank array entry
(`{ slug: ["a", "", "b"] }`) resolves to `/blog/a/b` instead of injecting a
`//` into the path.
Encoding is done here rather than left to `generatePath`, whose behavior differs
between React Router v6 (values verbatim) and v7 (values encoded), so the result
is the same on either version and there is nothing to encode by hand first. The
one value encoding cannot contain is a segment that is exactly `.` or `..`: it
stays verbatim and a browser's URL parser (and React Router) resolves it out of
the path (`/users/..` becomes `/`, `/blog/../x` becomes `/x`) even written
`%2e%2e`, so `href` throws on it instead of returning a link that escapes its
own segment. A required `:name` given an empty value throws too
(`href("/users/:id", { id: "" })`): encoding `""` would drop the segment and
resolve `/users/:id` to `/users/`, a route it no longer matches, so it is
reported like a missing value instead of building that link.

### `Link`

`Link` puts a route pattern in `href`, the way Next.js does, and checks it
against the generated routes: a renamed folder or a missing id fails to compile
instead of rendering a 404 link. Every other `Link` prop (`className`,
`replace`, `state`, children, ...) is forwarded to React Router.

```tsx
import { Link } from "virtual:next-vite-router";

<Link href="/users/:id" params={{ id: user.id }}>Profile</Link>
<Link href="/users">All users</Link>
```

`href` has to be a generated route. Anything outside the route tree — an
external URL, for instance — goes through React Router's `Link` or a plain
anchor instead.

React Router's own `Link`, `NavLink`, and `useNavigate` remain available from
`react-router-dom`; give them the value returned by `href` when you need them:

```tsx
import { Link } from "react-router-dom";

<Link to={href("/users/:id", { id: user.id })}>Profile</Link>
```

## Lazy loading

Pages and `not-found.tsx` files use Vite's non-eager `import.meta.glob`, so
Vite can emit separate chunks for pages. Layouts are eager by default: a layout
wraps its whole subtree, so keeping it in the entry chunk avoids a fallback
flash and a chunk round-trip before the page can even be requested.

`lazyLayouts` code-splits layouts like pages:

```ts
// vite.config.ts
import { nextViteRouter } from "next-vite-router/plugin";

export default defineConfig({
  plugins: [react(), nextViteRouter({ lazyLayouts: true })],
});
```

Each layout then gets its own chunk, rendered behind a `Suspense` boundary that
the `loadingFallback` covers. Its subtree renders through the layout's own
`Outlet`, so a nested page is requested only after the layout chunk arrived;
that trade is worth it for large or rarely visited shells, not for the root.

Vite handles ordinary content changes to pages, layouts, and `not-found.tsx`
through its normal HMR mechanism. Creating, deleting, or renaming a route-related
file also refreshes the generated route module and route declarations. Because
Vite cannot reliably preserve a cached route tree when an `import.meta.glob`
entry is added or removed, these structural changes trigger a full-page reload
as a fallback. Lazy-loaded route components remain lazy-loaded during normal
navigation. Lazy loading is enabled by default:

```tsx
import { configureRouter } from "next-vite-router";

configureRouter({
  loadingFallback: () => <div>Loading route...</div>,
});
```

The fallback is resolved when a route suspends during render, so the order of
`configureRouter` relative to `generateRoutes()` does not matter.

`enableLazyLoading: false` is available for compatibility and testing. It does
not turn Vite's asynchronous imports into synchronous imports.

## Auth guards

Protect a subtree with a layout inside a route group: the group name stays out
of the URL, and the layout decides whether to render its `Outlet`:

```tsx
// src/app/(protected)/layout.tsx
import { Navigate, Outlet } from "react-router-dom";

export default function ProtectedLayout() {
  const isAuthed = useAuth();
  return isAuthed ? <Outlet /> : <Navigate to="/login" replace />;
}
```

Every page under `src/app/(protected)/` is then guarded by `useAuth()`.

## CLI

For an interactive setup:

```bash
npx next-vite-router create
```

The CLI creates a Vite React project, installs the package and
`react-router-dom@^7.0.0`, configures the plugin, and adds an example route
tree. The CLI is published as part of `next-vite-router`; `create-next-vite-router`
is its executable name, not a separate npm package.

## Compatibility

| Package | Supported versions |
| --- | --- |
| React / React DOM | `>=18 <20` |
| React Router DOM | `>=6 <8` |
| Vite | `>=5 <9` |

The compatibility workflow tests React 18 and 19 with React Router 6 and 7
across Vite 5, 6, 7, and 8.

## Advanced API

For custom glob layouts, the package exports:

```ts
import {
  buildRouteTree,
  createRouteGenerator,
  href,
  Link,
  treeToRoutes,
} from "next-vite-router";
```

`href` and `Link` are untyped here; the strict `RoutePath` checking comes from
the declaration file the Vite plugin generates.

The normal pipeline is:

```text
filesystem -> buildRouteTree() -> treeToRoutes() -> RouteObject[] -> React Router
```

`buildRouteTree()` and `createRouteGenerator()` receive the glob records as Vite
produces them. Their last argument, `{ lazyLayouts: true }`, says the layouts
record comes from a non-eager glob, so each entry is a loader; without it an
entry is read as an eagerly imported module or component. The flag has to match
the glob, because a loader and a component are both functions.

## Examples

The repository includes a runnable showcase in [`examples/`](./examples/):

- `basic`
- `layouts`
- `dynamic-routes`
- `(protected)`
- `typed-routes`

Run it from the examples directory:

```bash
cd examples
pnpm install
pnpm dev
```

The app opens a small navigation menu so each example can be tested
immediately. The `predev` script builds the local package automatically.

## Development

From this repository:

```bash
pnpm install
pnpm run build
pnpm run test:generator
pnpm run test:routes
pnpm run test:compatibility
pnpm exec tsc -p test/fixture/tsconfig.json --noEmit
pnpm run test:local
```

The route matrix lives in [`test/routes.test.js`](./test/routes.test.js) and
includes React Router `matchRoutes` assertions for dynamic parameters, route
groups, nested `not-found.tsx` fallbacks, and catch-all pages under layouts.
`test/test-route-types.js` covers generated TypeScript declarations and HMR
updates, while `test/test-compatibility.js` checks the supported dependency
ranges and generated production bootstrap.

## License

MIT
