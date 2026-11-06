/**
 * Real-HTTP integration guard for the server-side status decision.
 *
 * `test/compat-app/src/entry-server.tsx` renders the route tree through
 * `renderToPipeableStream`, but it never speaks HTTP: it asserts the streamed
 * document and asks `getRouteStatus()` in the same breath, without a socket, a
 * status line, or a header in the way. The whole reason `getRouteStatus()` is
 * exported - and documented as a decision to make *before the first byte* - is a
 * server that turns it into a real response. That boundary is what lives here.
 *
 * The routes are built the same way `route-invariants.test.js` builds them -
 * `createRouteGenerator` over hand-written loaders, no Vite and no bundling - so
 * the tree carries the exact `notFound` handles the converter stamps, and
 * `getRouteStatus()` reads the same array a real server would mount. Then a real
 * `node:http` server answers a real request for each case and a real client
 * reads the response back off the socket.
 *
 * What each case pins, over the wire and not from the library's own objects:
 *  - the numeric status Node put on the response (a `404`, never a `200` with a
 *    not-found page inside it),
 *  - that the status and `content-type` were committed before the body began
 *    streaming (the `response` event fires with the final status, and the body
 *    then arrives `transfer-encoding: chunked`),
 *  - and that `getRouteStatus()` agrees with what the wire actually said, so the
 *    package's answer and the HTTP outcome cannot drift apart.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { test, describe, before, after } from "node:test";
import React, { createElement as h } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { MemoryRouter, Outlet, useRoutes } from "react-router-dom";
import { createRouteGenerator, getRouteStatus } from "../dist/index.js";
import { useCatchAll } from "../dist/plugin-runtime.js";

// Route-file factories, mirroring the shapes the plugin's globs hand
// `createRouteGenerator`: a page and a not-found are lazy loaders, a layout an
// eager module. Bodies use `React.createElement` so no JSX runtime is needed.
const page = (name, extra) => async () => ({
  default: () => h("div", { "data-page": name }, extra ? `${name}${extra}` : name),
});
const catchAllPage = (name) => async () => ({
  default: () => h("div", { "data-page": name }, `${name}{${useCatchAll().join("|")}}`),
});
const notFound = (name) => async () => ({
  default: () => h("div", { "data-not-found": name }, `nf:${name}`),
});
const layout = (name) => ({
  default: () => h("section", { "data-layout": name }, `[${name}`, h(Outlet), `/${name}]`),
});

const PAGES = {
  "page.tsx": page("home"),
  // A required catch-all serving user content: 200 for a real path, and its bare
  // base (`/files`) guarded to a 404 by the same rule the converter applies.
  "files/[...path]/page.tsx": catchAllPage("files"),
  // A folder that owns a page *and* its own not-found, so a URL under it that
  // reaches no page is answered by the folder-level 404, not the root's.
  "dashboard/page.tsx": page("dash"),
};

const LAYOUTS = {
  "layout.tsx": layout("root"),
  "dashboard/layout.tsx": layout("dash-shell"),
};

const NOT_FOUNDS = {
  "not-found.tsx": notFound("root"),
  "dashboard/not-found.tsx": notFound("dash"),
};

// Generated once: the returned function is memoized on a per-generator lazy
// cache, and every request mounts this same array through `useRoutes`.
const routes = createRouteGenerator(PAGES, LAYOUTS, NOT_FOUNDS)();
const App = () => useRoutes(routes);

/**
 * One streamed HTTP answer for `path`, read straight off the socket.
 *
 * The status and headers are captured in the `response` event - which Node fires
 * once the status line and headers have arrived, always before the first `data`
 * chunk - so `sawHeadersBeforeBody` records the ordering the server had to
 * preserve. The body is collected from the `data` events that follow.
 */
function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let sawBody = false;
      let sawHeadersBeforeBody = false;
      const chunks = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (!sawBody) sawHeadersBeforeBody = true;
        sawBody = true;
        chunks.push(chunk);
      });
      res.on("end", () =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: chunks.join(""),
          sawHeadersBeforeBody,
        }),
      );
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * A minimal SSR server that makes the status decision the way the package
 * documents it: ask `getRouteStatus()` for the whole answer, commit the status
 * and headers with `writeHead`, and only then hand the stream to the response.
 * Nothing writes a byte before `writeHead`, and no status is touched afterwards.
 */
