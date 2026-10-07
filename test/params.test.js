import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useRoutes } from "react-router-dom";
import {
  CatchAllParamProvider,
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
