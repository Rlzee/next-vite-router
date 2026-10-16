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
// src/App.tsx
import { Router } from "virtual:next-vite-router";

export default function App() {
  return <Router />;
}
```

```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
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
  Link,
  generateRoutes,
  useRoutes,
  useParams,
} from "virtual:next-vite-router";
import { useNavigate } from "react-router-dom";

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
(`useNavigate`, `useLocation`, `Link`, `Outlet`). For parameters, import
`useParams` from the virtual module instead of `react-router-dom`: dynamic
`[id]` segments work with either hook, but named catch-all segments
(`[...slug]`, `[[...slug]]`) are only surfaced as `slug` through the package
`useParams`. React Router's own `useParams` returns them under `params["*"]`.

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
| `[...slug]` | Catch-all `*` segment; package `useParams` exposes it as `slug` |
| `[[...slug]]` | Optional catch-all `*` segment; package `useParams` exposes it as `slug` |
| `(admin)` | Route group omitted from the URL |

Catch-all pages and `not-found.tsx` at the same level both use React Router's
`*` path and are rejected during route validation because their fallback
behavior would be ambiguous. The catch-all parameter provider wraps the page
route, so a layout cannot read that parameter through the package `useParams`
hook.

The Vite plugin accepts custom `pageFile`, `layoutFile`, and `notFoundFile`
names. `createRouteGenerator` accepts the same options, plus `pagesDir`, as
its optional fourth argument when custom glob paths or extensions are used.
For the Vite plugin, `pagesDir` is relative to the Vite project root (the
default is `src/app`). The lower-level route path utility also accepts an
absolute `pagesDir`, which is useful for custom route generators.

Layouts are the recommended way to add route-scoped navigation, providers, or
authorization:

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
    <AuthGuard>
      <Outlet />
    </AuthGuard>
  );
}
```

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

## Lazy loading

Pages and `not-found.tsx` files use Vite's non-eager `import.meta.glob`, so
Vite can emit separate chunks for pages. Layouts are eager because they wrap
the generated route tree. Vite handles ordinary content changes to pages,
layouts, and `not-found.tsx` through its normal HMR mechanism. Creating,
deleting, or renaming a route-related file also refreshes the generated route
module and route declarations. Because Vite cannot reliably preserve a cached
route tree when an `import.meta.glob` entry is added or removed, these
structural changes trigger a full-page reload as a fallback. Lazy-loaded route
components remain lazy-loaded during normal navigation. Lazy loading is
enabled by default:

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
  treeToRoutes,
} from "next-vite-router";
```

The normal pipeline is:

```text
filesystem -> buildRouteTree() -> treeToRoutes() -> RouteObject[] -> React Router
```

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
