# Changelog

All notable changes to this project are documented in this file.

## [2.1.0] - 2026-10-22

### Added

- Typed navigation helpers. `href(pattern, params)` fills a route pattern from
  the generated `RoutePath` union into a concrete URL, and a `Link` component
  takes that pattern in `href` plus its values in `params`, forwarding every
  other prop to React Router's `Link`. `href`/`Link` and the `RouteParams` /
  `LinkProps` types are exported from the package and the virtual module.
- `useCatchAll()`, which reads a catch-all folder as its individual path
  segments (`string[]`, the Next.js shape) instead of the single splat string
  React Router reports.
- Lazy layouts. The plugin gained a `lazyLayouts` option (and the matching
  `RouteTreeOptions` on `createRouteGenerator`/`buildRouteTree`) that reads
  `layout.tsx` files from a non-eager glob so Vite emits a separate chunk per
  layout. It stays off by default, keeping layouts eager.
- Catch-all values accepted in array form by `href` and `Link`, so a route can
  be read with `useCatchAll()` and re-linked unchanged
  (`href("/blog/*", { slug: useCatchAll() })`).

### Changed

- Hardened CLI package-manager detection: `PREFERRED_PM` is matched against the
  supported managers before it reaches the availability probe, so an unexpected
  value is reported and ignored instead of being interpolated into a shell
  command.

### Fixed

- Route files that cannot render now fail with an error naming the source file
  instead of silently dropping a layout or surfacing as a nameless React render
  error: a missing default export, an eager module passed where a lazy loader is
  expected, and a lazy `import()` loader read as an eager component (a non-eager
  glob without `lazyLayouts`) are each reported against their `layout.tsx` /
  `page.tsx` / `not-found.tsx` path.
- The component-type check now matches only the `memo`, `forwardRef`, and `lazy`
  wrapper tags rather than any object carrying `$$typeof`, so a plain React
  element is no longer mistaken for a component and rendered in silence.
- `href` percent-encodes each substituted path segment itself instead of relying
  on React Router's `generatePath`, whose behavior differs between v6 (values
  verbatim) and v7 (values encoded). The result is now identical on both, keeps
  `/` as the separator inside a catch-all value, and can no longer let an
  unencoded value inject a path, query, or fragment.
- Nested layouts no longer enumerate their own subtree twice while generating
  routes, removing the traversal cost that grew exponentially with layout depth.
- `useCatchAll()` drops empty segments, so a trailing slash (`/docs/guide/api/`)
  reads as `["guide", "api"]` instead of carrying a final `""`.

### Tests

- Added coverage for `href`, `Link`, `useCatchAll`, lazy layouts, the array
  catch-all form, eager-layout guarding, `href` encoding, and the generated route
  types.
- Replaced the source-text `PREFERRED_PM` check with a behavioral test that
  bundles the detector and asserts a hostile `PREFERRED_PM` value never reaches a
  shell command while a whitelisted one is still honored.

### Documentation

- Documented `href`, `Link`, `useCatchAll`, lazy layouts, and the encoding
  behavior in the README, and added a typed-routes example page.

## [2.0.1] - 2026-10-19

### Added

- Exported `createLazyCache()` and the `LazyComponentCache` type so route
  generators can own an explicit `React.lazy` component cache instead of sharing
  a package-wide singleton.

### Changed

- Isolated the `React.lazy` component cache per route generator. Each
  `createRouteGenerator()` call, and each standalone `treeToRoutes()` call, now
  uses its own cache, so two independent generators can no longer collide on the
  same route key and resolve each other's loaders.
- `treeToRoutes()` gained an optional trailing `cache` parameter. Existing
  `treeToRoutes(node, isRoot, currentPath)` calls still work and simply build
  their own cache, and the same cache instance is threaded through the whole
  route-tree build.
- `createLazyElement()` now takes its owning cache as the third argument.
- `clearLazyCache()` clears the specific cache passed to it. Calling it with no
  argument is deprecated: there is no shared cache left to reset, so the
  no-argument form only emits a warning. Because a generator reuses a single
  cache, swapping a loader for an already-generated route key keeps the memoized
  component; create a new generator (with a fresh cache) when the sources change.

### Fixed

