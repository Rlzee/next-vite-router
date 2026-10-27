import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { matchRoutes, MemoryRouter } from "react-router-dom";
import {
  buildRouteTree,
  assertNoDuplicateRoutes,
  configureRouter,
  createLazyCache,
  createLazyElement,
  createRouteGenerator,
  clearLazyCache,
  resetRouterConfig,
  treeToRoutes,
} from "../dist/index.js";
import { extractRoutePath, parseRouteSegments } from "../dist/index.js";
// The navigation engine is not on the public root entry; the generated routes
// module re-exports these, and tests import them from the internal build entry
// that the generated module itself resolves by path.
import {
  CatchAllParamProvider,
  createTypedLink,
  href,
  Link,
} from "../dist/plugin-runtime.js";

const loader = (name) => async () => ({ default: name });
const component = (name) => function Component() {
  return React.createElement("div", null, name);
};

function createRoutes({ pages = {}, layouts = {}, notFounds = {}, rootLayout } = {}) {
  const tree = buildRouteTree(pages, layouts, notFounds);
  if (rootLayout) tree.layout = rootLayout;
  return treeToRoutes(tree, true);
}

function routeShape(routes) {
  return routes.map(({ path, index, children }) => {
    const shape = {};
    if (path !== undefined) shape.path = path;
    if (index !== undefined) shape.index = index;
    shape.children = children ? routeShape(children) : undefined;
    return shape;
  });
}

/**
 * Replace every node's `children` map with a getter that counts how often the
 * subtree is enumerated, so traversal cost can be asserted without timing.
 *
 * @param {object} root - The route tree returned by `buildRouteTree`.
 * @returns {Map<object, number>} Visits per node, keyed by the node itself.
 */
function instrumentChildrenReads(root) {
  const reads = new Map();
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.pop();
    const children = node.children;
    reads.set(node, 0);
    Object.defineProperty(node, "children", {
      configurable: true,
      get() {
        reads.set(node, reads.get(node) + 1);
        return children;
      },
    });
    queue.push(...children.values());
  }

  return reads;
}

beforeEach(() => {
  // Reset the module-level router configuration singleton so state cannot leak
  // between tests. The lazy component cache no longer needs resetting: every
  // treeToRoutes() call (and every generator) owns its own cache, so a shared
  // route key can no longer reuse a stale React.lazy component.
  resetRouterConfig();
});

