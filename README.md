# Next Vite Router

Next Vite Router is an npm package that provides Next.js-style, file-based routing for React applications built with Vite. It generates React Router route objects from a filesystem layout (pages, layouts, not-found), and it exposes a Vite plugin that injects a virtual module to generate routes at build/dev time.

## Installation

Install with your package manager of choice:

```next-vite-router/README.md#L1-4
pnpm add next-vite-router
# or
npm install next-vite-router
# or
yarn add next-vite-router
```

The package has peer dependencies: React, React DOM and React Router DOM. Make sure your project already includes compatible versions (React 18+ is recommended).

Supported peer dependency ranges:

| Package | Supported versions |
| --- | --- |
| React / React DOM | `>=18 <20` |
| React Router DOM | `>=6 <8` |
| Vite | `>=5 <9` |

The CLI installs `react-router-dom@^6.0.0` by default, matching the package's stable baseline. React Router 7 can be used by an existing application and is covered by the compatibility range.

The compatibility workflow tests React 18 and 19 with React Router 6 and 7 across Vite 5, 6, 7, and 8.

## Positioning and architecture

`next-vite-router` does not replace React Router. It turns a filesystem tree into the `RouteObject[]` that React Router already understands:

```text
filesystem
    -> buildRouteTree()
    -> treeToRoutes()
    -> RouteObject[]
    -> React Router
```

The package is intentionally limited to three responsibilities:

- discover pages, layouts, and not-found files through Vite;
- build and convert the route tree;
- provide the Vite virtual module and optional route-element middleware.

Navigation, history, data loading, data fetching, and application state remain React Router/application concerns. Use React Router APIs such as `BrowserRouter`, `useRoutes`, `useNavigate`, `useParams`, loaders, and actions directly in your application.

## Lazy loading and Vite chunks

Lazy loading is enabled by default. The plugin uses Vite's native glob imports:

```ts
const pagesGlob = import.meta.glob('/src/app/**/page.tsx');
const layoutsGlob = import.meta.glob('/src/app/**/layout.tsx', { eager: true });
```

Pages and `not-found.tsx` files are intentionally non-eager, so Vite keeps them as dynamic imports and can emit separate chunks such as `dashboard` and `settings`. Layouts are eager because they wrap the route tree during generation.

With this structure:

```text
src/app/
├── page.tsx
├── dashboard/page.tsx
└── settings/page.tsx
```

the initial bundle contains the route generation code, while dashboard and settings page modules are loaded when their routes are rendered. `loadingFallback` controls what Suspense displays while a chunk loads:

```ts
configureRouter({
  loadingFallback: () => <div>Loading route...</div>,
});
```

`enableLazyLoading: false` disables the cache and configured fallback, but loaders remain asynchronous and are still rendered through `Suspense`; this is a compatibility/testing option, not a way to force Vite imports to become synchronous.

## CLI / Getting Started

The quickest way to start a new project with `next-vite-router` is to use the interactive CLI:

```next-vite-router/README.md#L5-10
npx next-vite-router init
# or
pnpm dlx next-vite-router init
# or
yarn dlx next-vite-router init
# or
bunx next-vite-router init
```

The CLI will prompt you for:

1. **Project name** — name of the folder to create
2. **Template** — which React Vite variant to use:
   - `react-ts` (React + TypeScript)
   - `react-swc-ts` (React + SWC + TypeScript)
   - `react-compiler-ts` (React Compiler + TypeScript)
3. **Src folder** — whether to keep source files in `src/` (recommended) or place them at the project root
4. **Tailwind CSS** — whether to add and configure Tailwind CSS (with `@tailwindcss/vite`)

### What the CLI does

The CLI automates the entire setup:

- Scaffolds a new Vite + React project using `create-vite`
- Installs `next-vite-router` and `react-router-dom@latest`
- Configures the Vite plugin in `vite.config.ts`
- Sets up path aliases (`@/*`) in `tsconfig.json` and Vite config
- Creates TypeScript declarations for the virtual module (`virtual:next-vite-router`)
- Generates example pages (`app/page.tsx`, `app/layout.tsx`, `app/example/page.tsx`)
- Optionally configures Tailwind CSS with `@tailwindcss/vite` and creates `global.css`

After the CLI finishes:

```next-vite-router/README.md#L11-12
cd <your-project-name>
pnpm dev
```

Your app is ready with file-based routing!

## Quick Start — Vite plugin

The recommended and easiest way to use this library in a Vite app is via the Vite plugin. The plugin exposes a virtual module `virtual:next-vite-router` that provides a `generateRoutes()` function and re-exports `useRoutes` from `react-router-dom` for convenience.

Example `vite.config.ts` usage:

```next-vite-router/README.md#L13-18
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nextViteRouter } from 'next-vite-router';

export default defineConfig({
  plugins: [
    react(),
    nextViteRouter({ pagesDir: 'src/pages' })
  ]
});
```

Example usage inside your app. You can either use the convenience `Router` component or call React Router's `useRoutes` directly.

File: `src/App.tsx`

```next-vite-router/README.md#L19-24
import { Router } from 'virtual:next-vite-router';

export default function App() {
  return <Router />;
}
```

`Router` is only a thin wrapper around `useRoutes(generateRoutes())`. It does not replace React Router. You can keep using React Router APIs directly:

```tsx
import { Link, generateRoutes, useRoutes } from 'virtual:next-vite-router';

const routes = generateRoutes();

export default function App() {
  return (
    <>
      <Link to="/users">Users</Link>
      {useRoutes(routes)}
    </>
  );
}
```

File: `src/main.tsx`

```next-vite-router/README.md#L25-33
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

Key points:

- Call `generateRoutes()` once at module level, not inside the component (prevents infinite re-renders).
- Wrap your app with `BrowserRouter` at the entry point (`main.tsx`), not inside `App`.
- `pagesDir` (default: `src/app`) is the directory where you organize your route files (`page.tsx`, `layout.tsx`, `not-found.tsx`). It has nothing to do with your `App.tsx` component.
- The virtual module is `virtual:next-vite-router` (the plugin resolves it internally).

Example file structure:

```next-vite-router/README.md#L34-42
src/
├── App.tsx                 ← Your main app component
├── main.tsx                ← Entry point (with BrowserRouter)
└── app/                    ← pagesDir (routes are organized here)
    ├── page.tsx            ← Home page
    ├── layout.tsx          ← Root layout
    └── dashboard/
        ├── page.tsx        ← /dashboard page
        └── layout.tsx      ← Dashboard layout
```

The Vite plugin generates the declaration for `virtual:next-vite-router` automatically, so no manual module declaration is required.

The repository includes a complete example in `test/fixture`. From the package root, run:

```bash
pnpm run build
pnpm run test:generator
pnpm run test:routes
pnpm run test:compatibility
pnpm exec tsc -p test/fixture/tsconfig.json --noEmit
```

`test:generator` runs the route matrix for static, dynamic, catch-all, grouped, nested-layout, not-found, Windows-path, middleware, ordering, collision, and lazy-loading cases. The other commands check the generated route types and compile the type-safe usage in `test/fixture/route-types.ts`.

## Programmatic route generation

If you prefer to generate routes manually (for custom setups), the package exports helpers you can use with `import.meta.glob`.

Example:

```next-vite-router/README.md#L48-54
import { createRouteGenerator } from 'next-vite-router';

// in a Vite environment
const pages = import.meta.glob('../../pages/**/page.tsx');
const layouts = import.meta.glob('../../pages/**/layout.tsx', { eager: true });
const notFounds = import.meta.glob('../../pages/**/not-found.tsx');

const generateRoutes = createRouteGenerator(pages, layouts, notFounds);
const routes = generateRoutes();
```

Use this when you need a fully custom glob layout or want to call the generator at runtime.

## Route folder conventions: grouping vs dynamic segments

This library follows Next.js-style conventions for naming folders that affect routing. Two common patterns are:

- Parentheses for grouping routes without affecting the URL (route groups).
- Square brackets for dynamic route segments (dynamic params in the URL).

Concrete examples:

```next-vite-router/README.md#L55-62
- Structure:
  - `src/app/(components)/header/page.tsx`
  - `src/app/blog/[id]/page.tsx`

- Behavior:
  - `header/page.tsx` will be included as a page, but the `(components)` folder will NOT appear in the generated URL. The page will be reachable at `/header` (or depending on nesting, at `/<parent>/header`).
  - `blog/[id]/page.tsx` will produce a route like `/blog/:id` where `:id` is a dynamic parameter.
```

Notes and additional patterns:

- Route groups (folders named with parentheses, e.g. `(admin)` or `(components)`) are useful to organize files, share layouts, or split code visually without adding path segments. Anything inside a group is treated as if the grouping folder does not exist in the URL.
- Dynamic segments use square brackets (e.g. `[slug]`, `[id]`). They map to route parameters and are available to your components via React Router's `useParams()` hook.
- Catch-all segments are commonly written as `[...slug]` and typically map to a wildcard or splat parameter. Optional catch-all segments are written `[[...slug]]` in Next.js — if you use or expect these conventions, confirm the behavior in your app (this library mirrors Next.js-style patterns, but check your generated routes when using more advanced patterns).

Examples of expected mappings:

```next-vite-router/README.md#L63-74
src/app/
├── blog/
│   ├── page.tsx          ← /blog
│   └── [id]/page.tsx     ← /blog/:id
└── (components)/
    └── header/
        └── page.tsx      ← /header  (the `(components)` folder is not part of the path)
