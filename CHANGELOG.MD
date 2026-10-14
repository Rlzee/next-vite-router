# Changelog

All notable changes to this project are documented in this file.

## [1.2.5] - 2026-10-14

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
[1.2.5]: https://github.com/Rlzee/next-vite-router/compare/v1.2.4...v1.2.5