describe("route generator", () => {
  test("generates the root page without a layout", () => {
    const routes = createRoutes({
      pages: { "page.tsx": loader("home") },
    });

    assert.deepEqual(routeShape(routes), [{ path: "/", children: undefined }]);
  });

  test("renders a page with child routes as an index route", () => {
    const routes = createRoutes({
      pages: {
        "users/page.tsx": loader("list"),
        "users/[id]/page.tsx": loader("detail"),
      },
    });

    assert.equal(routes[0].element, undefined);
    assert.equal(routes[0].children[0].index, true);
    assert.notEqual(routes[0].children[0].element, undefined);
    assert.equal(routes[0].children[1].path, ":id");
    assert.notEqual(routes[0].children[1].element, undefined);
  });

  test("resolves multiple dynamic parameters and exposes their values", () => {
    const routes = createRoutes({
      pages: {
        "compare/[from]/[to]/page.tsx": loader("compare"),
      },
    });

    const matches = matchRoutes(routes, "/compare/paris/berlin");
    assert.deepEqual(matches?.at(-1)?.params, {
      from: "paris",
      to: "berlin",
    });
    assert.equal(matches?.at(-1)?.route.path, ":to");
  });

  test("generates a root required catch-all as a guard plus a splat", () => {
    // `src/app/[...slug]/page.tsx` makes the whole app one catch-all. React
    // Router's "*" also matches the site root, so the converter keeps the
    // Next.js contract with a guard index at "/": the splat page answers URLs
    // with at least one segment, the base falls back to the nearest not-found.
    const routes = createRoutes({
      pages: { "[...slug]/page.tsx": loader("req") },
    });

    assert.deepEqual(routeShape(routes), [
      { index: true, children: undefined },
      { path: "*", children: undefined },
    ]);
    assert.deepEqual(matchRoutes(routes, "/")?.at(-1)?.params, {});
    assert.equal(matchRoutes(routes, "/")?.at(-1)?.route.index, true);
    assert.deepEqual(matchRoutes(routes, "/a/b")?.at(-1)?.params, { "*": "a/b" });
  });

  test("generates a root optional catch-all that matches the base path", () => {
    // `src/app/[[...segments]]/page.tsx` yields an index route for "/" plus the
    // splat for everything below it, mirroring the nested optional catch-all.
    const routes = createRoutes({
      pages: { "[[...segments]]/page.tsx": loader("opt") },
    });

    assert.deepEqual(routeShape(routes), [
      { index: true, children: undefined },
      { path: "*", children: undefined },
    ]);

    const base = matchRoutes(routes, "/");
    assert.equal(base?.at(-1)?.route.index, true);
    assert.deepEqual(base?.at(-1)?.params, {});
    assert.deepEqual(matchRoutes(routes, "/a/b")?.at(-1)?.params, { "*": "a/b" });
  });

  test("keeps root pages and child routes as sibling matches", () => {
    const routes = createRoutes({
      pages: {
        "page.tsx": loader("home"),
        "about/page.tsx": loader("about"),
      },
    });

    assert.equal(routes[0].path, "/");
    assert.equal(routes[0].element, undefined);
    assert.equal(routes[0].children[0].index, true);
    assert.equal(routes[0].children[1].path, "about");
  });

  test("generates static, dynamic, multi-parameter, and catch-all routes", () => {
    const routes = createRoutes({
      pages: {
        "about/page.tsx": loader("about"),
        "users/[id]/page.tsx": loader("user"),
        "compare/[from]/[to]/page.tsx": loader("compare"),
        "blog/[...slug]/page.tsx": loader("blog"),
        "docs/[[...segments]]/page.tsx": loader("docs"),
      },
    });

    assert.deepEqual(routeShape(routes), [
      { path: "about", children: undefined },
      { path: "blog", children: [
        { index: true, children: undefined },
        { path: "*", children: undefined },
      ] },
      { path: "compare", children: [
        { path: ":from", children: [
          { path: ":to", children: undefined },
          // `compare/[from]` holds no page, so its base is guarded: `/compare/x`
          // answers with the nearest not-found instead of an empty outlet.
          { index: true, children: undefined },
        ] },
        // `compare` itself has no page either: `/compare` is guarded too.
        { index: true, children: undefined },
      ] },
      { path: "docs", children: [
        { index: true, children: undefined },
        { path: "*", children: undefined },
      ] },
      { path: "users", children: [
        { path: ":id", children: undefined },
        { index: true, children: undefined },
      ] },
      // No root page: "/" is guarded the same way.
      { index: true, children: undefined },
    ]);
    // Required and optional catch-alls expose the same shape at their level;
    // the difference is what the base index renders (guard vs. the page).
    assert.deepEqual(matchRoutes(routes, "/blog")?.at(-1)?.route.index, true);
    assert.deepEqual(matchRoutes(routes, "/docs")?.at(-1)?.params, {});
  });

  test("removes route groups while preserving their children", () => {
    const routes = createRoutes({
      pages: {
        "(admin)/dashboard/page.tsx": loader("dashboard"),
      },
    });

    assert.deepEqual(routeShape(routes), [
      { path: "dashboard", children: undefined },
      // The group is dropped from the URL and the page keeps its own path; the
      // trailing index is the root's base guard - no `page.tsx` answers "/",
      // so Next.js 404s it.
      { index: true, children: undefined },
    ]);
    assert.equal(matchRoutes(routes, "/dashboard")?.at(-1)?.route.path, "dashboard");
  });

  test("matches grouped routes without exposing the group in the URL", () => {
    const routes = createRoutes({
      pages: {
        "(admin)/dashboard/page.tsx": loader("dashboard"),
      },
    });

    const matches = matchRoutes(routes, "/dashboard");
    assert.equal(matches?.at(-1)?.route.path, "dashboard");
    assert.equal(matchRoutes(routes, "/admin/dashboard"), null);
  });

  test("rejects duplicate routes created by route groups", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "(a)/x/page.tsx",
        "(b)/x/page.tsx",
        "(c)/y/page.tsx",
        "(d)/y/page.tsx",
      ]),
      {
        message: [
          'Duplicate route "/x" detected:',
          "  (a)/x/page.tsx",
          "  (b)/x/page.tsx",
          "",
          'Duplicate route "/y" detected:',
          "  (c)/y/page.tsx",
          "  (d)/y/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("lists colliding files by code unit, not by locale collation", () => {
    // A locale-aware comparison folds cases together (and puts the lowercase
    // form first), with rules that depend on the ICU build of the running
    // process. Code-unit order is identical on every machine, so the same
    // collision is always reported the same way.
    assert.throws(
      () => assertNoDuplicateRoutes([
        "(b)/x/page.tsx",
        "(A)/x/page.tsx",
        "(a)/x/page.tsx",
        "(B)/x/page.tsx",
      ]),
      {
        message: [
          'Duplicate route "/x" detected:',
          "  (A)/x/page.tsx",
          "  (B)/x/page.tsx",
          "  (a)/x/page.tsx",
          "  (b)/x/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("rejects dynamic collisions across groups omitted from the URL", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "(app)/(admin)/users/[id]/page.tsx",
        "(app)/(marketing)/users/[slug]/page.tsx",
      ]),
      {
        message: [
          'Ambiguous route pattern "/users/:param" detected:',
          "  (app)/(admin)/users/[id]/page.tsx",
          "  (app)/(marketing)/users/[slug]/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("rejects dynamic routes with different parameter names", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "users/[id]/page.tsx",
        "users/[slug]/page.tsx",
      ]),
      {
        message: [
          'Ambiguous route pattern "/users/:param" detected:',
          "  users/[id]/page.tsx",
          "  users/[slug]/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("rejects optional catch-all routes that collide with their base route", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "docs/page.tsx",
        "docs/[[...segments]]/page.tsx",
      ]),
      {
        message: [
          'Duplicate route "/docs" detected:',
          "  docs/[[...segments]]/page.tsx",
          "  docs/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("rejects required and optional catch-all routes with the same prefix", () => {
    assert.throws(
      () => assertNoDuplicateRoutes([
        "docs/[...segments]/page.tsx",
        "docs/[[...rest]]/page.tsx",
      ]),
      {
        message: [
          'Ambiguous route pattern "/docs/*" detected:',
          "  docs/[...segments]/page.tsx",
          "  docs/[[...rest]]/page.tsx",
        ].join("\n"),
      },
    );
  });

  test("allows a required or optional catch-all as the final segment", () => {
    assert.doesNotThrow(() => parseRouteSegments("docs/[...slug]"));
    assert.doesNotThrow(() => parseRouteSegments("docs/[[...slug]]"));
  });

  test("rejects a segment after a required catch-all", () => {
    assert.throws(
      () => parseRouteSegments("docs/[...slug]/edit"),
      /catch-all segment "\[\.\.\.slug\]" must be the last segment/,
    );
  });

  test("rejects a segment after an optional catch-all", () => {
    assert.throws(
      () => parseRouteSegments("docs/[[...slug]]/edit"),
      /catch-all segment "\[\[\.\.\.slug\]\]" must be the last segment/,
    );
  });

  test("rejects a route group placed after a catch-all", () => {
    assert.throws(
      () => parseRouteSegments("docs/[...slug]/(marketing)"),
      /The "\(marketing\)" segment that follows it can never match/,
    );
  });

  test("rejects a misplaced catch-all when building routes", () => {
    assert.throws(
      () => createRoutes({
        pages: { "docs/[...slug]/edit/page.tsx": loader("edit") },
      }),
      /catch-all segment "\[\.\.\.slug\]" must be the last segment/,
    );
    assert.throws(
      () => createRoutes({
        pages: { "docs/[[...slug]]/edit/page.tsx": loader("edit") },
      }),
      /catch-all segment "\[\[\.\.\.slug\]\]" must be the last segment/,
    );
  });

  test("names the faulty file when a catch-all is misplaced", () => {
    assert.throws(
      () => assertNoDuplicateRoutes(["src/app/docs/[...slug]/edit/page.tsx"]),
      /Invalid route "src\/app\/docs\/\[\.\.\.slug\]\/edit\/page\.tsx"/,
    );
  });

  test("uses a folder not-found as the fallback of its catch-all base", () => {
    // `docs/not-found.tsx` claims "/docs" while `docs/[...slug]/page.tsx`
    // only answers URLs below it, so the two no longer collide: the guard
    // index at the base renders that not-found, Next.js-style.
    const routes = createRoutes({
      pages: { "docs/[...slug]/page.tsx": loader("docs") },
      notFounds: { "docs/not-found.tsx": loader("docs-not-found") },
    });

    assert.deepEqual(routeShape(routes), [
      { path: "docs", children: [
        { index: true, children: undefined },
        { path: "*", children: undefined },
      ] },
      // The root has no page: "/" is guarded like any other page-less folder.
      { index: true, children: undefined },
    ]);
    const base = matchRoutes(routes, "/docs");
    assert.equal(base?.at(-1)?.route.index, true);
    assert.equal(matchRoutes(routes, "/docs/guide")?.at(-1)?.route.path, "*");
    // The guard index is the base answer and the page splat the region below:
    // the folder's own not-found never becomes a competing `*` sibling here.
    const [guard, pageRoute] = routes[0].children;
    assert.equal(guard.index, true);
    assert.equal(pageRoute.path, "*");
    assert.equal(pageRoute.children, undefined);
    // The folder's not-found is handed to the guard as its lazy fallback...
    assert.notEqual(guard.element.props.fallback, undefined);
    // ...while a catch-all with no not-found anywhere guards to nothing.
    const bare = createRoutes({ pages: { "docs/[...slug]/page.tsx": loader("docs") } });
    assert.equal(bare[0].children[0].element.props.fallback, undefined);
  });

  test("rejects not-found routes that conflict with catch-all pages", () => {
    assert.throws(
      () => buildRouteTree(
        {
          "docs/[...slug]/page.tsx": loader("docs"),
        },
        {},
        {
          "docs/[...slug]/not-found.tsx": loader("docs-not-found"),
        },
      ),
      {
        message: [
          'Conflicting fallback routes "/docs/*" detected:',
          "  catch-all page: docs/[...slug]/page.tsx",
          "  not-found file: docs/[...slug]/not-found.tsx",
          'A not-found route and a catch-all page cannot claim the same splat. Move the not-found to the folder holding the catch-all (e.g. "blog/not-found.tsx" beside "blog/[...slug]/page.tsx"), where it answers the catch-all\'s base URL.',
        ].join("\n"),
      },
    );
  });

  test("rejects a root page beside a root-level required catch-all", () => {
    // Both would answer "/": the root page as an index, the catch-all's guard
    // as another one. Next.js refuses the same combination.
    assert.throws(
      () => buildRouteTree(
        {
          "page.tsx": loader("home"),
          "[...slug]/page.tsx": loader("everything"),
        },
        {},
        {},
      ),
      /Conflicting routes "\/" detected:[\s\S]*cannot both answer/,
    );
    // A root-level catch-all alone is fine; only a second claimant of "/" is.
    assert.doesNotThrow(() => buildRouteTree(
      { "[...slug]/page.tsx": loader("everything") },
      {},
      {},
    ));
  });

  test("rejects not-found files placed at a catch-all level", () => {
    assert.throws(
      () => buildRouteTree(
        {
          "docs/[[...slug]]/page.tsx": loader("docs"),
        },
        {},
        {
          "docs/[[...slug]]/not-found.tsx": loader("docs-not-found"),
        },
      ),
      /Conflicting fallback routes "\/docs\/\*" detected/,
    );
  });

  test("rejects not-found fallbacks alongside optional catch-all pages", () => {
    assert.throws(
      () => buildRouteTree(
        {
          "docs/[[...slug]]/page.tsx": loader("docs"),
        },
        {
          "docs/layout.tsx": { default: component("docs-layout") },
        },
        {
          "docs/not-found.tsx": loader("docs-not-found"),
        },
      ),
      /Conflicting fallback routes "\/docs" detected/,
    );
  });

    test("keeps pages and layouts declared directly in route groups", () => {
      const groupLayout = component("marketing");
      const routes = createRoutes({
        pages: {
          "(marketing)/page.tsx": loader("marketing"),
          "(marketing)/about/page.tsx": loader("about"),
        },
        layouts: {
          "(marketing)/layout.tsx": { default: groupLayout },
        },
      });

      assert.deepEqual(routeShape(routes), [{
        children: [
          { index: true, children: undefined },
          { path: "about", children: undefined },
        ],
      }]);
      assert.equal(routes[0].element.type, groupLayout);
    });

    test("generates not-found routes without requiring a layout", () => {
      const routes = createRoutes({
        pages: { "dashboard/page.tsx": loader("dashboard") },
        notFounds: {
          "dashboard/not-found.tsx": loader("dashboard-not-found"),
          "not-found.tsx": loader("root-not-found"),
        },
      });

      assert.deepEqual(routeShape(routes), [{
        path: "/", children: [
          { path: "dashboard", children: [
            { index: true, children: undefined },
            { path: "*", children: undefined },
          ] },
          { path: "*", children: undefined },
          // No root page: the guard index answers "/" with the root not-found.
          { index: true, children: undefined },
        ],
      }]);
    });

    test("extracts paths using configured file names and directories", () => {
      assert.equal(
        extractRoutePath("C:\\project\\pages\\about\\page.jsx", {
          pagesDir: "C:\\project\\pages",
          pageFile: "page.jsx",
        }),
        "about",
      );
      assert.equal(
        extractRoutePath(
          "C:\\project\\src\\app.v2\\my pages\\about\\page.tsx",
          { pagesDir: "C:\\project\\src\\app.v2" },
        ),
        "my pages/about",
      );
      assert.equal(
        extractRoutePath(
          "C:\\project\\src\\appXv2\\about\\page.tsx",
          { pagesDir: "C:\\project\\src\\app.v2" },
        ),
        "C:/project/src/appXv2/about",
      );
    });

    test("strips the pages directory only once at the root", () => {
      // A nested folder named like pagesDir must survive the prefix strip.
      assert.equal(
        extractRoutePath("/app/docs/app/page.tsx", { pagesDir: "app" }),
        "docs/app",
      );
      assert.equal(extractRoutePath("/app/page.tsx", { pagesDir: "app" }), "");
      assert.equal(
        extractRoutePath("/src/app/docs/app/page.tsx", { pagesDir: "src/app" }),
        "docs/app",
      );
    });

    test("strips only the first app/pages root marker without pagesDir", () => {
      assert.equal(
        extractRoutePath("../../pages/docs/pages/page.tsx"),
        "docs/pages",
      );
      assert.equal(extractRoutePath("app/blog/app/page.tsx"), "blog/app");
    });

    test("normalizes relative pagesDir spellings", () => {
      // `./`, leading `/`, trailing `/`, and Windows separators must all resolve
      // to the same root-relative base and match Vite glob keys.
      const key = "/src/app/docs/app/page.tsx";
      for (const pagesDir of ["src/app", "./src/app", "/src/app", "src/app/", "src\\app", ".\\src\\app"]) {
        assert.equal(extractRoutePath(key, { pagesDir }), "docs/app", pagesDir);
        assert.equal(extractRoutePath("/src/app/page.tsx", { pagesDir }), "", pagesDir);
      }
    });

    test("does not treat a route as a duplicate when a folder matches pagesDir", () => {
      // Runtime glob keys and generated types must agree on /docs/app.
      assert.doesNotThrow(() =>
        buildRouteTree(
          {
            "/app/page.tsx": loader("home"),
            "/app/docs/app/page.tsx": loader("docs-app"),
          },
          {},
          {},
          { pagesDir: "app" },
        ),
      );
    });

  test("supports nested layouts, layout-only nodes, and not-found routes", () => {
    const rootLayout = component("root");
    const adminLayout = component("admin");
    const routes = createRoutes({
      rootLayout,
      pages: {
        "dashboard/page.tsx": loader("dashboard"),
      },
      layouts: {
        "dashboard/layout.tsx": { default: adminLayout },
      },
      notFounds: {
        "not-found.tsx": loader("root-not-found"),
        "dashboard/not-found.tsx": loader("admin-not-found"),
      },
    });

    assert.deepEqual(routeShape(routes), [{
      path: "/",
      children: [
        { path: "dashboard", children: [
          { index: true, children: undefined },
          { path: "*", children: undefined },
        ] },
        { path: "*", children: undefined },
        // The root holds no page: "/" answers with the root not-found.
        { index: true, children: undefined },
      ],
    }]);
    assert.equal(routes[0].element.type, rootLayout);
    assert.equal(
      routes[0].children[0].children[0].element.type,
      React.Suspense,
    );

    const dashboardMissing = matchRoutes(routes, "/dashboard/missing");
    assert.deepEqual(
      dashboardMissing?.map(({ route }) => route.path ?? route.index),
      ["/", "dashboard", "*"],
    );
    assert.equal(matchRoutes(routes, "/unknown")?.at(-1)?.route.path, "*");
  });

  test("walks every node of a nested layout subtree exactly once", () => {
    // Layout levels used to enumerate their own subtree twice: once for the
    // eager `descendants` list that the layout branch discarded, and once
    // through `createNodeChildren`. That made generation cost grow as 2^depth.
    const depth = 12;
    const segments = [];
    const layouts = {};
    const pages = {};

    for (let level = 0; level < depth; level++) {
      segments.push(`l${level}`);
      const dir = segments.join("/");
      layouts[`${dir}/layout.tsx`] = { default: component(`l${level}`) };
      pages[`${dir}/page.tsx`] = loader(`l${level}`);
    }

    const tree = buildRouteTree(pages, layouts, {});
    const childrenReads = instrumentChildrenReads(tree);
    const routes = treeToRoutes(tree, true);

    // Root plus one node per layout level, each enumerated a single time.
    assert.equal(childrenReads.size, depth + 1);
    assert.deepEqual(
      [...childrenReads.values()],
      [...childrenReads.values()].map(() => 1),
    );

    // The generated tree is still complete: every layout matches, then the
    // deepest page as an index route.
    assert.deepEqual(
      matchRoutes(routes, `/${segments.join("/")}`)?.map(
        ({ route }) => route.path ?? route.index,
      ),
      [...segments, true],
    );
  });

  test("resolves catch-all pages under layouts", () => {
    const layout = component("docs-layout");
    const routes = createRoutes({
      layouts: {
        docs: { default: layout },
      },
      pages: {
        "docs/[...slug]/page.tsx": loader("docs"),
      },
    });

    const matches = matchRoutes(routes, "/docs/guide/api");
    assert.deepEqual(matches?.map(({ route }) => route.path ?? route.index), [
      "docs",
      "*",
    ]);
    assert.equal(matches?.at(-1)?.params["*"], "guide/api");
  });

  test("keeps only page entries supplied by the glob", () => {
    const routes = createRoutes({
      pages: {
        "valid/page.tsx": loader("valid"),
      },
    });

    assert.deepEqual(routeShape(routes), [
      { path: "valid", children: undefined },
      // The root has no page of its own, so "/" is guarded rather than left a
      // partial match; only `page.tsx` files carry pages.
      { index: true, children: undefined },
    ]);
  });

  test("handles Windows paths and paths containing spaces", () => {
    const tree = buildRouteTree(
      { "my pages\\[id]\\page.tsx": loader("page") },
      {},
      {},
    );

    assert.deepEqual(routeShape(treeToRoutes(tree, true)), [
      { path: "my pages", children: [
        { path: ":id", children: undefined },
        { index: true, children: undefined },
      ] },
      { index: true, children: undefined },
    ]);
  });

  test("rejects colliding dynamic parameter names when building routes", () => {
    assert.throws(() => createRoutes({
      pages: {
        "users/[id]/page.tsx": loader("id"),
        "users/[slug]/page.tsx": loader("slug"),
      },
    }), /Ambiguous route pattern "\/users\/:param" detected/);
  });

  test("orders routes consistently regardless of glob insertion order", () => {
    const routes = createRoutes({
      pages: {
        "zebra/page.tsx": loader("zebra"),
        "about/page.tsx": loader("about"),
        "alpha/page.tsx": loader("alpha"),
      },
    });

    // The trailing index is the root's base guard (no root page here); the
    // point of the test is the order of the URL-bearing routes.
    assert.deepEqual(routes.map((route) => route.path ?? "index"), [
      "about",
      "alpha",
      "zebra",
      "index",
    ]);
  });

  test("orders children by code unit so the route tree is reproducible", () => {
    // Children order is the order of the emitted `RouteObject[]`, so it has to
    // come out of a comparison the machine cannot influence: a locale collation
    // would put the lowercase "about" first and could reorder again under a
    // different ICU build, for the very same folder tree.
    const routes = createRoutes({
      pages: {
        "About/page.tsx": loader("upper"),
        "about/page.tsx": loader("lower"),
        "[id]/page.tsx": loader("id"),
      },
    });

    assert.deepEqual(routes.map((route) => route.path ?? "index"), [
      "About",
      ":id",
      "about",
      "index",
    ]);
  });

  test("creates lazy route elements behind a Suspense boundary", () => {
    const routes = createRoutes({
      pages: { "lazy/page.tsx": loader("lazy") },
    });
    assert.equal(routes[0].element.type, React.Suspense);
    assert.equal(typeof routes[0].element.props.fallback.type, "function");
    // Default fallback renders an empty div.
    assert.equal(
      renderToStaticMarkup(routes[0].element.props.fallback),
      "<div></div>",
    );
  });

  test("reads configureRouter at render time, after routes are generated", () => {
    // Reproduces the module-level `generateRoutes()` ordering: routes are built
    // before the app calls `configureRouter`, yet the fallback must apply.
    const routes = createRoutes({
      pages: { "late/page.tsx": loader("late") },
    });

    configureRouter({
      loadingFallback: () => React.createElement("p", null, "Loading…"),
    });
    assert.equal(
      renderToStaticMarkup(routes[0].element.props.fallback),
      "<p>Loading…</p>",
    );

    configureRouter({ enableLazyLoading: false });
    assert.equal(renderToStaticMarkup(routes[0].element.props.fallback), "");
  });
});

describe("lazy component cache", () => {
  // The lazy component is the single child rendered inside the Suspense
  // boundary that `createLazyElement` returns.
  const lazyOf = (element) => element.props.children.type;

  test("reuses the memoized component for the same key within one cache", () => {
    const cache = createLazyCache();
    const first = createLazyElement(loader("a"), "page:/x", cache);
    const second = createLazyElement(loader("b"), "page:/x", cache);

    // Same key hits the cache, so the second loader is ignored.
    assert.equal(lazyOf(first), lazyOf(second));
  });

  test("keeps components separate across independent caches", () => {
    const first = createLazyElement(loader("a"), "page:/x", createLazyCache());
    const second = createLazyElement(loader("b"), "page:/x", createLazyCache());

    assert.notEqual(lazyOf(first), lazyOf(second));
  });

  test("clearLazyCache(cache) forgets the components held by that cache", () => {
    const cache = createLazyCache();
    const before = lazyOf(createLazyElement(loader("a"), "page:/x", cache));

    clearLazyCache(cache);
    const after = lazyOf(createLazyElement(loader("a"), "page:/x", cache));

    assert.notEqual(before, after);
  });

  test("repeated calls to one generator reuse its components", () => {
    const generate = createRouteGenerator(
      { "page.tsx": loader("home") },
      {},
      {},
    );

    assert.equal(lazyOf(generate()[0].element), lazyOf(generate()[0].element));
  });

  test("independent generators use their own loaders for the same route", () => {
    const generateA = createRouteGenerator(
      { "users/page.tsx": loader("a") },
      {},
      {},
    );
    const generateB = createRouteGenerator(
      { "users/page.tsx": loader("b") },
      {},
      {},
    );

    // Both resolve the same `page:users` key, but per-generator caches keep the
    // components (and therefore the wrapped loaders) isolated.
    assert.notEqual(
      lazyOf(generateA()[0].element),
      lazyOf(generateB()[0].element),
    );
  });

  test("two treeToRoutes() calls without a cache stay isolated", () => {
    const tree = buildRouteTree({ "users/page.tsx": loader("users") }, {}, {});
    const first = treeToRoutes(tree, true);
    const second = treeToRoutes(tree, true);

    // Each call builds its own default cache, so the same route key yields a
    // fresh React.lazy component instead of reusing the earlier call's.
    assert.notEqual(lazyOf(first[0].element), lazyOf(second[0].element));
  });

  test("a generator ignores a loader swapped for an already-cached route", () => {
    const pages = { "users/page.tsx": loader("A") };
    const generate = createRouteGenerator(pages, {}, {});
    const first = lazyOf(generate()[0].element);

    // Replace the loader for the same key and regenerate on the SAME generator.
    pages["users/page.tsx"] = loader("B");
    const second = lazyOf(generate()[0].element);

    // The cache hit keeps the original memoized component; loader B is ignored.
    assert.equal(first, second);
  });

  test("a fresh generator resolves the swapped loader", () => {
    const pages = { "users/page.tsx": loader("A") };
    const generateV1 = createRouteGenerator(pages, {}, {});
    const oldComponent = lazyOf(generateV1()[0].element);

    pages["users/page.tsx"] = loader("B");
    const generateV2 = createRouteGenerator(pages, {}, {});
    const newComponent = lazyOf(generateV2()[0].element);

    // The documented workaround: a new generator owns a new cache, so the
    // changed source produces a component wrapping the current loader.
    assert.notEqual(oldComponent, newComponent);
  });
});

describe("lazy layouts", () => {
  // The lazy component is the single child rendered inside the Suspense
  // boundary that `createLazyElement` returns.
  const lazyOf = (element) => element.props.children.type;
  const componentLoader = (name) => async () => ({ default: component(name) });

  /**
   * Tree built from a non-eager layout glob: every layout entry is a loader, and
   * the record has to declare that shape. `{ layoutShape: "loader" }` is the only
   * way to declare it.
   */
  function createLazyLayoutRoutes({ pages, layouts }) {
    const tree = buildRouteTree(pages, layouts, {}, undefined, {
      layoutShape: "loader",
    });
    return { tree, routes: treeToRoutes(tree, true) };
  }

  test("reads a layout function as a loader only when the record declares it", async () => {
    const Shell = component("shell");
    const layouts = { "dashboard/layout.tsx": async () => ({ default: Shell }) };
    const pages = { "dashboard/page.tsx": componentLoader("dashboard") };

    // Without a declaration the value is ambiguous - an unwrapped eager component
    // and a non-eager loader are the same kind of value - so the build refuses it
    // instead of storing a guess. Nothing is called to find out.
    assert.throws(
      () => buildRouteTree(pages, layouts, {}),
      /is a bare function, which an eager and a non-eager glob produce alike/,
    );

    const lazy = buildRouteTree(pages, layouts, {}, undefined, { layoutShape: "loader" });
    assert.equal(lazy.children.get("dashboard").layout, undefined);
    assert.equal(typeof lazy.children.get("dashboard").lazyLayout, "function");
    assert.deepEqual(await lazy.children.get("dashboard").lazyLayout(), {
      default: Shell,
    });
  });

  test("suspends a lazy layout and paints it once its chunk resolves", async () => {
    const Shell = component("shell");
    configureRouter({
      loadingFallback: () => React.createElement("p", null, "Loading shell…"),
    });
    const { routes } = createLazyLayoutRoutes({
      pages: { "dashboard/page.tsx": componentLoader("dashboard") },
      layouts: { "dashboard/layout.tsx": componentLoader("shell") },
    });

    assert.deepEqual(routeShape(routes), [
      { path: "dashboard", children: [{ index: true, children: undefined }] },
      // No root page: the guard index answers "/".
      { index: true, children: undefined },
    ]);
    assert.equal(routes[0].element.type, React.Suspense);
    // The first paint starts the import and shows the fallback; once the module
    // promise settles, the boundary renders the layout itself, which proves the
    // loader is wired to the lazy component instead of a stand-in.
    assert.match(
      renderToStaticMarkup(routes[0].element),
      /<p>Loading shell…<\/p>/,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(renderToStaticMarkup(routes[0].element), /<div>shell<\/div>/);
  });

  test("suspends the root layout too", () => {
    const { routes } = createLazyLayoutRoutes({
      pages: { "page.tsx": componentLoader("home") },
      layouts: { "layout.tsx": componentLoader("shell") },
    });

    assert.equal(routes[0].path, "/");
    assert.equal(routes[0].element.type, React.Suspense);
  });

  test("keeps the catch-all provider around a lazy layout", () => {
    const { routes } = createLazyLayoutRoutes({
      pages: { "docs/[...slug]/page.tsx": componentLoader("docs") },
      layouts: { "docs/[...slug]/layout.tsx": componentLoader("docs-shell") },
    });

    // children: [base guard index, splat route carrying the lazy layout].
    const [guard, layoutRoute] = routes[0].children;
    assert.equal(guard.index, true);
    assert.equal(layoutRoute.path, "*");
    assert.equal(layoutRoute.element.type, CatchAllParamProvider);
    assert.equal(layoutRoute.element.props.name, "slug");
    assert.equal(layoutRoute.element.props.children.type, React.Suspense);
  });

  test("accepts an eager module next to a lazy loader", () => {
    const Shell = component("shell");
    const { routes } = createLazyLayoutRoutes({
      pages: {
        "dashboard/page.tsx": componentLoader("dashboard"),
        "reports/page.tsx": componentLoader("reports"),
      },
      layouts: {
        "dashboard/layout.tsx": { default: Shell },
        "reports/layout.tsx": componentLoader("reports-shell"),
      },
    });

    const byPath = new Map(routes.map((route) => [route.path, route]));
    assert.equal(byPath.get("dashboard").element.type, Shell);
    assert.equal(byPath.get("reports").element.type, React.Suspense);
  });

  test("reuses one lazy component per layout within a generator", () => {
    const generate = createRouteGenerator(
      { "dashboard/page.tsx": componentLoader("dashboard") },
      { "dashboard/layout.tsx": componentLoader("shell") },
      {},
      undefined,
      { layoutShape: "loader" },
    );

    assert.equal(lazyOf(generate()[0].element), lazyOf(generate()[0].element));
  });

  test("reports a lazy layout that resolves without a default export", async () => {
    const { tree, routes } = createLazyLayoutRoutes({
      pages: { "dashboard/page.tsx": componentLoader("dashboard") },
      layouts: { "dashboard/layout.tsx": async () => ({ metadata: "no default" }) },
    });

    // The route is still generated; the module only exists once its chunk
    // loads, so the check has to be deferred to the loader.
    assert.equal(routes[0].element.type, React.Suspense);
    await assert.rejects(
      () => tree.children.get("dashboard").lazyLayout(),
      {
        message: [
          'Route layout "dashboard/layout.tsx" does not default-export a React component.',
          "Add `export default` to the file, for example: `export default function Layout({ children }) { ... }`.",
        ].join("\n"),
      },
    );
  });

  test("refuses a bare-function layout the default record shape cannot name", () => {
    // A non-eager glob yields `() => import("...")` loaders, and an eager
    // `{ import: "default" }` glob yields a component that looks identical. Under
    // the default shape the value is ambiguous, so it is refused at build time
    // instead of reaching React, which fails later on `[object Promise]`.
    assert.throws(
      () => buildRouteTree(
        { "dashboard/page.tsx": componentLoader("dashboard") },
        { "dashboard/layout.tsx": async () => ({ default: component("shell") }) },
        {},
      ),
      {
        message: [
          'Route layout "dashboard/layout.tsx" is a bare function, which an eager and a non-eager glob produce alike, so the router will not assume which one it is.',
          "Declare the shape of the layouts record:",
          '  { layoutShape: "loader" }    entries are `() => import("...")` from a non-eager `import.meta.glob`',
          '  { layoutShape: "component" } entries are unwrapped components or classes from `{ eager: true, import: "default" }`',
          'Or keep the default `"module"` shape by leaving the glob eager without unwrapping: `import.meta.glob(layouts, { eager: true })`.',
        ].join("\n"),
      },
    );
  });

  test("reports an eager component layout declared as a loader", async () => {
    // `{ eager: true, import: "default" }` yields the component itself, which a
    // record declared as `"loader"` reads as `() => import("...")`. Resolving it
    // used to render an empty element in silence because a React element matched
    // `$$typeof`.
    const tree = buildRouteTree(
      { "dashboard/page.tsx": componentLoader("dashboard") },
      { "dashboard/layout.tsx": component("shell") },
      {},
      undefined,
      { layoutShape: "loader" },
    );

    await assert.rejects(
      () => tree.children.get("dashboard").lazyLayout(),
      {
        message: [
          'Route layout "dashboard/layout.tsx" does not default-export a React component.',
          "Add `export default` to the file, for example: `export default function Layout({ children }) { ... }`.",
        ].join("\n"),
      },
    );
  });
});

describe("route file default exports", () => {
  const componentLoader = (name) => async () => ({ default: component(name) });

  test("rejects a layout module that has no default export", () => {
    // Layouts are imported eagerly, so the missing component used to be stored
    // as `undefined` and the layout silently vanished from the routes.
    assert.throws(
      () => buildRouteTree(
        { "dashboard/page.tsx": componentLoader("dashboard") },
        { "dashboard/layout.tsx": { metadata: "only named exports" } },
        {},
      ),
      {
        message: [
          'Route layout "dashboard/layout.tsx" does not default-export a React component.',
          "Add `export default` to the file, for example: `export default function Layout({ children }) { ... }`.",
        ].join("\n"),
      },
    );
  });

  test("rejects a page that resolves without a default export", () => {
    // Pages stay code-split, so the file is only known once its loader resolves;
    // the error must still name the file rather than surface as a render error.
    const tree = buildRouteTree(
      { "about/page.tsx": async () => ({ title: "about" }) },
      {},
      {},
    );

    assert.deepEqual(routeShape(treeToRoutes(tree, true)), [
      { path: "about", children: undefined },
      // No root page: "/" is answered by the base guard instead of an empty
      // outlet, exactly as Next.js 404s it.
      { index: true, children: undefined },
    ]);

    return assert.rejects(
      () => tree.children.get("about").page(),
      {
        message: [
          'Route page "about/page.tsx" does not default-export a React component.',
          "Add `export default` to the file, for example: `export default function Page() { ... }`.",
        ].join("\n"),
      },
    );
  });

  test("rejects a not-found file that resolves without a default export", () => {
    const tree = buildRouteTree(
      { "dashboard/page.tsx": componentLoader("dashboard") },
      {},
      { "dashboard/not-found.tsx": async () => ({}) },
    );

    return assert.rejects(
      () => tree.children.get("dashboard").notFound(),
      {
        message: [
          'Route not-found "dashboard/not-found.tsx" does not default-export a React component.',
          "Add `export default` to the file, for example: `export default function NotFound() { ... }`.",
        ].join("\n"),
      },
    );
  });

  test("rejects a route file supplied as an eagerly imported module", () => {
    assert.throws(
      () => buildRouteTree(
        { "about/page.tsx": { default: component("about") } },
        {},
        {},
      ),
      {
        message: [
          'Route page "about/page.tsx" must be a lazy loader function such as `async () => import("...")`.',
          "Keep the page glob lazy (no `{ eager: true }`); received object.",
        ].join("\n"),
      },
    );
  });

  test("accepts wrapped components as default exports", async () => {
    const Base = component("base");
    const tree = buildRouteTree(
      {
        "memo/page.tsx": async () => ({ default: React.memo(Base) }),
        "ref/page.tsx": async () => ({ default: React.forwardRef(Base) }),
      },
      {
        "memo/layout.tsx": { default: React.memo(Base) },
        "ref/layout.tsx": { default: React.lazy(async () => ({ default: Base })) },
      },
      {},
    );

    // Layouts were validated while building the tree; `memo`, `forwardRef` and
    // `lazy` wrappers are components too, so the pages must resolve as well.
    await assert.doesNotReject(() => tree.children.get("memo").page());
    await assert.doesNotReject(() => tree.children.get("ref").page());
  });

  test("accepts route values unwrapped by the glob import option", async () => {
    // `import.meta.glob(pattern, { import: "default" })` yields the component
    // itself instead of a module namespace, so the record has to declare that
    // shape before a bare function is read as a component.
    const About = component("about");
    const Layout = component("layout");
    const tree = buildRouteTree(
      { "about/page.tsx": async () => About },
      { "about/layout.tsx": Layout },
      {},
      undefined,
      { layoutShape: "component" },
    );

    const LayoutNode = tree.children.get("about").layout;
    // Used as given: an unwrapped eager component is the layout, not a wrapper
    // around it, so its identity survives the tree build.
    assert.equal(LayoutNode, Layout);
    assert.equal(
      renderToStaticMarkup(React.createElement(LayoutNode)),
      "<div>layout</div>",
    );
    assert.deepEqual(await tree.children.get("about").page(), { default: About });
  });
});

describe("layout record shape", () => {
  // A layout is read exactly as the record declares it: `layoutShape` names the
  // glob that produced the entries, and the value is never called to find out
  // what it is. These tests pin what each shape accepts, the component identity
  // that follows from not wrapping, and the one case only React can report.
  const build = (layouts, options) =>
    buildRouteTree(
      { "about/page.tsx": loader("about") },
      layouts,
      {},
      undefined,
      options,
    ).children.get("about");
  const moduleLayoutOf = (layouts) => build(layouts).layout;
  const componentLayoutOf = (layouts) =>
    build(layouts, { layoutShape: "component" }).layout;

  test("refuses a bare function under the default module shape", () => {
    const Shell = component("shell");

    // Ambiguous by definition: a non-eager glob yields exactly the same value.
    assert.throws(
      () => moduleLayoutOf({ "about/layout.tsx": Shell }),
      /is a bare function, which an eager and a non-eager glob produce alike/,
    );
  });

  test("reads a declared component record and keeps the value's identity", () => {
    function Shell() {
      return React.createElement("div", null, "shell");
    }

    // Identity, not a copy: wrapping it would hand React a new component type on
    // every rebuild and remount the whole subtree for nothing.
    assert.equal(componentLayoutOf({ "about/layout.tsx": Shell }), Shell);
    assert.equal(
      renderToStaticMarkup(React.createElement(Shell)),
      "<div>shell</div>",
    );
  });

  test("unwraps an eagerly imported module layout in both eager shapes", () => {
    const Shell = component("shell");
    const layouts = { "about/layout.tsx": { default: Shell } };

    // `{ eager: true }` yields the module namespace, whose `default` is the
    // layout; a module is unambiguous, so the declaration does not change it.
    assert.equal(moduleLayoutOf(layouts), Shell);
    assert.equal(componentLayoutOf(layouts), Shell);
  });

  test("refuses a class layout under the module shape exactly like a function", () => {
    class Shell extends React.Component {
      render() {
        return React.createElement("div", null, "shell");
      }
    }

    // No shape rules at all, not even one that could only widen acceptance.
    // Recognising a class through `prototype.render` is sound - an `import()`
    // loader is an arrow function - but it still reads the code's form instead of
    // the declaration, and the declaration here said namespaces.
    assert.throws(
      () => moduleLayoutOf({ "about/layout.tsx": Shell }),
      /is a bare function, which an eager and a non-eager glob produce alike/,
    );
  });

  test("reads a declared class layout and keeps its identity", () => {
    class Shell extends React.Component {
      render() {
        return React.createElement("div", null, "shell");
      }
    }

    const Layout = componentLayoutOf({ "about/layout.tsx": Shell });

    assert.equal(Layout, Shell);
    assert.equal(
      renderToStaticMarkup(React.createElement(Layout)),
      "<div>shell</div>",
    );
  });

  test("reads a function as a loader when the record is declared lazy", () => {
    const Shell = component("shell");
    const node = build({ "about/layout.tsx": async () => ({ default: Shell }) }, {
      layoutShape: "loader",
    });

    assert.equal(node.layout, undefined);
    assert.equal(typeof node.lazyLayout, "function");
  });

  test("still reads a module entry eagerly inside a lazy record", () => {
    const Shell = component("shell");
    const node = build({ "about/layout.tsx": { default: Shell } }, {
      layoutShape: "loader",
    });

    // A mixed record is valid: only a function value needs the declaration.
    assert.equal(node.layout, Shell);
    assert.equal(node.lazyLayout, undefined);
  });

  test("rejects a layout value that is not a component at all", () => {
    assert.throws(
      () => moduleLayoutOf({ "about/layout.tsx": { metadata: "no default" } }),
      /Route layout "about\/layout\.tsx" does not default-export a React component/,
    );
  });

  test("leaves a wrong declaration to React", () => {
    // The single case a declaration cannot cover: the caller asserted unwrapped
    // components and handed over loaders. Checking it would mean invoking the
    // value, which is exactly what the router no longer does, so React reports
    // the Promise it was handed instead.
    const Layout = componentLayoutOf({
      "about/layout.tsx": async () => ({ default: component("shell") }),
    });

    assert.equal(typeof Layout, "function");
    assert.throws(
      () => renderToStaticMarkup(React.createElement(Layout)),
      /Objects are not valid as a React child/,
    );
  });
});

describe("typed navigation helpers", () => {
  test("fills dynamic parameters into a route pattern", () => {
    assert.equal(href("/users/:id", { id: "42" }), "/users/42");
    assert.equal(
      href("/compare/:from/:to", { from: "paris", to: "berlin" }),
      "/compare/paris/berlin",
    );
    assert.equal(href("/typed-routes"), "/typed-routes");
    assert.equal(href("/"), "/");
  });

  test("maps a named catch-all onto the splat when the generator knows its name", () => {
    // The public pattern is "/blog/*"; only the metadata the plugin generates
    // reveals that the folder is "[...slug]", so the friendly key needs it.
    const slug = { catchAll: { name: "slug", optional: false } };
    const files = { catchAll: { name: "files", optional: false } };
    assert.equal(href("/blog/*", { slug: "guide/api" }, slug), "/blog/guide/api");
    assert.equal(href("/*", { files: "a/b" }, files), "/a/b");
    // Without metadata the raw helper addresses the splat only as "*".
    assert.equal(href("/blog/*", { "*": "guide/api" }), "/blog/guide/api");
  });

  test("resolves an empty optional catch-all to the base path", () => {
    const segments = { catchAll: { name: "segments", optional: true } };
    const slug = { catchAll: { name: "slug", optional: true } };
    assert.equal(href("/docs/*", { segments: "a/b" }, segments), "/docs/a/b");
    assert.equal(href("/docs/*", { segments: "" }, segments), "/docs");
    assert.equal(href("/docs/*", {}, segments), "/docs");
    assert.equal(href("/*", { slug: "" }, slug), "/");
  });

  test("accepts the segment array useCatchAll returns", () => {
    const slug = { catchAll: { name: "slug", optional: false } };
    const optionalSlug = { catchAll: { name: "slug", optional: true } };
    const segments = { catchAll: { name: "segments", optional: true } };
    assert.equal(href("/blog/*", { slug: ["guide", "api"] }, slug), "/blog/guide/api");
    assert.equal(href("/docs/*", { segments: ["a", "b"] }, segments), "/docs/a/b");
    // `useCatchAll()` reports [] on the base path of an optional catch-all, which
    // joins to "" and resolves back to that base path.
    assert.equal(href("/docs/*", { segments: [] }, segments), "/docs");
    assert.equal(href("/*", { slug: [] }, optionalSlug), "/");
  });

  test("drops empty segments from a catch-all value, like useCatchAll", () => {
    // A trailing slash, a leading slash, a doubled slash, or a blank array entry
    // must not inject a "//" into the path, so href filters empty segments the
    // same way useCatchAll does when reading.
    const slug = { catchAll: { name: "slug", optional: false } };
    const segments = { catchAll: { name: "segments", optional: true } };
    assert.equal(href("/blog/*", { slug: "/a/b/" }, slug), "/blog/a/b");
    assert.equal(href("/blog/*", { slug: ["a", "", "b"] }, slug), "/blog/a/b");
    assert.equal(href("/blog/*", { slug: "a//b" }, slug), "/blog/a/b");
    // Dropping empties still leaves an all-empty value resolving to the base.
    assert.equal(href("/docs/*", { segments: "/" }, segments), "/docs");
    assert.equal(href("/docs/*", { segments: ["", ""] }, segments), "/docs");
  });

  test("percent-encodes each substituted path segment itself, not via generatePath", () => {
    // generatePath encodes in React Router v7 but not v6, and href no longer
    // calls it, so every value is encoded here once and the same on both.
    const slug = { catchAll: { name: "slug", optional: false } };
    assert.equal(href("/users/:id", { id: "a/b?x#y" }), "/users/a%2Fb%3Fx%23y");
    assert.equal(href("/blog/*", { slug: ["a b", "c?d"] }, slug), "/blog/a%20b/c%3Fd");
    // A string catch-all keeps `/` as its separator while encoding each part.
    assert.equal(href("/blog/*", { slug: "a b/c?d" }, slug), "/blog/a%20b/c%3Fd");
    // Ordinary values are unaffected, so existing routes read back the same.
    assert.equal(href("/blog/*", { slug: "guide/api" }, slug), "/blog/guide/api");
    assert.equal(href("/users/:id", { id: "42" }), "/users/42");
  });

  test("percent-encodes Unicode parameter values", () => {
    // A `:name` value and each catch-all segment go through encodeURIComponent,
    // so a multi-byte value is escaped identically on React Router v6 and v7
    // (`href` never calls `generatePath`, whose encoding differs between them).
    const slug = { catchAll: { name: "slug", optional: false } };
    assert.equal(href("/users/:id", { id: "café" }), "/users/caf%C3%A9");
    assert.equal(href("/u/:id", { id: "👍" }), "/u/%F0%9F%91%8D");
    // A catch-all keeps `/` as its separator while encoding each segment.
    assert.equal(href("/blog/*", { slug: "日本/語" }, slug), "/blog/%E6%97%A5%E6%9C%AC/%E8%AA%9E");
    // The encoded value is a valid single segment, so it reads back unchanged.
    assert.equal(href("/users/:id", { id: "café" }), "/users/caf%C3%A9");
  });

  test("rejects a value that resolves as a dot-segment", () => {
    // encodeURIComponent leaves "." and ".." verbatim and a browser / React
    // Router still resolves them out of the path, so href refuses them rather
    // than encoding a value that would turn "/users/.." into "/".
    assert.throws(
      () => href("/users/:id", { id: ".." }),
      { message: /cannot be "\.\.":/ },
    );
    assert.throws(
      () => href("/users/:id", { id: "." }),
      { message: /cannot be "\.":/ },
    );
    // A catch-all is validated per segment, as an array or a split string.
    const slug = { catchAll: { name: "slug", optional: false } };
    assert.throws(
      () => href("/blog/*", { slug: ["..", "x"] }, slug),
      { message: /cannot be "\.\.":/ },
    );
    assert.throws(
      () => href("/blog/*", { slug: "a/.." }, slug),
      { message: /cannot be "\.\.":/ },
    );
    // Only an exact "." / ".." segment is a dot-segment; a longer value, and a
    // pre-encoded one that encodeURIComponent escapes to "%252e", stay safe.
    assert.equal(href("/users/:id", { id: "..." }), "/users/...");
    assert.equal(href("/users/:id", { id: "a.b" }), "/users/a.b");
    assert.equal(href("/users/:id", { id: "%2e%2e" }), "/users/%252e%252e");
  });

  test("reports a parameter the pattern cannot consume", () => {
    assert.throws(
      () => href("/users/:id", { userId: "42" }),
      {
        message: 'Route "/users/:id" has no "userId" parameter. Expected: "id".',
      },
    );
    assert.throws(
      () => href("/about", { id: "1" }),
      {
        message: 'Route "/about" has no "id" parameter. This route takes no parameters.',
      },
    );
  });

  test("rejects a catch-all key the route does not declare", () => {
    // The generator knows the folder is "[...slug]", so "other" must fail rather
    // than be routed onto the splat — this is the central correctness fix.
    const slug = { catchAll: { name: "slug", optional: false } };
    assert.throws(
      () => href("/blog/*", { other: "guide/api" }, slug),
      {
        message:
          'Route "/blog/*" has no "other" parameter. Expected: "slug". ' +
          'Pass the value under its declared name "slug" (or React Router\'s "*").',
      },
    );
    // A bare href carries no metadata, so it cannot validate "slug" and rejects
    // it too; only React Router's "*" fills the splat there.
    assert.throws(
      () => href("/blog/*", { slug: "guide/api" }),
      {
        message:
          'Route "/blog/*" has no "slug" parameter. Expected: "*". ' +
          'Address the splat with "*", or import href/Link from ' +
          '"next-vite-router/routes" so a catch-all is validated by its folder name.',
      },
    );
    // One catch-all value only, even when named two valid ways at once.
    assert.throws(
      () => href("/blog/*", { slug: "a", "*": "b" }, slug),
      {
        message: 'Route "/blog/*" takes one catch-all value, but 2 params were supplied ("slug", "*").',
      },
    );
  });

  test("rejects a missing or empty value for a required catch-all", () => {
    // "[...slug]" never matches "/blog" on its own, so resolving to the base path
    // would render a broken link; report it like a missing required param.
    const slug = { catchAll: { name: "slug", optional: false } };
    assert.throws(
      () => href("/blog/*", {}, slug),
      { message: 'Route "/blog/*" is missing the required "slug" catch-all param.' },
    );
    assert.throws(
      () => href("/blog/*", { slug: [] }, slug),
      { message: /requires a non-empty value for its "slug" catch-all param/ },
    );
    assert.throws(
      () => href("/blog/*", { slug: "" }, slug),
      { message: /requires a non-empty value for its "slug" catch-all param/ },
    );
  });

  test("rejects a segment array for a single-segment param", () => {
    // Only a catch-all spans several segments; an array on `[id]` is a mistake,
    // and joining it would silently build a path the route cannot match.
    assert.throws(
      () => href("/users/:id", { id: ["1", "2"] }),
      {
        message:
          'Route "/users/:id" expects a string for its ":id" param; only a catch-all value accepts an array of segments.',
      },
    );
  });

  test("reports a missing required parameter with its route", () => {
    assert.throws(
      () => href("/users/:id"),
      { message: 'Route "/users/:id" is missing the required ":id" param.' },
    );
    assert.throws(
      () => href("/users/:id", { id: undefined }),
      { message: 'Route "/users/:id" is missing the required ":id" param.' },
    );
  });

  test("rejects an empty value for a required parameter", () => {
    // An empty `:name` would encode to "" and collapse its segment, so
    // "/users/:id" would resolve to "/users/" — a different route — without an
    // error. Report it like a missing value instead of building that link.
    assert.throws(
      () => href("/users/:id", { id: "" }),
      { message: /requires a non-empty value for its ":id" param/ },
    );
    assert.throws(
      () => href("/compare/:from/:to", { from: "paris", to: "" }),
      { message: /requires a non-empty value for its ":to" param/ },
    );
  });

  test("rejects a pattern that is not root-relative", () => {
    assert.throws(
      () => href("users/:id", { id: "42" }),
      {
        message:
          'Route pattern "users/:id" must be root-relative, like the generated RoutePath values ("/users/:id").',
      },
    );
  });

  const renderLink = (props, ...children) => renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/"] },
      React.createElement(Link, props, ...children),
    ),
  );

  test("Link renders the resolved href and forwards other link props", () => {
    const markup = renderLink(
      {
        href: "/users/:id",
        params: { id: "42" },
        className: "user-link",
        title: "Open the profile",
      },
      "Profile",
    );

    assert.match(markup, /href="\/users\/42"/);
    assert.match(markup, /class="user-link"/);
    assert.match(markup, /title="Open the profile"/);
    assert.match(markup, /<a[^>]*>Profile<\/a>/);
  });

  test("Link accepts a catch-all segment array through its generated metadata", () => {
    // The plugin-bound Link (createTypedLink) knows the folder name; the value
    // `useCatchAll()` returns can be handed straight back to it.
    const BlogLink = createTypedLink({
      "/blog/*": { catchAll: { name: "slug", optional: false } },
    });
    const markup = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        React.createElement(BlogLink, { href: "/blog/*", params: { slug: ["guide", "api"] } }, "Docs"),
      ),
    );
    assert.match(markup, /href="\/blog\/guide\/api"/);
  });

  test("the raw Link fills a catch-all only through the splat, not a guessed name", () => {
    // `Link` imported directly from the package carries no metadata, so a friendly
    // name cannot be validated and is rejected exactly like the raw `href`.
    assert.throws(
      () => renderLink({ href: "/blog/*", params: { slug: "guide/api" } }, "Docs"),
      { message: /Route "\/blog\/\*" has no "slug" parameter/ },
    );
    // "*" still addresses the splat, and a misspelled key is rejected.
    assert.match(
      renderLink({ href: "/blog/*", params: { "*": "guide/api" } }, "Docs"),
      /href="\/blog\/guide\/api"/,
    );
    assert.throws(
      () => renderLink({ href: "/blog/*", params: { other: "guide/api" } }, "Docs"),
      { message: /has no "other" parameter/ },
    );
  });

  test("Link accepts a pattern without parameters as-is", () => {
    assert.match(renderLink({ href: "/about" }, "About"), /href="\/about"/);
  });

  test("Link leaves an address with nothing to substitute alone", () => {
    // generatePath() collapses the "//" of an absolute URL, so a `href` without
    // a token is passed to React Router untouched instead of being rewritten.
    assert.match(
      renderLink({ href: "https://example.com/a/b" }, "Docs"),
      /href="https:\/\/example\.com\/a\/b"/,
    );
  });

  test("Link fails with the route instead of rendering an empty anchor", () => {
    assert.throws(
      () => renderLink({ href: "/users/:id" }, "Profile"),
      { message: 'Route "/users/:id" is missing the required ":id" param.' },
    );
  });

  test("Link names the prop it wants when handed React Router's to", () => {
    // Upgrading apps used to get React Router's `Link` from the virtual module,
    // so a `to` here has to be reported instead of rendering a dead link.
    assert.throws(
      () => renderLink({ to: "/users" }, "Users"),
      /Link takes a route pattern in `href`/,
    );
  });
});