```

The plugin also generates `virtual-next-vite-router.d.ts` next to your app directory. It contains a `RoutePath` union with every discovered route and a `RouteParams<Path>` helper for dynamic segments, so your application's route paths remain type-safe without a manual module declaration:

```ts
import type { RouteParams, RoutePath } from 'virtual:next-vite-router';

const path = '/blog/:id' satisfies RoutePath;
const params: RouteParams<typeof path> = { id: '123' };
```

If you ever need to verify the final route objects, call `generateRoutes()` (the virtual module) and inspect the returned `RouteObject[]` to confirm path strings and param names.

## API Reference

Exports from the package (see `src/index.ts`):

- `createRouteGenerator(pages, layouts, notFounds)` — returns a function that builds `RouteObject[]` using your globs.
- `buildRouteTree` — builds the intermediate route tree from page/layout/not-found globs.
- `treeToRoutes` — converts the route tree to React Router routes.
- `Router` — a thin convenience wrapper around `useRoutes(generateRoutes())`.
- `Link` — React Router's `Link`, re-exported for convenience.
- `registerMiddleware`, `clearMiddlewares` — middleware helpers to manage registered middlewares.
- `configureRouter` — configure router-level options.
- `nextViteRouter(options)` — Vite plugin factory. Options:
  - `pagesDir?: string` (default: `src/app`)
  - `pageFile?: string` (default: `page.tsx`)
  - `layoutFile?: string` (default: `layout.tsx`)
  - `notFoundFile?: string` (default: `not-found.tsx`)
- Types exported: `RouterConfig`, `RouteNode`, `RouteMiddleware`, `NextViteRouterPluginOptions`.

### `configureRouter(config: RouterConfig)`

Use `configureRouter` to set global router options for runtime behavior. The function merges the provided `config` with any existing configuration.

Common `RouterConfig` fields:

- `loadingFallback?: React.ComponentType` — component shown while lazy-loaded page components load.
- `pagesDir?: string` — path used by the generator to resolve pages (useful if you need to override defaults at runtime).
- `enableLazyLoading?: boolean` — when true, pages are wrapped to load lazily.

Example:

```next-vite-router/README.md#L75-80
import { configureRouter } from 'next-vite-router';

configureRouter({
  loadingFallback: () => <div>Loading...</div>,
  enableLazyLoading: true,
});
```

Call `configureRouter` during app bootstrap before calling `generateRoutes()`.

### Prefer layouts for route-scoped UI and guards

For behavior that belongs to a route subtree, prefer a filesystem layout before reaching for middleware. Layouts compose naturally with the generated route tree and keep the ownership of the UI close to the routes it wraps:

```text
src/app/
├── layout.tsx
├── page.tsx
└── dashboard/
    ├── layout.tsx
    └── page.tsx
```

Each layout can render an `Outlet` and contain the providers, navigation, or authorization boundary for its subtree:

```tsx
import { Outlet } from 'react-router-dom';

export default function DashboardLayout() {
  return (
    <AuthGuard>
      <Outlet />
    </AuthGuard>
  );
}
```

This is the recommended, Next-like approach for route-scoped composition. It uses React Router's normal nested route behavior and does not require path matching.

### `registerMiddleware(pattern: RegExp, middleware: RouteMiddleware)`

`registerMiddleware` is an optional escape hatch for cross-cutting behavior that cannot be expressed conveniently with a layout. It applies middleware functions to route elements whose path matches the provided `pattern` (a `RegExp`). Layouts should generally be preferred for route-scoped providers, guards, navigation, and UI composition.

Middlewares receive the route element (`ReactElement`) and should return a new element (for example wrapping it with a provider or guard). They do not create routes, replace React Router navigation, or provide a separate request/data-loading pipeline.

Important details:

- Middlewares are stored in insertion order and applied sequentially.
- To remove all registered middlewares, use `clearMiddlewares()`.
- The internal helper `applyMiddlewares(path, element)` is used when constructing the final route element.

Example:

```next-vite-router/README.md#L81-86
import { registerMiddleware } from 'next-vite-router';

registerMiddleware(/^\/dashboard/, (element) => (
  <AuthGuard>{element}</AuthGuard>
));
```

## Configuration options (plugin)

The plugin takes an options object. Defaults are:

```next-vite-router/README.md#L87-92
{
  pagesDir: 'src/app',
  pageFile: 'page.tsx',
  layoutFile: 'layout.tsx',
  notFoundFile: 'not-found.tsx',
}
```

Pass a custom `pagesDir` if your project uses `src/pages` or another convention.

## License

MIT
