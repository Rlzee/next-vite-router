# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

Breaking, and therefore slated for **4.0.0** rather than a 3.x patch: the removed
exports below were all published, the generated declaration changes file name, and
URL matching changes its default case. Nothing here is released yet, so the
section is kept until the batch is worth the major.

### Removed (breaking)

- `RouteTreeOptions.lazyLayouts`, published since 2.1.0, is gone. A layouts record
  now declares its shape with `layoutShape` only:

  ```diff
  - buildRouteTree(pages, layouts, notFounds, fileOptions, { lazyLayouts: true })
  + buildRouteTree(pages, layouts, notFounds, fileOptions, { layoutShape: "loader" })
  ```

  The Vite plugin's `nextViteRouter({ lazyLayouts: true })` option is **not**
  removed: it selects the glob shape it always selected and emits
  `{ layoutShape: "loader" }` beside that glob, so a project driven by the plugin
  never met the deleted option. Only hand-built records are affected.
- `normalizeSegment`, exported from the package root since before 3.0.0. The
  file-convention rules live in `parseRouteSegments` (which validates) and
  `routeSegmentToPath` (which converts); nothing inside the package called the
  wrapper, so keeping it meant keeping a second copy of the rules free to drift.
- The zero-argument `clearLazyCache()`, deprecated in 2.0.1 when lazy caches
  stopped being a package-wide singleton. `cache` is now a required parameter and
  the instance to pass is the one a generator owns. Old callers fail TypeScript
  compilation; at runtime the removed form had nothing left to clear anyway.

  These three were deleted outright instead of being kept as `@deprecated` aliases
  until a later major: a clean surface beats a shim that only postpones the same
  break.
- `guardEagerLayout`, which wrapped an eager layout to find out what it was.
  Calling or inspecting a value to tell a component from a loader is the guessing
  this release stops doing; see `layoutShape`.

### Added

- **`layoutShape`** (`LayoutRecordShape = "module" | "component" | "loader"`,
  exported from the root) on `buildRouteTree()` and `createRouteGenerator()`:
  `"module"` (default) reads module namespaces from `{ eager: true }`,
  `"component"` accepts entries unwrapped by `{ eager: true, import: "default" }`
  - a component or a class, kept with its identity - and `"loader"` reads
  `() => import("...")` from a non-eager glob so Vite emits a chunk per layout,
  while module entries in the same record stay eager. The shape is **declared, not
  inferred**: a bare function left at the default shape is refused while the tree
  is built, naming the offending `layout.tsx` and offering both declarations,
  because an unwrapped eager component and a non-eager loader are indistinguishable
  as values. The one gap no declaration can close - a record that lies about
  itself - is documented rather than papered over.
- **React Router v7 applications without the `react-router-dom` shim.** v7 folded
  the whole API into `react-router` and left the old package as a re-export shim
  whose README tells a migrated app to remove it. The plugin now resolves the
  router from the application at config time, and when the shim is absent and
  `react-router` is 7 or newer it contributes a `react-router-dom` ->
  `react-router` alias and writes the generated module and the route declaration
  against `react-router`, so this package's own imports, the generated ones and the
  application's all land on what is installed. `react-router` v6 on its own is the
  one combination that cannot work (v6 keeps `Link` in the shim): it is reported
  with both fixes instead of rewritten. `react-router` `>=6 <8` joins the peers,
  and both router peers are `optional` in `peerDependenciesMeta` because npm has no
  way to declare an either/or peer.
- **`next-vite-router configure`** wires the package into a Vite project that
  already exists: `--dir <path>`, `--no-src` for a root-level `app/` folder,
  `--tailwind`, and `--yes` to accept that an existing `main.tsx` is replaced. It
  rewrites `vite.config.ts`, the tsconfigs and `index.html` in place, is safe to
  run twice, and reports leftover template files instead of deleting anything the
  project authored.
- **`loading.tsx` and `error.tsx`** per folder, matching the Next.js conventions.
  `loading.tsx` is the folder's placeholder: pages arrive through `React.lazy`, so
  while one loads the placeholder paints inside the layout's `Outlet` instead of
  the global `loadingFallback`, and a nested `loading.tsx` overrides its parent's.
  `error.tsx` renders from a boundary around the folder's content when a render
  below it throws, receiving `{ error, reset }`; `reset()` retries, and the
  boundary also clears itself when the URL changes so another page of the folder
  is not stuck on a stale error. Both are read eagerly (a placeholder fetched by
  chunk would wait for a chunk to announce a chunk; a boundary not yet loaded
  cannot report the failure it exists for). The converter reproduces Next's
  `layout > error > loading > not-found > page` order, so a folder's `error.tsx`
  catches its page and children but **not its own layout** - that is the parent's
  job - and `not-found.tsx` renders inside both. The boundary is a class of this
  package's own, not React Router's `errorElement`, so it works under `useRoutes`
  and a data router alike. The plugin globs both files and watches them for HMR;
  `loadingFile` / `errorFile` rename them, and `buildRouteTree` gained a
  records-object form - `buildRouteTree({ pages, layouts, notFounds, loadings,
  errors, fileOptions }, options)` - to carry them (the positional form is
  unchanged and simply cannot). `createRouteGenerator` takes them as trailing
  `loadings` / `errors` arguments.