- Rejected catch-all segments that are not the final route segment (for example
  `docs/[...slug]/edit/page.tsx`), which previously parsed successfully but
  generated a route that could never match. The error names the offending file.
- Resolved the plugin's physical pages root from the normalized `pagesDir`, so a
  backslash-spelled value such as `src\\app` now works on POSIX instead of
  scanning a folder literally named `src\\app` and emitting a declaration with no
  routes.

### Tests

- Added coverage for misplaced required and optional catch-all segments, and for
  the faulty file named in the error.
- Added a dedicated suite for the Vite plugin dev-server lifecycle: page
  creation in an existing folder, deletion, dynamic-segment rename, route
  conflicts, conflict recovery without a restart, and cancelling a pending full
  reload when the server closes.
- Added coverage for the per-generator cache: reuse within one cache, isolation
  across caches, `clearLazyCache(cache)`, loader swaps ignored by a generator,
  and a fresh generator resolving the swapped loader.
- Added a POSIX regression case verifying `pagesDir: "src\\app"` still generates
  routes.

### Documentation

- Updated README guidance for layout usage and the authorization pattern, and
  documented the generator's loader-stability contract and cache scoping.

## [2.0.0] - 2026-10-17

### Removed (breaking)

- Removed the optional middleware API. `registerMiddleware`,
  `clearMiddlewares`, and the `RouteMiddleware` type are no longer exported.
  Move cross-cutting wrappers such as auth guards into a layout inside a route
  group:

  ```tsx
  // src/app/(protected)/layout.tsx
  import { Navigate, Outlet } from "react-router-dom";

  export default function ProtectedLayout() {
    const isAuthed = useAuth();
    return isAuthed ? <Outlet /> : <Navigate to="/login" replace />;
  }
  ```

  The route group keeps the guard out of the URL, and every page beneath the
  layout is protected.
- `createLazyElement` no longer accepts its optional third `routePath`
  argument. Existing calls still execute at runtime, but TypeScript code that
  passes the argument must drop it to compile.

### Changed

- Declared `engines.node` (`>=18`); consumers on an older Node now get a clear
  warning at install time instead of an obscure runtime error, and the unit
  tests run across a Node 18, 20, and 22 matrix to back that promise.
- Exposed `package.json` in the `exports` map, so
  `require("next-vite-router/package.json")` now resolves instead of throwing
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

### Documentation

- Replaced the "Optional middleware" README section with an "Auth guards"
  guide built on layouts and route groups, and swapped the middleware example
  in `examples/` for a runnable `(protected)` auth-guard demo with a login
  page.

## [1.3.1] - 2026-10-16

### Changed

- Renamed the CLI command from `init` to `create` and the published binary
  from `create-next-vite-router` to `next-vite-router`; projects are now
  scaffolded with `npx next-vite-router create`.
- The `create` command prompts for the project name, template, `src` folder
  usage, and Tailwind CSS setup before scaffolding.

### Fixed

- Generated TypeScript configs no longer set the deprecated `baseUrl`, so
  freshly scaffolded projects build again on the TypeScript version installed
  by the current Vite template; the `@/*` path aliases are preserved.
- Rejected invalid project names and existing target directories before
  scaffolding, guarding against `create-vite` exiting 0 on an existing
  directory and the scaffold then deleting that project's `src/` folder.
- Scaffold cleanup is limited to the Vite template files it replaces when a
  `src` folder is used, so unrelated files in `src/` are preserved.
- CLI errors are logged as a single readable message and exit with code 1
  instead of surfacing a raw unhandled rejection stack trace.
- Fixed the no-`src` scaffold mode:
  - Generated Vite configs target the root-level `app/` directory through
    `nextViteRouter({ pagesDir: "app" })`.
  - `index.html` loads the root-level `main.tsx` entry instead of
    `/src/main.tsx`.
- Route-type generation creates the declaration directory when missing and
  warns instead of crashing the build or dev server when the
  `virtual-next-vite-router.d.ts` file cannot be written.

## [1.3.0] - 2026-10-14

### Added

- Shipped a CommonJS build of the Vite plugin (`next-vite-router/plugin`) so
  `vite.config.*` files load under Vite 5 without a `type: "module"` package.
