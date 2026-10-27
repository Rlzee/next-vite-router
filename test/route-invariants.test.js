/**
 * Consolidated route-system invariants.
 *
 * One matrix covers the five route primitives (groups, layouts, index routes,
 * catch-all, not-found) and, crucially, their interactions: a group wrapping a
 * layout, a layout holding an index route, a catch-all under a layout, a
 * not-found nested beside a page. Every case is checked structurally with
 * `matchRoutes()` (which chain of routes a URL resolves to, and with which
 * params), and the sensitive cases are rendered as a real application so the
 * claim is about what a browser would paint, not only about the route shape.
 */
import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, matchRoutes, useRoutes } from "react-router-dom";
import {
  buildRouteTree,
  configureRouter,
  createRouteGenerator,
  resetRouterConfig,
  treeToRoutes,
} from "../dist/index.js";
import { useCatchAll, useParams } from "../dist/plugin-runtime.js";

// ---------------------------------------------------------------------------
// Route-file factories. A page is always a lazy loader (mirroring the glob),
// a layout an eager module, so the fixtures exercise the same shapes the
// virtual module feeds `buildRouteTree`.
// ---------------------------------------------------------------------------
const page = ([path, name]) => [`${path}.tsx`, async () => ({ default: () => h("div", { "data-page": name }, name) })];
const pageWithId = ([path, name]) => [`${path}.tsx`, async () => ({
  default: () => h("div", { "data-page": name }, `${name}:${useParams().id ?? "?"}`),
})];
const pageWithCatchAll = ([path, name]) => [`${path}.tsx`, async () => ({
  default: () => h("div", { "data-page": name }, `${name}{${useCatchAll().join("|")}}`),
})];
const notFound = ([path, name]) => [`${path}.tsx`, async () => ({
  default: () => h("div", { "data-not-found": name }, `nf:${name}`),
})];
const layout = ([path, name]) => [`${path}.tsx`, { default: () => h("section", { "data-layout": name }, `[${name}`, h(Outlet), `/${name}]`) }];

/** Build the flat page/layout/not-found maps the tree API expects. */
function files(pairs) {
  return Object.fromEntries(pairs);
}

/**
 * The identity of a matched route as a stable, readable label: its path, or
 * `"index"` / `"(layout)"` for the routes React Router declares without one.
 */
function routeLabel(route) {
  if (route.index) return "index";
  return route.path ?? "(layout)";
}

/** Resolve a URL and return `[labels, leafParams]`, or null when unmatched. */
function resolve(routes, url) {
  const matches = matchRoutes(routes, url);
  if (!matches) return null;
  return {
    chain: matches.map(({ route }) => routeLabel(route)),
    params: matches.at(-1).params,
  };
}

/**
 * Paint the routes as a real application at `url`, using React Router's
 * `useRoutes` inside a `MemoryRouter`. Pages are lazy, so the first pass only
 * starts their imports and paints the fallback; once those promises settle the
 * second pass renders the resolved components, exactly as a browser repaints
 * after a Suspense boundary's chunk arrives.
 */
async function renderApp(routes, url) {
  const App = () => useRoutes(routes);
  const tree = h(MemoryRouter, { initialEntries: [url] }, h(App));
  renderToStaticMarkup(tree); // kick the lazy loaders
  await new Promise((resolve) => setTimeout(resolve, 0));
  return renderToStaticMarkup(tree);
}

function createRoutes({ pages = {}, layouts = {}, notFounds = {} }) {
  const tree = buildRouteTree(pages, layouts, notFounds);
  return treeToRoutes(tree, true);
}

beforeEach(() => {
  resetRouterConfig();
});