### Changed

- **Breaking:** the generated declaration file is `routes.d.ts`, named after the
  module it declares (`next-vite-router/routes`) rather than after the
  `virtual:next-vite-router` specifier that 3.0.0 retired. Same place - beside the
  pages directory - same working-tree artifact, so refresh the `.gitignore` entry
  you copied from the README or let the CLI re-add it. The build that writes
  `routes.d.ts` also removes a sibling `virtual-next-vite-router.d.ts`, but only
  one carrying `declare module 'next-vite-router/routes'`: a leftover copy declares
  that module twice, and TypeScript merges ambient module bodies, so every alias
  inside reports `TS2300: Duplicate identifier` - or, under the `skipLibCheck` the
  Vite templates enable, keeps serving the stale route union in silence.
- **Breaking for a hand-written `routes.d.ts`:** the plugin writes only the
  declaration files it recognises as its own. An existing file without that marker
  is left untouched and the refusal is warned about - `routes.d.ts` is a generic
  enough name that an application may already use it for its own route table, and a
  build must not destroy it.
- **Breaking:** URL matching is case-sensitive, like Next.js. React Router
  compiles a route pattern to a case-**in**sensitive regexp unless the route
  carries `caseSensitive: true`, and nothing set the flag, so `/USERS` answered
  `src/app/users/` and `/Blog/a` matched a `blog/[...slug]` catch-all with a
  lowercase base. The converter now stamps every path-bearing route - a sixth
  `treeToRoutes()` parameter, defaulting to `true`, with index and pathless
  routes left alone because they own no segment to compare - and both surfaces
  can opt back out: `nextViteRouter({ caseSensitive: false })` on the plugin,
  `RouteTreeOptions.caseSensitive` on `createRouteGenerator()`. Generated code
  passes the flag explicitly, so an app only changes behavior, never its
  imports. The plugin refuses anything but a boolean for the option - `"no"`,
  `1`, `null` included - because a destructuring default only covers `undefined`
  and the value is written into the generated module as it arrived, where
  `"false"` would have read as *on*. A value that does match keeps its own case
  (`/users/ABC` still fills `[id]` with `"ABC"`).
- Everything this package orders and emits is sorted by UTF-16 code unit instead of
  `String.prototype.localeCompare`: the `RoutePath` union, the route tree's
  children, and the file lists in conflict errors. The same folder tree now yields
  byte-identical output on every machine and locale, so a build host's ICU data
  cannot cause review diffs or bust a cache.

### Fixed

- **`loading.tsx` / `error.tsx` reach every descendant, not just a folder's
  direct children.** The first pass wrapped each child's `route.element` with
  the enclosing folder's boundary, which meant a page two levels below
  (`dx/y/z/page.tsx` under `dx/error.tsx`, with no `layout.tsx` at the
  intermediate folders) never landed inside the boundary: an error there
  bubbled past `dx/` to the nearest enclosing boundary, hiding the root layout
  too. The converter now inserts a pathless boundary route between a folder
  (and its layout, when it has one) and every route the folder emits at its
  own URL, so boundaries nest naturally at any depth and a root-level
  `error.tsx` renders inside the root layout instead of above it - the Next.js
  contract.
- **A route group's own `loading.tsx` / `error.tsx` now apply.** `(grp)/error.tsx`
  and `(grp)/loading.tsx` used to be dropped: the group emitted a transparent
  pathless route with no element, so the folder's boundary had nothing to guard.
  A group is now a folder like any other for boundary purposes - its pathless
  route carries the boundary element directly - so every page under the group
  renders inside the placeholder and the error, exactly like a URL-bearing
  folder's pages do. `(grp)/error.tsx` beside a root `error.tsx` still reports
  the `Duplicate route "/"` collision, unchanged.
- A folder with children but no `page.tsx` no longer paints every layout down to
  an empty outlet. React Router keeps a static parent as a valid *partial* match,
  so `/docs` rendered on its own from `docs/intro/page.tsx`; the converter now
  stops the chain with a guard index at that base and renders the nearest
  `not-found` (nothing when the app declares none, the same blank 404 Next.js
  paints without a `not-found.tsx`). The root answers `/` under the same rule,
  and route groups are not guarded - they own no URL.
