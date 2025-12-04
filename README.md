# Next Vite Router

Next Vite Router is an npm package that provides Next.js-style, file-based routing for React applications built with Vite. It generates React Router route objects from a filesystem layout (pages, layouts, not-found), and it exposes a Vite plugin that injects a virtual module to generate routes at build/dev time.

## Installation

Install with your package manager of choice:

```bash
pnpm add next-vite-router
# or
npm install next-vite-router
# or
yarn add next-vite-router
```

The package has peer dependencies: React, React DOM and React Router DOM. Make sure your project already includes compatible versions (React 18+ is recommended).

## Quick Start  Vite plugin

The recommended and easiest way to use this library in a Vite app is via the Vite plugin. The plugin exposes a virtual module `virtual:next-vite-router` that provides a `generateRoutes()` function and re-exports `useRoutes` from `react-router-dom` for convenience.

Example `vite.config.ts`:

```ts
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

Example usage inside your app. **Important: generate routes once at module level** (not inside the component) to avoid infinite re-renders.

File: `src/App.tsx`

```tsx
import { useRoutes } from 'react-router-dom';
import { generateRoutes } from 'virtual:next-vite-router';

const routes = generateRoutes();

export default function App() {
  const element = useRoutes(routes);
  return element;
}
```

File: `src/main.tsx`

```tsx
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

**Key points:**

- Call `generateRoutes()` once at module level, not inside the component (prevents infinite re-renders).
- Wrap your app with `BrowserRouter` at the entry point (`main.tsx`), not inside `App`.
- `pagesDir` (default: `src/app`) is the directory where you organize your **route files** (`page.tsx`, `layout.tsx`, `not-found.tsx`). It has nothing to do with the `App.tsx` component.
- The virtual module is `virtual:next-vite-router` (the plugin resolves it internally).

**Example file structure:**

```
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

TypeScript note:

If you're using TypeScript in a consuming project, add a declaration file so the virtual module is recognized by the compiler. Create a file such as `src/virtual.d.ts` (or any `*.d.ts` included by your `tsconfig.json`) with the following content:

```ts
declare module 'virtual:next-vite-router' {
  import type { RouteObject } from 'react-router-dom';

  export const generateRoutes: () => RouteObject[];
  export { useRoutes } from 'react-router-dom';
}
```

This ensures TypeScript knows the shape of the virtual module provided by the Vite plugin and avoids `Cannot find module 'virtual:next-vite-router'` errors in editors and builds.

## Programmatic route generation

If you prefer to generate routes manually (for custom setups), the package exports helpers you can use with `import.meta.glob`.

Example:

```ts
import { createRouteGenerator } from 'next-vite-router';

// in a Vite environment
const pages = import.meta.glob('../../pages/**/page.tsx');
const layouts = import.meta.glob('../../pages/**/layout.tsx', { eager: true });
const notFounds = import.meta.glob('../../pages/**/not-found.tsx');

const generateRoutes = createRouteGenerator(pages, layouts, notFounds);
const routes = generateRoutes();
```

Use this when you need a fully custom glob layout or want to call the generator at runtime.

## API Reference

Exports from the package (see `src/index.ts`):

- `createRouteGenerator(pages, layouts, notFounds)`  returns a function that builds `RouteObject[]` using your globs.
- `buildRouteTree`  builds the intermediate route tree from page/layout/not-found globs.
- `treeToRoutes`  converts the route tree to React Router routes.
- `registerMiddleware`, `clearMiddlewares`  middleware helpers to manage registered middlewares.
- `configureRouter`  configure router-level options.
- `nextViteRouter(options)`  Vite plugin factory. Options:
  - `pagesDir?: string` (default: `src/app`)
  - `pageFile?: string` (default: `page.tsx`)
  - `layoutFile?: string` (default: `layout.tsx`)
  - `notFoundFile?: string` (default: `not-found.tsx`)
- Types exported: `RouterConfig`, `RouteNode`, `RouteMiddleware`, `NextViteRouterPluginOptions`.

### `configureRouter(config: RouterConfig)`

Use `configureRouter` to set global router options for runtime behavior. The function merges the provided `config` with any existing configuration.

Common `RouterConfig` fields:

- `loadingFallback?: React.ComponentType`  component shown while lazy-loaded page components load.
- `pagesDir?: string`  path used by the generator to resolve pages (useful if you need to override defaults at runtime).
- `enableLazyLoading?: boolean`  when true, pages are wrapped to load lazily.

Example:

```ts
import { configureRouter } from 'next-vite-router';

configureRouter({
  loadingFallback: () => <div>Loading...</div>,
  enableLazyLoading: true,
});
```

Call `configureRouter` during app bootstrap before calling `generateRoutes()`.

### `registerMiddleware(pattern: RegExp, middleware: RouteMiddleware)`

`registerMiddleware` lets you register middleware functions that will be applied to route elements whose path matches the provided `pattern` (a `RegExp`). Middlewares receive the route element (`ReactElement`) and should return a new element (for example wrapping it with providers, guards, or layout components).

Important details:

- Middlewares are stored in insertion order and applied sequentially.
- To remove all registered middlewares, use `clearMiddlewares()`.
- The internal helper `applyMiddlewares(path, element)` is used when constructing the final route element.

Example:

```ts
import { registerMiddleware } from 'next-vite-router';

registerMiddleware(/^\/dashboard/, (element) => (
  <AuthGuard>{element}</AuthGuard>
));
```

## Configuration options (plugin)

The plugin takes an options object. Defaults are:

```ts
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