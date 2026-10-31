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
| `next-vite-router` | `createRouteGenerator`, `buildRouteTree`, `treeToRoutes`, and the path/lazy utils | advanced / manual routing |
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

- `next-vite-router` needs one React Router install and declares both names as
  optional peers, because npm has no way to say "either of these": install
  `react-router-dom` (`>=6 <8`), or `react-router` alone from v7 up. In v7 the
  `react-router-dom` package is only a re-export shim, and its own README tells a
  migrated application to remove it. Optional peers are never installed on your
  behalf, so make sure one of the two is in your `package.json`.
- On a `react-router`-only install the plugin reads what the project actually
  resolved at config time and adds a `react-router-dom` → `react-router` alias, so
  the imports inside this package, the ones in the generated module, and the ones
  in your own files all land on the core package. Your code may keep importing
  from `react-router-dom` as every example here does, or switch to `react-router`;
  both reach the same modules. `react-router` v6 without the shim is the one
  combination this package cannot serve — v6 keeps `Link` in `react-router-dom` —
  and the plugin warns with both fixes instead of rewriting imports to components
  that do not exist.
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
| `not-found.tsx` | `*` route for that subtree, the fallback for a catch-all base path, and for a folder without a page |
| `loading.tsx` | Placeholder shown while that folder's page (or one below it) is not ready |
| `error.tsx` | Error boundary around that folder's content, rendered instead of a failed page |
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
auth guard is scoped to a subtree (see [Auth guards](#auth-guards)). A group is
still a folder for [`loading.tsx` and `error.tsx`](#loading-and-error-boundaries):
either file inside a group guards every page the group emits, at any depth
beneath it.

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
anywhere the guard falls back to the package's built-in 404 page, the same one
Next.js shows, so the base always paints a page instead of an empty outlet. Use
`[[...slug]]` when the base should render the page instead.

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

With no `not-found.tsx` anywhere, the package supplies its own default 404 page,
rendered eagerly with no stylesheet and nothing to load. It answers two kinds of
URL: a **base guard** — a folder that a URL matches but that owns no page (`/docs`
beside `docs/intro/page.tsx`, or a required catch-all's base) — and **any URL that
matches no route at all**, through a `*` route the converter appends at the root.
So `http://localhost:5173/any-garbage` paints the default 404 inside your root
layout, exactly as Next.js does, without you writing a file.

It is the bottom of the fallback chain (the folder's own `not-found`, else the
nearest ancestor's, else this default), so a single `not-found.tsx` replaces it
outright: a root `not-found.tsx` becomes that root `*` route, and the built-in is
not emitted beside it. The package owns it internally; it is not exported, and
there is no API to render or configure it — you replace it by adding a
`not-found.tsx`, not by importing it.

One consequence to know: because every URL now matches a route, `matchRoutes()`
never returns `null` for an unknown path — it returns the root `*` match. An SSR
server that wants to send an HTTP 404 status should test whether the matched leaf
is that splat (its `route.path === "*"`) rather than relying on a `null` result.

### Folders without a page are 404s

A folder that holds children but no `page.tsx` has no content at its own URL,
exactly as in Next.js: only the URLs that resolve to a page render one. With
`docs/intro/page.tsx` alone, `/docs/intro` renders the page and `/docs` is a
404; the same holds one level deeper (`docs/deep/leaf/page.tsx` makes
`/docs/deep` a 404) and for dynamic segments (`shop/[cat]/[item]/page.tsx`
makes `/shop` and `/shop/a` 404s).

React Router keeps a static parent as a valid *partial* match, which would paint
every layout down to that folder with an empty outlet. The converter therefore
adds a guard index at each such base: the match stops there and renders the
nearest `not-found.tsx` (that folder's own, else the one further up) inside the
layouts above it. A folder that has a `layout.tsx` and no page is guarded the
same way, and route groups are not — they own no URL, so their guard belongs to
the first URL-bearing folder around them.

With no `not-found.tsx` anywhere the guard falls back to the built-in 404 page
described above, so a page-less base paints that instead of an empty content
area. This is the same fallback the required catch-all base uses.

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

The Vite plugin generates `routes.d.ts` automatically, so no manual declaration
is required. Invalid paths and missing dynamic parameters are reported by
TypeScript.

```tsx
import type { RouteParams, RoutePath } from "next-vite-router/routes";

const path = "/users/:id" satisfies RoutePath;
const params: RouteParams<typeof path> = { id: "123" };
```

#### Where the file is written

The declaration is written **beside the pages directory**, that is one level
above `pagesDir`: with the default `src/app` it lands in `src/`, and with
`pagesDir: "app"` it lands in the project root. If `src/` does not exist yet
(a project that has not been built, or a misconfigured `pagesDir`), the plugin
creates it.

It is rewritten **every time the config is resolved** — on `vite dev`, on
`vite build`, and whenever a route file is added or removed in dev mode — so
running a build modifies your working tree. Keep it out of version control; the
CLI setup already appends it to `.gitignore`, and in a manually configured
project you should add it yourself:

```gitignore
routes.d.ts
```

The file is named after the module it declares, and the plugin never writes to a
`routes.d.ts` it did not generate: an application's own `src/routes.d.ts` is left
untouched and the refusal is reported instead, because silently replacing a
hand-written route table with a generated declaration is a loss nobody notices in
review. Move that file if you want the typed routes. (The placeholder trick works
the other way too: the bundled examples and fixtures keep a hand-written
`src/routes.placeholder.d.ts` under a **different** name, so the generated file can
stay ignored and still be overwritten freely.)

A project coming from the older generated name needs nothing from you: the build
that writes `routes.d.ts` also deletes a sibling
`virtual-next-vite-router.d.ts`, and only when the file carries this package's
`declare module 'next-vite-router/routes'` line. A leftover copy would declare the
same module twice, and TypeScript merges ambient module bodies — every alias
inside then reports `TS2300: Duplicate identifier`, or, under the `skipLibCheck`
the Vite templates enable, quietly keeps serving the stale route union.

Nothing is lost by ignoring it: the file is derived entirely from the folder
tree, so the next build recreates it byte for byte. Committing it only adds a
diff every time a route moves — and a plain `tsc --noEmit` in a fresh clone then
fails to find `next-vite-router/routes` until Vite has run once.

Route paths are listed in UTF-16 code-unit order, never by locale collation, so
the same folder tree yields the same declaration on every machine: no spurious
review diffs and no cache bust caused by the build host's locale.

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

Each nested layout then gets its own chunk, rendered behind a `Suspense` boundary;
its subtree renders through the layout's own `Outlet`, so a nested page is
requested only after the layout chunk arrives. While that chunk loads the folder's
placeholder paints — the `loading.tsx` of the nearest **ancestor** folder (a
layout is never covered by its own `loading.tsx`, which sits below it, exactly as
in Next.js), and nothing when no ancestor declares one.

The **root** layout is exempt: it is always loaded eagerly, whatever this option
says. The root route has no parent, so a lazy shell would suspend outside every
boundary and leave the whole application on an empty screen while its chunk
arrives. The plugin reads it with its own eager glob beside the lazy one; a hand-
built `{ layoutShape: "loader" }` record that hands over a root loader is refused
at build time. Turn `lazyLayouts` on for large or rarely visited nested shells.

### Case sensitivity

URLs match the case of the folder names, like Next.js: with `src/app/users/`,
`/users` renders the page and `/USERS` is a miss. Static and dynamic segments
are covered the same way — a mixed-case `/Users` does not claim the `users/`
folder — and so are catch-alls: with a `blog/[...slug]` folder, `/Blog/a` is a
miss, not a catch-all match whose base came in another case. The value a dynamic
segment captures keeps its own case: `/users/ABC` fills `[id]` with `"ABC"`.

This is deliberate. React Router leaves `caseSensitive` off its route objects,
which compiles every pattern to a case-**in**sensitive regexp, so a tree built
without the flag would answer `/USERS` from `users/`. The converter stamps
`caseSensitive: true` onto each path-bearing route instead; index and pathless
routes own no segment and are left alone.

`caseSensitive: false` on the plugin restores React Router's behavior:

```ts
// vite.config.ts
import { nextViteRouter } from "next-vite-router/plugin";

export default defineConfig({
  plugins: [react(), nextViteRouter({ caseSensitive: false })],
});
```

The manual `createRouteGenerator` takes the same switch as `{ caseSensitive:
false }` in its `options` argument. Only a boolean is accepted: the plugin
rejects `nextViteRouter({ caseSensitive: "false" })` at config time instead of
letting a truthy string decide the default. Typed navigation is not affected
either way: `href` and `Link` reuse your folder names verbatim, so the URLs they
produce match whatever case the router accepts.

### Loading and error boundaries

`loading.tsx` and `error.tsx` sit in a folder and wrap everything that folder
renders below its layout:

```text
src/app/shop/
├── layout.tsx      # renders first, outside the two below
├── error.tsx       # catches a render failure in the shop subtree
├── loading.tsx     # shown while the matched page has not arrived
└── page.tsx
```

`loading.tsx` is the folder's placeholder. Pages arrive through `React.lazy`, so
while one is loading the placeholder paints in the layout's `Outlet` — a nested
`loading.tsx` overrides its parent's, and a folder that declares none shows
**nothing** until its page arrives: there is no global fallback to configure, as
in Next.js, so the placeholder is a file in a folder or there is none. `error.tsx`
renders in
place of the content when something below throws, and receives
`{ error, reset }`; `reset()` clears the boundary's error state so React re-renders
the subtree - enough to recover from a synchronous failure whose cause has been
fixed, but not from a rejected dynamic import (see the stale-deploy note below).
The boundary also clears itself when the URL changes, so navigating to another
page of the same folder after a failure no longer shows the stale error.

Next.js stacks these as `layout > error > loading > not-found > page`, and this
package reproduces that order, which fixes two consequences:

- A folder's `error.tsx` catches its page **and every descendant at any depth**,
  but **not its own `layout.tsx`** — a layout's failure is reported by the parent
  folder's `error.tsx`, not its own. A boundary sits between the folder's layout
  and everything the folder emits at its own URL, so a page two levels below
  (`dx/y/z/page.tsx` under `dx/error.tsx`, with no `layout.tsx` in between)
  still lands inside `dx`'s error and loading instead of being caught by the
  nearest enclosing boundary. There is no `global-error.tsx` yet, so to guard
  the root layout wrap `<Router />` in a boundary of your own.
- `not-found.tsx` renders inside both boundaries, exactly as it does in Next.js.

A route group (`(name)`) is a folder like any other for these two files:
`(grp)/loading.tsx` and `(grp)/error.tsx` guard every page the group emits, at
any depth below it. Placing an `error.tsx` in a group that sits directly under
the pages root alongside the root's own `error.tsx` still reports the
`Duplicate route "/"` collision, the same rule that already applies to
`not-found.tsx`.

Both files are imported eagerly, like layouts: a placeholder fetched by chunk
would wait for a chunk to announce a chunk, and a boundary that has not loaded
cannot report the failure it exists for. A chunk that fails outright (a stale
deploy) surfaces through `error.tsx`, but `React.lazy` memoizes the rejection on
its own component and the router keeps that instance in its lazy cache, so
`reset()` re-renders against the same rejection and cannot re-fire the loader.
Reload the document (`window.location.reload()`) in that case, or evict the
router's cache explicitly with `clearLazyCache(cache)` on the same cache
instance the generator owns and re-mount the route tree.

A boundary only sees render errors: nothing thrown from an event handler or a
bare `async` callback reaches it, and `loading.tsx` is meaningful for chunk
loading and Suspense-aware reads (`use()`), because this package ships no data
loaders.

Rename the conventions like the other file options, and `createRouteGenerator`
takes the matching eager records as its trailing `loadings` / `errors` arguments:

```ts
// vite.config.ts
nextViteRouter({ loadingFile: "skeleton.tsx", errorFile: "failure.tsx" });
```

### No global loading fallback

There is no `configureRouter`, no `loadingFallback`, and no `enableLazyLoading`
switch: nothing about loading is configured in code. To show a placeholder while a
folder's page loads, put a `loading.tsx` in that folder (see [Loading and error
boundaries](#loading-and-error-boundaries)). A folder without one renders nothing
while its page is not ready, exactly like Next.js, and the root layout is always
loaded eagerly so the shell never leaves the screen blank.

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

To wire up a project that already exists:

```bash
npx next-vite-router configure            # in the project directory
npx next-vite-router configure --dir ../my-app --no-src --yes
```

`configure` adds the plugin and the `@` alias to `vite.config.ts`, writes the
`@` paths and `include` into `tsconfig.json` / `tsconfig.app.json`, points
`index.html` at the generated entry, and creates `main.tsx`, `globals.css`, the
`app/` example tree, and the placeholder route declaration. It takes no input
from a terminal, so it runs in CI:

| Option | Effect |
| --- | --- |
| `--dir <path>` | Project directory to configure (default: the current directory) |
| `--no-src` | Pages live in a root-level `app/` folder; implies `pagesDir: "app"` |
| `--tailwind` | Installs and wires `@tailwindcss/vite` — the only step that runs your package manager |
| `--yes` | Accepts that an existing `main.tsx` is replaced |

What it promises: it never deletes anything (template files it leaves behind are
listed so you can remove them yourself), it refuses a directory without a Vite
config, it refuses to replace an existing `main.tsx` without `--yes`, and it is
idempotent — a second run reports that `vite.config` already calls
`nextViteRouter` instead of adding a duplicate. Because those options are yours
to keep, switching between `src/app` and a root-level `app/` after the first run
means editing `pagesDir` by hand.

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
produces them. Their last argument declares the shape of the **layouts** record,
because a component, a loader, and a module namespace are indistinguishable as
plain values and the router does not call one to find out which it is:

| `layoutShape` | Glob that produced the record | How an entry is read |
| --- | --- | --- |
| `"module"` (default) | `import.meta.glob(layouts, { eager: true })` | a module namespace; its `default` is the layout |
| `"component"` | the same plus `import: "default"` | the component or class itself; a module is still accepted |
| `"loader"` | a non-eager `import.meta.glob(layouts)` | `() => import("...")`, code-split like a page; module entries stay eager |

A bare function in a record left at the default shape is **refused at build
time**, with the file named and both declarations offered: that value is exactly
what a non-eager glob produces, so accepting it silently would be guessing.
Nothing is sniffed to soften that rule — not the value's source, not its
`prototype`, so even a class layout, which no `() => import(...)` loader can be,
is refused until the record says so. The plugin always emits the declaration that
matches the glob it generated — `{ layoutShape: "loader" }` next to a non-eager
layout glob — so a project built by the plugin never meets the error.

What no declaration can catch is a wrong one: loaders passed as `"component"`
reach React, which rejects the Promise they return
(`Objects are not valid as a React child`). The runtime cannot check that without
invoking the value, and neither can TypeScript: an eager `import.meta.glob` is
typed `Record<string, unknown>` whatever the files export, so a signature
discriminated on `layoutShape` would refuse the honest `"component"` record too
and push people into the `as any` cast that hides the lying one. Declare it
truthfully, or let the plugin write the record for you.

A layout is used exactly as resolved — an eager module yields its `default`, a
bare function yields itself — so the component keeps its identity across route
regeneration instead of being wrapped in a freshly created type.

`createRouteGenerator(pages, layouts, notFounds, fileOptions, options)` returns a
zero-argument `generateRoutes()`; use it when you drive the globs yourself instead
of the Vite plugin. Its `options` also carries `caseSensitive` — the same switch
as the plugin's, see [Case sensitivity](#case-sensitivity). Pass eager `loading.tsx`
and `error.tsx` records as the trailing `loadings` / `errors` arguments to wire
those conventions by hand.

`buildRouteTree` accepts the same records either way: the positional
`buildRouteTree(pages, layouts, notFounds, fileOptions, options)` it has always
taken, or a single named bag
`buildRouteTree({ pages, layouts, notFounds, loadings, errors, fileOptions }, options)`
— the only way to reach the loading and error records. The generated module uses
the bag form.

## Compatibility

| Package | Supported versions |
| --- | --- |
| React / React DOM | `>=18 <20` |
| React Router (`react-router-dom`) | `>=6 <8` |
| React Router (`react-router`, installed alone) | `>=7 <8` |
| Vite | `>=5 <9` |
| Node | `>=20` |

The compatibility workflow tests React 18 and 19 with React Router 6 and 7 across
Vite 5, 6, 7, and 8, and runs the unit tests on Node 20, 22, and 24. Each
combination installs the published tarball into the app under
[`test/compat-app`](./test/compat-app), builds it for the browser and for the
server, then renders its route tree through `renderToPipeableStream`, so a
combination has to paint layouts, dynamic and catch-all parameters, `not-found`
and the generated `href`/`Link` — not merely compile. One further job runs the
same app with `react-router` v7 and **no** `react-router-dom` at all, so the
substitution is proven by a render instead of by this table.

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