- A missing route parameter whose name is also an `Object.prototype` member
  (`constructor`, `toString`, `valueOf`) no longer resolves to the inherited
  function and gets it encoded into the path; the parameter bag is now a
  null-prototype object, so an absent value reads as absent and is reported like
  any other missing parameter.
- A required catch-all no longer swallows its own base URL. `[...slug]` used to
  match `/blog` with an empty splat; the folder now gets a guard index route that
  renders the nearest `not-found`, and a `not-found.tsx` beside the catch-all folder
  is accepted as that fallback, the way Next.js answers it. A root-level required
  catch-all coexisting with a root page is now reported as the collision it is,
  since both would answer `/`.

### Tests

- The compatibility matrix now *renders* the fixture app for every React / Router /
  Vite combination instead of only bundling it (`test/compat-app`, streamed through
  `renderToPipeableStream`), and `test/test-compatibility.js` pins the matrix
  versions against the published peer ranges, the `engines.node` floor against every
  runtime dependency's own, and the CLI's install commands.
- A `react-router-only` CI job builds and renders the same fixture with no
  `react-router-dom` installed, so the substitution is proven by a render instead of
  by a sentence in the README.
- Router detection is pinned on every branch: shim present, `react-router` 7 alone,
  `react-router` 6 alone, nothing installed, an explicit `root`, a relative `root`,
  and the no-`root` fallback - the last from a child process whose working
  directory is a react-router-only project, because the suite's own cwd cannot tell
  a fallback from an explicit value.
- Layout record shapes: loaders, eager modules, unwrapped components, classes, mixed
  records, the ambiguous refusal, and a lying declaration reaching React.
- Declaration authorship: a marked legacy copy is removed, a foreign one survives,
  and an application-owned `routes.d.ts` is refused with exactly one warning.
- The catch-all base fallback, the guard index route shape, the new collision rule,
  the `configure` command, and the `create` guards.
- Case variants of every emitted route: the `caseSensitive: true` stamp on each
  path-bearing route and its absence on index routes, mixed-case misses against an
  exact-case match, `caseSensitive: false` restoring React Router's behavior at
  both the converter and the generator, the plugin option reaching the generated
  `treeToRoutes` call, and the refusal of a non-boolean option value.
- Page-less folder bases: the guard index shape, the not-found it renders, the
  root's `/`, a guarded chain under a layout, and the interaction with required
  and optional catch-alls.
- Parameters named after `Object.prototype` keys, missing and supplied.
- `loading.tsx` / `error.tsx`: the converter's boundary placement (folder index,
  a child page and a child layout guarded by the parent but not by their own,
  content inside a layout below it, route groups), a static render that proves
  `loading.tsx` replaces the configured fallback while an undeclared folder keeps
  it, the `RouteErrorBoundary` lifecycle (derive, reset-on-navigation, render),
  duplicate loading detection, and the refusal of a lazy or default-export-less
  boundary file. A no-boundaries tree is asserted byte-identical to before.
- Boundary depth regressions: an error two levels below a folder's `error.tsx`
  (`dx/error.tsx` guarding `dx/y/z/page.tsx`, no `layout.tsx` between) sits
  inside the folder's boundary, a route group's own `loading.tsx` / `error.tsx`
  guards every page beneath the group, a root `error.tsx` renders inside the
  root layout instead of above it, a folder's placeholder still paints for a
  page several levels below (`LOADING-DX` through `dx/y/z`), a nested
  `loading.tsx` overrides its ancestor's (`LOADING-OWN` over `LOADING-PARENT`),
  and a `not-found` renders inside the boundary without being treated as an
  error.
- A full-tree integration block builds one tree that combines every scenario
  from the bug report - root layout + root `error.tsx`, `dx/error.tsx` guarding
  a page two levels below, a route group carrying its own `loading.tsx` /
  `error.tsx`, a root `not-found` - and asserts both the nested shape (once,
  walking the whole emitted `RouteObject[]`) and the rendered HTML at `/dx/y/z`,
  `/sec/gpage`, `/home` and an unmatched URL, so a future regression that
  renders the boundary chain wrong cannot slip through a one-level test.

### Documentation

- README: the two supported router installs and what happens on a shim-free one;
  the `layoutShape` table with the misdeclaration nothing can catch;
  `next-vite-router configure` and its flags; where `routes.d.ts` is written, why it
  stays ignored, and the authorship marker; how catch-all folders and `not-found`
  answer a base path; folders that hold no page; a `Case sensitivity` section with
  the plugin and generator switches; and a `Loading and error boundaries` section
  covering the two conventions, the `layout > error > loading` order and what it
  does not catch, and the eager-import rationale.