// ---------------------------------------------------------------------------
// The matrix. Each row combines route primitives and states the invariant the
// combination must hold. `urls` are checked with `matchRoutes`; `paints` (on
// the sensitive rows) re-render the same routes and assert the HTML.
// ---------------------------------------------------------------------------
const MATRIX = [
  {
    name: "group is omitted from the URL but keeps its children",
    rows: { pages: [page(["(admin)/dashboard/page", "dashboard"])] },
    urls: [
      { url: "/dashboard", chain: ["dashboard"], params: {} },
      { url: "/admin/dashboard", chain: null },
      // No page answers the root - the group is not one - so the base guard is.
      { url: "/", chain: ["index"], params: {} },
    ],
  },
  {
    name: "group root page becomes an index under a pathless layout route",
    rows: {
      pages: [page(["(marketing)/page", "marketing-home"]), page(["(marketing)/about/page", "about"])],
      layouts: [layout(["(marketing)/layout", "marketing"])],
    },
    urls: [
      { url: "/", chain: ["(layout)", "index"], params: {} },
      { url: "/about", chain: ["(layout)", "about"], params: {} },
    ],
    paints: [
      {
        url: "/",
        includes: ['data-layout="marketing"', 'data-page="marketing-home"'],
        order: ["[marketing", "marketing-home", "/marketing]"],
      },
    ],
  },
  {
    name: "a page next to children turns into an index route",
    rows: {
      pages: [page(["users/page", "list"]), pageWithId(["users/[id]/page", "detail"])],
    },
    urls: [
      { url: "/users", chain: ["users", "index"], params: {} },
      { url: "/users/42", chain: ["users", ":id"], params: { id: "42" } },
    ],
  },
  {
    name: "layout-only node guards its base with the nearest not-found",
    rows: {
      pages: [page(["shop/items/page", "items"])],
      layouts: [layout(["shop/layout", "shop"]), layout(["layout", "root"])],
      notFounds: [notFound(["not-found", "root"])],
    },
    urls: [
      // `/shop` has no page: the guard index makes it a leaf match, so the
      // chain stops at the base instead of painting an empty outlet.
      { url: "/shop", chain: ["/", "shop", "index"], params: {} },
      { url: "/shop/items", chain: ["/", "shop", "items"], params: {} },
    ],
    paints: [
      {
        url: "/shop",
        includes: ['data-layout="root"', 'data-layout="shop"', 'data-not-found="root"'],
        order: ["[root", "[shop", "nf:root", "/shop]", "/root]"],
        excludes: ['data-page="items"'],
      },
    ],
  },
  {
    name: "a folder without a page 404s at its own URL, at every level",
    rows: {
      pages: [
        page(["docs/intro/page", "intro"]),
        page(["deep/leaf/page", "leaf"]),
        pageWithId(["shop/[cat]/[item]/page", "item"]),
      ],
      layouts: [layout(["layout", "root"])],
      notFounds: [notFound(["not-found", "root"])],
    },
    urls: [
      // Each intermediate folder is guarded, and the guards stay leaf matches:
      // the URLs that do have a page still resolve to it.
      { url: "/docs", chain: ["/", "docs", "index"], params: {} },
      { url: "/docs/intro", chain: ["/", "docs", "intro"], params: {} },
      { url: "/deep", chain: ["/", "deep", "index"], params: {} },
      { url: "/deep/leaf", chain: ["/", "deep", "leaf"], params: {} },
      { url: "/shop", chain: ["/", "shop", "index"], params: {} },
      { url: "/shop/a", chain: ["/", "shop", ":cat", "index"], params: { cat: "a" } },
      { url: "/shop/a/b", chain: ["/", "shop", ":cat", ":item"], params: { cat: "a", item: "b" } },
    ],
    paints: [
      { url: "/docs", includes: ['data-not-found="root"'], excludes: ['data-page="intro"'] },
      { url: "/deep/leaf", includes: ['data-page="leaf"'] },
      { url: "/shop", includes: ['data-not-found="root"'], excludes: ['data-page="item"'] },
      { url: "/shop/a", includes: ['data-not-found="root"'], excludes: ['data-page="item"'] },
      { url: "/shop/a/b", includes: ['data-page="item"'] },
    ],
  },
  {
    name: "a page-less folder guards its base even with no not-found anywhere",
    rows: { pages: [page(["docs/intro/page", "intro"])] },
    urls: [
      // Still a leaf match, rendering nothing: the blank 404 an app without a
      // `not-found.tsx` gets, and never the page below with an empty value.
      { url: "/docs", chain: ["docs", "index"], params: {} },
      { url: "/docs/intro", chain: ["docs", "intro"], params: {} },
    ],
    paints: [
      { url: "/docs", excludes: ['data-page="intro"'] },
      { url: "/docs/intro", includes: ['data-page="intro"'] },
    ],
  },
  {
    name: "a page-less folder answers its base with its own not-found",
    rows: {
      pages: [page(["docs/intro/page", "intro"])],
      notFounds: [notFound(["not-found", "root"]), notFound(["docs/not-found", "docs"])],
    },
    urls: [
      // Same rule as the required catch-all base: the folder's own `not-found`
      // wins, so `/docs` and `/docs/anything` show one boundary.
      { url: "/docs", chain: ["/", "docs", "index"], params: {} },
      { url: "/docs/missing", chain: ["/", "docs", "*"], params: { "*": "missing" } },
    ],
    paints: [
      {
        url: "/docs",
        includes: ['data-not-found="docs"'],
        excludes: ['data-not-found="root"', 'data-page="intro"'],
      },
      { url: "/docs/missing", includes: ['data-not-found="docs"'] },
    ],
  },
  {
    name: "a group adds no base guard of its own",
    rows: {
      pages: [page(["(marketing)/docs/intro/page", "intro"])],
      layouts: [layout(["(marketing)/layout", "marketing"]), layout(["layout", "root"])],
      notFounds: [notFound(["not-found", "root"])],
    },
    urls: [
      // The group owns no URL: the guard belongs to `docs`, which sits at the
      // same level once the group is dropped from the path.
      { url: "/docs", chain: ["/", "(layout)", "docs", "index"], params: {} },
      { url: "/docs/intro", chain: ["/", "(layout)", "docs", "intro"], params: {} },
    ],
    paints: [
      {
        url: "/docs",
        includes: ['data-layout="marketing"', 'data-not-found="root"'],
        order: ["[root", "[marketing", "nf:root", "/marketing]", "/root]"],
      },
    ],
  },
  {
    name: "required catch-all keeps its prefix and reports the splat",
    rows: {
      pages: [pageWithCatchAll(["blog/[...slug]/page", "blog"])],
      notFounds: [notFound(["not-found", "root"])],
    },
    urls: [
      // The base URL is a real leaf match on the guard index, not a splat
      // match with an empty value: `/blog` answers with the not-found.
      { url: "/blog", chain: ["/", "blog", "index"], params: {} },
      { url: "/blog/", chain: ["/", "blog", "index"], params: {} },
      { url: "/blog/guide", chain: ["/", "blog", "*"], params: { "*": "guide" } },
      { url: "/blog/guide/api", chain: ["/", "blog", "*"], params: { "*": "guide/api" } },
      // React Router keeps the trailing slash in the raw splat; `useCatchAll`
      // drops empty segments, so the rendered value is normalized (see paints).
      { url: "/blog/guide/api/", chain: ["/", "blog", "*"], params: { "*": "guide/api/" } },
    ],
    paints: [
      { url: "/blog", includes: ['data-not-found="root"'], excludes: ["blog{"] },
      { url: "/blog/guide/api", includes: ["blog{guide|api}"] },
      { url: "/blog/guide/api/", includes: ["blog{guide|api}"] },
    ],
  },
  {
    name: "optional catch-all matches its base path and everything below",
    rows: { pages: [pageWithCatchAll(["docs/[[...segments]]/page", "docs"])] },
    urls: [
      { url: "/docs", chain: ["docs", "index"], params: {} },
      { url: "/docs/a/b", chain: ["docs", "*"], params: { "*": "a/b" } },
    ],
    paints: [
      { url: "/docs", includes: ["docs{}"] },
      { url: "/docs/a/b", includes: ["docs{a|b}"] },
    ],
  },
  {
    name: "root required catch-all is a guarded splat that skips /",
    rows: {
      pages: [pageWithCatchAll(["[...slug]/page", "everything"])],
      notFounds: [notFound(["not-found", "root"])],
    },
    urls: [
      { url: "/", chain: ["/", "index"], params: {} },
      { url: "/a/b", chain: ["/", "*"], params: { "*": "a/b" } },
    ],
    paints: [
      { url: "/", includes: ['data-not-found="root"'], excludes: ["everything{"] },
      { url: "/x/y", includes: ["everything{x|y}"] },
    ],
  },
  {
    name: "required catch-all without any not-found paints no page at its base",
    rows: { pages: [pageWithCatchAll(["blog/[...slug]/page", "blog"])] },
    urls: [
      { url: "/blog", chain: ["blog", "index"], params: {} },
      { url: "/blog/guide", chain: ["blog", "*"], params: { "*": "guide" } },
    ],
    paints: [
      // The guard index still matches, with nothing to render: the page must
      // not be invoked with an empty catch-all.
      { url: "/blog", excludes: ["blog{"] },
      { url: "/blog/guide", includes: ["blog{guide}"] },
    ],
  },
  {
    name: "a folder's own not-found answers its catch-all base",
    rows: {
      pages: [pageWithCatchAll(["blog/[...slug]/page", "blog"])],
      layouts: [layout(["blog/layout", "blog-shell"])],
      notFounds: [notFound(["blog/not-found", "blog"])],
    },
    urls: [
      { url: "/blog", chain: ["blog", "index"], params: {} },
      { url: "/blog/guide", chain: ["blog", "*"], params: { "*": "guide" } },
    ],
    paints: [
      {
        url: "/blog",
        includes: ['data-layout="blog-shell"', 'data-not-found="blog"'],
        order: ["[blog-shell", "nf:blog", "/blog-shell]"],
      },
    ],
  },
  {
    name: "catch-all composes with a parent layout",
    rows: {
      pages: [pageWithCatchAll(["docs/[...slug]/page", "docs"])],
      layouts: [layout(["docs/layout", "docs-shell"])],
      notFounds: [notFound(["not-found", "root"])],
    },
    urls: [
      { url: "/docs", chain: ["/", "docs", "index"], params: {} },
      { url: "/docs/guide/api", chain: ["/", "docs", "*"], params: { "*": "guide/api" } },
    ],
    paints: [
      {
        url: "/docs",
        includes: ['data-layout="docs-shell"', 'data-not-found="root"'],
        order: ["[docs-shell", "nf:root", "/docs-shell]"],
      },
      {
        url: "/docs/guide/api",
        includes: ['data-layout="docs-shell"', "docs{guide|api}"],
        order: ["[docs-shell", "docs{guide|api}", "/docs-shell]"],
      },
    ],
  },
  {
    name: "not-found sits beside the page as a level-local splat",
    rows: {
      pages: [page(["dashboard/page", "dashboard"]), page(["about/page", "about"])],
      notFounds: [notFound(["dashboard/not-found", "dashboard"]), notFound(["not-found", "root"])],
    },
    urls: [
      { url: "/dashboard", chain: ["/", "dashboard", "index"], params: {} },
      { url: "/dashboard/missing", chain: ["/", "dashboard", "*"], params: { "*": "missing" } },
      { url: "/about", chain: ["/", "about"], params: {} },
      { url: "/nowhere", chain: ["/", "*"], params: { "*": "nowhere" } },
    ],
    paints: [
      { url: "/dashboard/missing", includes: ['data-not-found="dashboard"'] },
      { url: "/nowhere", includes: ['data-not-found="root"'] },
    ],
  },
  {
    name: "nested layouts wrap the deepest index and dynamic routes",
    rows: {
      pages: [
        page(["page", "home"]),
        page(["users/page", "list"]),
        pageWithId(["users/[id]/page", "detail"]),
      ],
      layouts: [layout(["layout", "root"]), layout(["users/layout", "users"])],
    },
    urls: [
      { url: "/", chain: ["/", "index"], params: {} },
      { url: "/users", chain: ["/", "users", "index"], params: {} },
      { url: "/users/7", chain: ["/", "users", ":id"], params: { id: "7" } },
      { url: "/users/7/edit", chain: null },
    ],
    paints: [
      { url: "/", order: ["[root", "home", "/root]"] },
      { url: "/users", order: ["[root", "[users", "list", "/users]", "/root]"] },
      { url: "/users/7", order: ["[root", "[users", "detail:7", "/users]", "/root]"] },
    ],
  },
  {
    name: "a group can wrap a layout whose subtree holds a not-found",
    rows: {
      pages: [page(["(app)/(admin)/reports/page", "reports"])],
      layouts: [layout(["(app)/(admin)/layout", "admin"])],
      notFounds: [notFound(["(app)/(admin)/not-found", "admin"])],
    },
    urls: [
      { url: "/reports", chain: ["(layout)", "reports"], params: {} },
      { url: "/reports/hidden", chain: ["(layout)", "*"], params: { "*": "reports/hidden" } },
    ],
    paints: [
      {
        url: "/reports/hidden",
        includes: ['data-layout="admin"', 'data-not-found="admin"'],
        order: ["[admin", "nf:admin", "/admin]"],
      },
    ],
  },
];