- Exposed `clearLazyCache` and `resetRouterConfig` to reset the package's
  module-level singletons (the lazy component cache and the router config),
  mirroring the existing `clearMiddlewares`.

### Changed

- Normalized the `pagesDir` option so `./src/app`, `src\app`, and `src/app/`
  behave identically across the emitted glob, the runtime base, and the
  generated TypeScript declarations.

### Fixed

- Preserved route folders whose name matches the pages directory (for example
  an `app` route under `pagesDir: "app"`), which previously collapsed onto `/`.
- Resolved the lazy loading fallback at render time, so `configureRouter`
  changes made after `generateRoutes()` are now honored.
- Removed the stray committed `virtual-next-vite-router.d.ts` declarations; the
  file is now generated only where the plugin runs and is git-ignored.
- Set `package.json` `repository.url` to the full
  `git+https://github.com/…/next-vite-router.git` form (publint suggestion).

### Tests

- Ran the unit test suites on every pull request through a dedicated
  `unit-tests` CI job, driven by a single `pnpm test` script that
  `prepublishOnly` now reuses.
- Isolated the route-types test in a temporary directory so it no longer writes
  generated declarations into tracked source folders.
- Reset every module singleton between route-generator tests to stop state
  leaking through the shared lazy cache.

### Documentation

- Clarified React Router integration and data-loading usage in the README.

## [1.2.4] - 2026-10-12

### Added

- Added semantic route collision detection for dynamic parameters, route
  groups, catch-all routes, and `not-found.tsx` fallbacks.
- Added shared route-segment parsing for runtime route generation, validation,
  and generated TypeScript declarations.
- Added integration coverage for React Router matching, layouts, optional
  catch-all routes, custom file names, HMR, and consumer TypeScript types.

### Changed

- Refactored route conversion into focused helpers for pages, layouts, index
  routes, route groups, catch-all routes, and not-found fallbacks.
- Generated route declarations now safely quote route keys and validate
  parameter names and duplicate parameters.
- Clarified `pagesDir` configuration, route matching, and server-side
  authorization guidance.

### Fixed

- Reject ambiguous routes that would resolve to the same URL pattern,
  including dynamic parameters with different names.
- Reject conflicts between catch-all pages and `not-found.tsx` at the same
  route level.
- Escape custom route directories correctly when extracting paths from
  Windows and special-character paths.

## [1.2.3] - 2026-10-09

### Fixed

- Route file creation, deletion, and renaming now reliably refresh generated route declarations and the virtual route module.
- Ordinary content changes to pages, layouts, and `not-found.tsx` continue to use Vite's normal HMR mechanism.
- Structural route changes trigger a full-page reload when Vite cannot safely preserve the cached route tree.
- Route watcher handlers are properly cleaned up when the dev server closes or is reconfigured.
- Structural reload timers are coalesced to prevent redundant reloads and cancelled during watcher cleanup.
- Route collisions no longer trigger route declaration updates or full-page reloads.

### Tests

- Added deterministic coverage for watcher registration and cleanup, route
  collision handling, reload coalescing, and timer cancellation.
- Added browser-level verification for route additions and removals during
  development.

## [1.2.2] - 2026-10-08

### Fixed

- Fixed nested page rendering when a route has both a page and child routes:
  - Parent pages are now emitted as `index` routes.
  - Child routes are no longer hidden by a parent page without an `Outlet`.
- Fixed the same issue for root pages that have child routes.
- Added duplicate route detection for route groups that resolve to the same URL.
  - Multiple collisions are reported together with their source files.
  - The Vite plugin reports collisions during build and logs them without
    breaking the dev server during route file updates.
- Optional catch-all routes now include their base path in generated
  `RoutePath` types (for example, both `/docs` and `/docs/*`).
- The CLI now generates `nextViteRouter()` when default options are used.
- Replaced generated `__dirname` usage in Vite aliases with an ESM-compatible
  `import.meta.url` implementation.

### Tests

- Added regression coverage for nested pages, root pages with child routes,
  grouped route collisions, custom file names, and generated Vite aliases.

## [1.2.1] - 2026-10-08

### Fixed