- README `Loading and error boundaries`: the boundary's scope is spelled out as
  every descendant at any depth (not just the folder's direct children), with
  the `dx/error.tsx` / `dx/y/z/page.tsx` example that motivated the fix, and
  a new paragraph states that a route group carries its own `loading.tsx` /
  `error.tsx` and still hits the `Duplicate route "/"` check beside a root
  `error.tsx`.

## [3.0.0] - 2026-10-24

### Removed (breaking)

- The navigation helpers are no longer exported from the `next-vite-router`
  package root. `href`, `Link`, `useParams`, and `useCatchAll` (and the
  lower-level `createTypedLink` / `CatchAllParamProvider`) reach an application
  only through the module the Vite plugin generates. Import them from
  `next-vite-router/routes`:

  ```diff
  - import { href, Link, useParams, useCatchAll } from "next-vite-router";
  + import { href, Link, useParams, useCatchAll } from "next-vite-router/routes";
  ```

  The root still exports configuration and the route engine
  (`configureRouter`, `resetRouterConfig`, `createRouteGenerator`,
  `buildRouteTree`, `treeToRoutes`, the assert helpers, and the path/lazy utils).
- The `virtual:next-vite-router` specifier is retired: `next-vite-router/routes`
  is now the single import path for the generated module. `virtual:next-vite-router`
  no longer resolves and is no longer declared in the generated types.

  ```diff
  - import { Router } from "virtual:next-vite-router";
  + import { Router } from "next-vite-router/routes";
  ```

- The navigation engine moved to `src/plugin-runtime.ts`, a build entry kept
  out of the package `exports` map so application code cannot import it
  (`import "next-vite-router/plugin-runtime"` throws
  `ERR_PACKAGE_PATH_NOT_EXPORTED`). The generated module reaches it by resolved
  file path; this is an implementation detail, not an app-facing surface.

### Added

- Catch-all folder-name metadata and runtime key validation. The plugin
  generates a per-route map (`{ "/blog/*": { catchAll: { name: "slug", optional:
  false } } }`) from the same traversal that emits the route types and passes it
  to `href`/`Link`, so a catch-all is addressed only by its declared folder name
  (or React Router's `"*"`) and an unknown key throws instead of being silently
  routed onto the splat. A required `[...slug]` now reports a missing or empty
  value; an optional `[[...segments]]` still resolves to its base path. The
  public pattern stays `/blog/*`.
- `createTypedLink(metadataByPattern)`, a factory that binds the generated
  catch-all metadata into a `Link`, plus the `RouteCatchAllMetadata` /
  `RouteHrefMetadata` / `RouteLinkMetadata` types (engine surface, re-exported
  to apps through `next-vite-router/routes`).

### Changed

- `href` gained an optional third `metadata` argument. Passing it (as the
  generated module does) enables catch-all key validation; omitting it keeps the
  previous behavior, so this input widening is backward compatible.
- Raised `engines.node` to `>=20` (commander 14, the CLI's runtime dependency,
  requires it); the CLI build targets `node20`, and CI runs a Node 20/22 matrix.

### Tests

- Added a comprehensive route-invariant test matrix and Unicode
  encoding/decoding coverage for route parameters and catch-all segments.
- Added CLI smoke tests and an engine-requirement check.
- Updated the catch-all tests for the metadata contract (string and array value,
  missing required value, unknown key, `.`/`..` segments, the `"*"` alias, and
  the raw-`href` vs generated-`/routes` split).
- Assert the single `next-vite-router/routes` specifier: `resolveId` mapping, the
  generated declaration shape, the engine imported by resolved path, and that
  `virtual:next-vite-router` is no longer resolved or declared.

### Documentation

- Updated the README to a single import path (`next-vite-router/routes`),
  documented the metadata-bound catch-all validation, and noted that the package
  root exposes configuration and the route engine rather than the helpers.

## [2.1.1] - 2026-10-23

### Fixed

- `href` and `Link` now reject a route parameter whose value is exactly `.` or
  `..` instead of percent-encoding it, because no encoding stops a browser (or
  React Router) from resolving them as parent-directory segments; a value can no
  longer make a link escape its own path (`/users/..` becoming `/`).
- `href` drops empty segments from a catch-all value the way `useCatchAll()`
  does, so a leading or trailing slash (`"a/b/"`) or a blank array entry can no
  longer inject `//` into the path, and an empty value for a required `:name`
  param now throws instead of encoding away the segment and resolving to a
  different route (`/users/:id` becoming `/users/`).
- Corrected the published CLI `bin` path from `./dist/cli.cjs` to `dist/cli.cjs`.

### Tests

- Added coverage for empty-segment dropping and empty required-param rejection
  in `href`.
- Added coverage for rejecting `.` and `..` values in route parameters and
  catch-all segments.

### Documentation

- Updated the README quick-start to render `Router` directly in `main.tsx`
  instead of a separate `App` component, and documented the empty-segment and
  dot-segment behavior for `href`.

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
[2.1.1]: https://github.com/Rlzee/next-vite-router/compare/v2.1.0...v2.1.1