describe("route invariant matrix (matchRoutes)", () => {
  for (const { name, rows, urls } of MATRIX) {
    test(name, () => {
      const routes = createRoutes({
        pages: files(rows.pages ?? []),
        layouts: files(rows.layouts ?? []),
        notFounds: files(rows.notFounds ?? []),
      });

      for (const { url, chain, params } of urls) {
        const actual = resolve(routes, url);
        if (chain === null) {
          assert.equal(actual, null, `${url} should not match`);
          continue;
        }
        assert.deepEqual(actual.chain, chain, `${url} chain`);
        assert.deepEqual(actual.params, params, `${url} params`);
      }
    });
  }
});

describe("route invariant matrix (rendered application)", () => {
  for (const { name, rows, paints } of MATRIX) {
    if (!paints) continue;
    test(name, async () => {
      const generate = createRouteGenerator(
        files(rows.pages ?? []),
        files(rows.layouts ?? []),
        files(rows.notFounds ?? []),
      );
      const routes = generate();

      for (const paint of paints) {
        const html = await renderApp(routes, paint.url);
        for (const fragment of paint.includes ?? []) {
          assert.match(html, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${paint.url} html`);
        }
        for (const fragment of paint.excludes ?? []) {
          assert.doesNotMatch(
            html,
            new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
            `${paint.url} should not paint ${fragment}`,
          );
        }
        if (paint.order) {
          const positions = paint.order.map((marker) => html.indexOf(marker));
          positions.forEach((position, index) => {
            assert.notEqual(position, -1, `${paint.url} missing "${paint.order[index]}"`);
            if (index > 0) {
              assert.ok(
                positions[index - 1] < position,
                `${paint.url} expected "${paint.order[index - 1]}" before "${paint.order[index]}" in ${html}`,
              );
            }
          });
        }
      }
    });
  }
});

describe("router configuration is read at render time", () => {
  test("a configured fallback paints while a lazy page is loading", async () => {
    configureRouter({
      loadingFallback: () => h("p", null, "Loading…"),
    });
    const routes = createRoutes({ pages: files([page(["slow/page", "slow"])]) });

    // First paint only starts the import, so the configured fallback is what a
    // browser shows; after the chunk settles the page replaces it.
    const App = () => useRoutes(routes);
    const tree = h(MemoryRouter, { initialEntries: ["/slow"] }, h(App));
    assert.match(renderToStaticMarkup(tree), /<p>Loading…<\/p>/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(renderToStaticMarkup(tree), /data-page="slow"/);
  });
});
