# Next Vite Router

File-based routing for React + Vite.

Define routes with folders and let the package generate the
[React Router](https://reactrouter.com/) `RouteObject[]`. It does not replace
React Router, navigation, history, loaders, or application state.

## Release notes

### Plugin import

The Vite plugin is no longer exported from the main
`next-vite-router` entry point. Existing imports must be migrated:

```ts
// Previous import
import { nextViteRouter } from "next-vite-router";

// Current import
import { nextViteRouter } from "next-vite-router/plugin";
```

The plugin remains available through `next-vite-router/plugin`. This separation
prevents the plugin's Node dependencies from being included in the application's
browser dependency graph.

## Start here

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install next-vite-router react-router-dom
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

`Router` is only a convenience wrapper around `useRoutes(routes)`. Routes are
generated lazily on the first render, so calls to `configureRouter` and
`registerMiddleware` made during application setup are applied before route
elements are created. You can keep using React Router APIs:

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

Use `useNavigate`, loaders, actions, and other React Router APIs from
`react-router-dom`. The package `useParams` hook is also available from the
virtual module and maps catch-all names such as `slug`. The package does not
create competing navigation or data-loading APIs.

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
`*` path and should not be declared together if their fallback behavior must
be distinct. The catch-all parameter provider wraps the page route, so a
layout cannot read that parameter through the package `useParams` hook.

The Vite plugin accepts custom `pageFile`, `layoutFile`, and `notFoundFile`
names. `createRouteGenerator` accepts the same options, plus `pagesDir`, as
its optional fourth argument when custom glob paths or extensions are used.

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
the generated route tree; changing a layout can therefore cause a full
development reload. Lazy loading is enabled by default:

```tsx
import { configureRouter } from "next-vite-router";

configureRouter({
  loadingFallback: () => <div>Loading route...</div>,
});
```

`enableLazyLoading: false` is available for compatibility and testing. It does
not turn Vite's asynchronous imports into synchronous imports.

## Optional middleware

Prefer layouts for route-scoped behavior. `registerMiddleware` is an optional
escape hatch for cross-cutting wrappers:

```tsx
import { registerMiddleware } from "next-vite-router";

registerMiddleware(/^\/dashboard/, (element) => (
  <AuthGuard>{element}</AuthGuard>
));
```

Middleware wraps generated route elements; it does not create routes or
replace React Router.

## CLI

For an interactive setup:

```bash
npx create-next-vite-router init
```

The CLI creates a Vite React project, installs the package and
`react-router-dom@^7.0.0`, configures the plugin, and adds an example route
tree.

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
- `middleware`
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

The route matrix lives in [`test/routes.test.js`](./test/routes.test.js).

## License

MIT
