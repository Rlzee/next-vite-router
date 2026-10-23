import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { matchRoutes, MemoryRouter, useRoutes } from "react-router-dom";
import {
  buildRouteTree,
  CatchAllParamProvider,
  treeToRoutes,
  useCatchAll,
  useParams,
} from "../dist/index.js";

function Probe() {
  const params = useParams();
  return React.createElement("output", null, params.slug);
}

function RoutesApp() {
  return useRoutes([{
    path: "/blog/*",
    element: React.createElement(
      CatchAllParamProvider,
      { name: "slug" },
      React.createElement(Probe),
    ),
  }]);
}

function App() {
  return React.createElement(
    MemoryRouter,
    { initialEntries: ["/blog/one/two"] },
    React.createElement(RoutesApp),
  );
}

test("useParams maps catch-all parameters in a MemoryRouter", () => {
  assert.match(renderToStaticMarkup(React.createElement(App)), /one\/two/);
});

test("treeToRoutes attaches the catch-all provider to generated pages", () => {
  const loader = async () => ({ default: Probe });
  const routes = treeToRoutes(buildRouteTree({
    "blog/[...slug]/page.tsx": loader,
  }, {}, {}), true);
  const generatedPage = routes[0].children[0];
  const provider = generatedPage.element;

  assert.equal(provider.type, CatchAllParamProvider);
  assert.equal(provider.props.name, "slug");
});

test("optional catch-all routes match the base and nested paths", () => {
  const loader = async () => ({ default: Probe });
  const routes = treeToRoutes(buildRouteTree({
    "docs/[[...segments]]/page.tsx": loader,
  }, {}, {}), true);

  const baseMatch = matchRoutes(routes, "/docs");
  const nestedMatch = matchRoutes(routes, "/docs/foo");
  const deepMatch = matchRoutes(routes, "/docs/foo/bar");

  assert.equal(baseMatch?.at(-1)?.route.index, true);
  assert.deepEqual(baseMatch?.at(-1)?.params, {});
  assert.equal(nestedMatch?.at(-1)?.route.path, "*");
  assert.equal(nestedMatch?.at(-1)?.params["*"], "foo");
  assert.equal(deepMatch?.at(-1)?.route.path, "*");
  assert.equal(deepMatch?.at(-1)?.params["*"], "foo/bar");
});

test("optional catch-all routes preserve layout matching at base and nested paths", () => {
  function DocsLayout() {
    return React.createElement("section", null, "docs");
  }

  const loader = async () => ({ default: Probe });
  const routes = treeToRoutes(buildRouteTree(
    { "docs/[[...segments]]/page.tsx": loader },
    { "docs/layout.tsx": { default: DocsLayout } },
    {},
  ), true);

  const baseMatch = matchRoutes(routes, "/docs");
  const nestedMatch = matchRoutes(routes, "/docs/reference/api");

  assert.deepEqual(
    baseMatch?.map(({ route }) => route.path ?? route.index),
    ["docs", true],
  );
  assert.deepEqual(
    nestedMatch?.map(({ route }) => route.path ?? route.index),
    ["docs", "*"],
  );
  assert.equal(baseMatch?.[0]?.route.element.type, DocsLayout);
  assert.equal(nestedMatch?.at(-1)?.params["*"], "reference/api");
});

function renderRoutes(routes, url) {
  function App() {
    return useRoutes(routes);
  }

  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: [url] },
      React.createElement(App),
    ),
  );
}

// React Router reports a catch-all under the unnamed "*" splat, so these cover
// where the renamed value is reachable from: the page, the layout declared in
// the same folder, and not the layout above that segment.
function renderCatchAllLayout(layoutPath, Layout, url = "/docs/guide/api") {
  return renderRoutes(treeToRoutes(buildRouteTree(
    { "docs/[...slug]/page.tsx": async () => ({ default: Probe }) },
    { [layoutPath]: { default: Layout } },
    {},
  ), true), url);
}