- Added runtime support for optional catch-all routes:
  - `[[...segments]]` now matches `/docs`.
  - The same route also matches `/docs/foo` and `/docs/foo/bar`.
- Optional catch-all route parameters are optional in generated TypeScript types.
- Reset global and sticky middleware regular expression state between matches.

### Tests

- Added runtime matching coverage for optional catch-all routes.
- Added coverage for named required and optional catch-all parameters.

## [1.2.0] - 2026-10-07

### Added

- Added named catch-all parameter support through the package `useParams` hook.
- Added route-group support for pages and layouts declared directly in a group.
- Added support for `not-found.tsx` without a local layout.
- Added configurable page, layout, and not-found file names.
- Added custom `pagesDir` support for route path extraction.
- Added generated route parameter types for catch-all routes.
- Added HMR handling for route file creation and deletion.

### Changed

- Route generation is lazy when using the generated `Router` component.
- Layouts and not-found routes now receive middleware.
- The Vite plugin is available through `next-vite-router/plugin` and is no
  longer exported from the main browser entry point.
- Generated virtual declaration files are added to `.gitignore` by the CLI.
- Added `sideEffects: false` to the package metadata.
- Improved `RouteNode` type safety.

### Tests

- Added `useParams` integration coverage with `MemoryRouter`.
- Added route-group, custom-file-name, not-found, and HMR-related regression
  coverage.

## [1.1.1] - 2026-10-07

### Changed

- Improved CLI project initialization.
- Added improved template options and CLI command handling.
- Updated generated project configuration and setup documentation.

## [1.1.0] - 2026-10-04

### Added

- Added dynamic route generation and type-safe route paths.
- Added nested layouts and route-scoped UI guidance.
- Added lazy page loading with configurable loading fallbacks.
- Added the `Router` convenience component and virtual-module exports.
- Added an example Vite application.
- Added route generator, package, and compatibility test suites.

### Changed

- Updated peer dependency ranges for supported React, React Router, and Vite
  versions.
- Updated the CLI template to use React Router 7.
- Improved documentation for layouts, lazy loading, route types, and project
  positioning.

## [1.0.7] - 2025-12-29

### Changed

- Renamed the CLI command to `create-next-vite-router`.
- Updated the package version and CLI-related documentation.

## [1.0.6] - 2025-12-10

### Fixed

- Updated generated application TypeScript configuration to handle the `src`
  project layout correctly.
- Adjusted generated path aliases accordingly.

## [1.0.4] - 2025-12-04

### Changed

- Improved the lazy-loading configuration and related README documentation.

## [1.0.3] - 2025-11-21

### Added

- Initial documented routing implementation for React and Vite.
- File-based route generation using React Router route objects.
- Dynamic routes and route middleware support.
- TypeScript declaration guidance for the virtual routing module.

### Documentation

- Added the initial usage guide, route conventions, and project examples.

## [Unreleased]

No unreleased changes.

[1.0.3]: https://github.com/Rlzee/next-vite-router/commit/418b2e3
[1.1.0]: https://github.com/Rlzee/next-vite-router/releases/tag/v1.1.0
[1.1.1]: https://github.com/Rlzee/next-vite-router/commit/185f3f3
[1.2.0]: https://github.com/Rlzee/next-vite-router/releases/tag/v1.2.0
[1.2.1]: https://github.com/Rlzee/next-vite-router/releases/tag/v1.2.1
[1.2.2]: https://github.com/Rlzee/next-vite-router/compare/v1.2.1...v1.2.2
[1.2.3]: https://github.com/Rlzee/next-vite-router/releases/tag/v1.2.3
[1.2.4]: https://github.com/Rlzee/next-vite-router/releases/tag/v1.2.4
[1.3.0]: https://github.com/Rlzee/next-vite-router/compare/v1.2.4...v1.3.0
[1.3.1]: https://github.com/Rlzee/next-vite-router/compare/v1.3.0...v1.3.1
[2.0.0]: https://github.com/Rlzee/next-vite-router/compare/v1.3.1...v2.0.0
[2.0.1]: https://github.com/Rlzee/next-vite-router/compare/v2.0.0...v2.0.1
[2.1.0]: https://github.com/Rlzee/next-vite-router/compare/v2.0.1...v2.1.0
