import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { matchRoutes, MemoryRouter, useRoutes } from "react-router-dom";
import {
  buildRouteTree,
  CatchAllParamProvider,
  treeToRoutes,
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