const server = http.createServer((req, res) => {
  const url = req.url || "/";
  // The routing decision - computed once, before the first byte. `req.url` may
  // carry a query or fragment; `getRouteStatus()` normalizes it internally.
  const status = getRouteStatus(routes, url);
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });

  const element = h(MemoryRouter, { initialEntries: [url] }, h(App));
  const { pipe, abort } = renderToPipeableStream(element, {
    // `onAllReady`: the pages arrive through `React.lazy`, so wait for every
    // boundary to settle and let the client read a complete document.
    onAllReady() {
      pipe(res);
    },
    onError(error) {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    },
  });

  // A client that gives up mid-stream must not leave the render hanging.
  res.on("close", abort);
});

let port;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});
after(() => new Promise((resolve) => server.close(resolve)));

describe("real HTTP responses carry the routing status", () => {
  // Every case is asserted three ways at once: the status on the wire, the
  // header ordering that proves the decision preceded the stream, and the
  // library's own `getRouteStatus()` agreeing with what was actually sent.
  const CASES = [
    {
      name: "an existing page returns HTTP 200",
      url: "/",
      status: 200,
      paints: ['data-page="home"'],
    },
    {
      name: "a catch-all serving user content returns HTTP 200",
      url: "/files/reports/2024/q1",
      status: 200,
      paints: ['data-page="files"', "files{reports|2024|q1}"],
    },
    {
      name: "a page that owns a folder is still 200 beside its not-found",
      url: "/dashboard",
      status: 200,
      paints: ['data-page="dash"'],
    },
    {
      name: "an unknown URL returns a real HTTP 404",
      url: "/nowhere",
      status: 404,
      paints: ['data-not-found="root"', "nf:root"],
    },
    {
      name: "a nested not-found returns HTTP 404, not the root one",
      url: "/dashboard/missing",
      status: 404,
      paints: ['data-not-found="dash"'],
      skips: ['data-not-found="root"'],
    },
    {
      name: "a required catch-all base is a guarded HTTP 404",
      url: "/files",
      status: 404,
      skips: ['data-page="files"'],
    },
    {
      name: "a query string does not change the decided status",
      url: "/nowhere?redirect=1#frag",
      status: 404,
      paints: ['data-not-found="root"'],
    },
  ];

  for (const testCase of CASES) {
    test(testCase.name, async () => {
      const response = await request(port, testCase.url);

      // The status came off the socket, and the package's decision for the same
      // URL is what produced it - the two can never disagree.
      assert.equal(
        response.statusCode,
        testCase.status,
        `${testCase.url} should return HTTP ${testCase.status}`,
      );
      assert.equal(
        getRouteStatus(routes, testCase.url),
        testCase.status,
        `getRouteStatus() must agree with the ${testCase.status} the server sent`,
      );

      // Headers were committed before the body streamed: the response event
      // delivered the final status first, and the body then arrived chunked - a
      // single buffered write with no `transfer-encoding` would mean the stream
      // never began, and a status set after streaming would have left `200`.
      assert.equal(
        response.headers["content-type"],
        "text/html; charset=utf-8",
        `${testCase.url} must set content-type before streaming`,
      );
      assert.equal(
        response.headers["transfer-encoding"],
        "chunked",
        `${testCase.url} must stream its body, not buffer it behind the status`,
      );
      assert.equal(
        response.sawHeadersBeforeBody,
        true,
        `${testCase.url} must deliver status and headers before the first chunk`,
      );

      for (const fragment of testCase.paints ?? []) {
        assert.ok(response.body.includes(fragment), `${testCase.url} did not paint "${fragment}"`);
      }
      for (const fragment of testCase.skips ?? []) {
        assert.ok(!response.body.includes(fragment), `${testCase.url} painted "${fragment}" unexpectedly`);
      }
    });
  }

  test("a page renders inside its layout while the not-found does not skip it", async () => {
    // The streamed 200 keeps the layout wrapper, and the streamed 404 keeps the
    // layout around the folder's not-found - both are complete documents whose
    // only difference is the status the server committed up front.
    const ok = await request(port, "/dashboard");
    assert.equal(ok.statusCode, 200);
    assert.ok(ok.body.includes('data-layout="root"'));
    assert.ok(ok.body.includes('data-layout="dash-shell"'));

    const missing = await request(port, "/dashboard/missing");
    assert.equal(missing.statusCode, 404);
    assert.ok(missing.body.includes('data-layout="dash-shell"'));
    assert.ok(missing.body.includes('data-not-found="dash"'));
  });
});