test("renames the catch-all parameter for a layout in the same folder", () => {
  function SlugLayout() {
    const params = useParams();
    return React.createElement("p", null, `slug=${params.slug ?? "missing"}`);
  }

  assert.match(
    renderCatchAllLayout("docs/[...slug]/layout.tsx", SlugLayout),
    /slug=guide\/api/,
  );
});

test("keeps React Router's splat key readable", () => {
  function SplatLayout() {
    const params = useParams();
    return React.createElement("p", null, `star=${params["*"] ?? "missing"}`);
  }

  assert.match(
    renderCatchAllLayout("docs/[...slug]/layout.tsx", SplatLayout),
    /star=guide\/api/,
  );
});

test("leaves a layout above the catch-all segment without the parameter", () => {
  function SlugLayout() {
    const params = useParams();
    return React.createElement("p", null, `slug=${params.slug ?? "missing"}`);
  }

  // `docs/layout.tsx` renders before the `[...slug]` child matches, so the
  // splat is not part of its match yet; this is the documented limit.
  assert.match(
    renderCatchAllLayout("docs/layout.tsx", SlugLayout),
    /slug=missing/,
  );
});

test("useCatchAll splits the value into segments", () => {
  function SegmentsLayout() {
    const anonymous = useCatchAll().join("|");
    const named = useCatchAll("slug").join("|");
    const misnamed = useCatchAll("other").join("|");
    return React.createElement("p", null, `${anonymous} ${named} ${misnamed}`);
  }

  assert.match(
    renderCatchAllLayout("docs/[...slug]/layout.tsx", SegmentsLayout),
    /guide\|api guide\|api guide\|api/,
  );
});

test("useCatchAll drops the empty segment a trailing slash adds", () => {
  function SegmentsLayout() {
    return React.createElement("p", null, useCatchAll().join("|"));
  }

  // /docs/guide/api/ makes the splat "guide/api/"; its trailing "" is not a real
  // segment, so the value must read back as exactly ["guide", "api"].
  const markup = renderCatchAllLayout(
    "docs/[...slug]/layout.tsx",
    SegmentsLayout,
    "/docs/guide/api/",
  );
  assert.match(markup, /<p>guide\|api<\/p>/);
  assert.doesNotMatch(markup, /guide\|api\|/);
});

test("useCatchAll returns an empty array when nothing matched", () => {
  function SegmentsLayout() {
    return React.createElement("p", null, `n=${useCatchAll().length}`);
  }

  // The layout renders synchronously; a page alone would still be lazy.
  const routes = treeToRoutes(buildRouteTree(
    { "about/page.tsx": async () => ({ default: Probe }) },
    { "about/layout.tsx": { default: SegmentsLayout } },
    {},
  ), true);

  assert.match(renderRoutes(routes, "/about"), /n=0/);
});

test("href-encoded Unicode reads back through useParams", () => {
  // href()/Link percent-encode a `:name` value; React Router decodes it before
  // useParams returns it, so "/users/caf%C3%A9" reads back as "café" the same on
  // React Router v6 and v7 (verified by running this suite against both).
  function IdLayout() {
    const { id } = useParams();
    return React.createElement("p", null, `id=${id ?? "missing"}`);
  }

  const routes = treeToRoutes(buildRouteTree(
    { "users/[id]/page.tsx": async () => ({ default: Probe }) },
    { "users/[id]/layout.tsx": { default: IdLayout } },
    {},
  ), true);

  assert.match(renderRoutes(routes, "/users/caf%C3%A9"), /id=café/);
});

test("useCatchAll splits a decoded Unicode catch-all into segments", () => {
  function SegmentsLayout() {
    return React.createElement("p", null, useCatchAll().join("|"));
  }

  // /docs/%E6%97%A5%E6%9C%AC/%E8%AA%9E is what href("/blog/*", { slug: "日本/語" })
  // produces; the splat decodes to "日本/語" and splits on the separator.
  assert.match(
    renderCatchAllLayout(
      "docs/[...slug]/layout.tsx",
      SegmentsLayout,
      "/docs/%E6%97%A5%E6%9C%AC/%E8%AA%9E",
    ),
    /<p>日本\|語<\/p>/,
  );
});
