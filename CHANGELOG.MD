# Changelog

All notable changes to this project are documented in this file.

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
[1.2.1]: https://github.com/Rlzee/next-vite-router/compare/v1.2.0...HEAD
