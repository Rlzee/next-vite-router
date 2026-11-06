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
import { MemoryRouter, Outlet, matchRoutes, useRoutes } from "react-router-dom";
import {
  createRouteGenerator,
  getRouteStatus,
  isNotFoundRoute,
  normalizeRequestTarget,
} from "../dist/index.js";
import { useCatchAll, useParams } from "../dist/plugin-runtime.js";

// Route-file factories, mirroring the shapes the plugin's globs hand
// `createRouteGenerator`: a page and a not-found are lazy loaders, a layout an
// eager module. Bodies use `React.createElement` so no JSX runtime is needed.
const page = (name, extra) => async () => ({
  default: () => h("div", { "data-page": name }, extra ? `${name}${extra}` : name),
});
const pageWithId = (name) => async () => ({
  default: () => h("div", { "data-page": name }, `${name}:${useParams().id ?? "?"}`),
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
  // A single dynamic segment, so a target whose escapes no decoder can read is
  // answered by a page of the app and not refused - see the parity block below.
  "users/[id]/page.tsx": pageWithId("user"),
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
  // One reading, used twice: the pathname the package normalizes is what the
  // status is decided on *and* what the router mounts. Handing `req.url` to the
  // router instead would stream a not-found page under a committed `200` for a
  // target carrying dot segments - the case pinned below.
  const pathname = normalizeRequestTarget(req.url || "/");
  const status = getRouteStatus(routes, pathname);
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });

  const element = h(MemoryRouter, { initialEntries: [pathname] }, h(App));
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

/**
 * The SSR half of the URL differential, for the targets no browser can be sent
 * to through Vite.
 *
 * `test/browser/url-parity.spec.js` collides `normalizeRequestTarget()`,
 * Chromium's `location.pathname` and the painted page. It cannot cover a path
 * whose own escape survives to the request line: Vite's dev middleware and its
 * preview static handler both decode the whole URL and answer 500 before an
 * application exists to render anything. A server that owns its socket - the one
 * this package's status helper is written for - never does, because Node hands
 * `req.url` over raw. So the three readings that have to agree here are the
 * normalizer's pathname, the committed status, and the document that came back
 * down the wire: a `200` whose body is a page, a `404` whose body is the
 * not-found, and never one wearing the other's status.
 */
describe("one request target, read three ways on the server", () => {
  const CASES = [
    {
      // A malformed escape, kept verbatim by the page that owns the path.
      name: "an undecodable escape still reaches its page",
      url: "/users/%FF",
      pathname: "/users/%FF",
      status: 200,
      paints: ['data-page="user"', "user:%FF"],
    },
    {
      name: "valid hex that is not valid UTF-8 is the same case",
      url: "/users/%C0%AF",
      pathname: "/users/%C0%AF",
      status: 200,
      paints: ['data-page="user"'],
    },
    {
      name: "a half-written escape is the same case",
      url: "/users/%zz",
      pathname: "/users/%zz",
      status: 200,
      paints: ['data-page="user"'],
    },
    {
      // The hand-resolved branch: one broken escape must not change how the
      // neighbouring segments are read.
      name: "a dot segment beside a broken escape still pops",
      url: "/users/other/../%FF",
      pathname: "/users/%FF",
      status: 200,
      paints: ['data-page="user"', "user:%FF"],
    },
    {
      name: "an encoded slash stays one segment, and decodes inside the param",
      url: "/users/a%2Fb",
      pathname: "/users/a%2Fb",
      status: 200,
      paints: ['data-page="user"', "user:a/b"],
    },
    {
      // A trailing dot segment leaves its slash behind, and the escape is not
      // what decides that - so the catch-all below its base still has content.
      name: "a dot at the end of an undecodable path leaves the slash",
      url: "/files/%FF/.",
      pathname: "/files/%FF/",
      status: 200,
      paints: ['data-page="files"', "files{%FF}"],
    },
    {
      name: "a dot popping back to a required catch-all base is its guarded 404",
      url: "/files/%FF/..",
      pathname: "/files/",
      status: 404,
      paints: ['data-not-found="root"'],
      skips: ['data-page="files"'],
    },
    {
      name: "an encoded double dot popping out of the folder answers 404",
      url: "/users/%2e%2e/x",
      pathname: "/x",
      status: 404,
      paints: ['data-not-found="root"'],
      skips: ['data-page="user"'],
    },
  ];

  for (const testCase of CASES) {
    test(testCase.name, async () => {
      // Reading 1: the pathname the package's own server-side reading produces.
      assert.equal(normalizeRequestTarget(testCase.url), testCase.pathname);
      // Reading 2: the status that reading decides, before the socket is involved.
      assert.equal(getRouteStatus(routes, testCase.url), testCase.status);
      // Reading 3: what actually came back down the wire.
      const response = await request(port, testCase.url);
      assert.equal(response.statusCode, testCase.status, `${testCase.url} status on the wire`);

      for (const fragment of testCase.paints ?? []) {
        assert.ok(response.body.includes(fragment), `${testCase.url} did not paint "${fragment}"`);
      }
      for (const fragment of testCase.skips ?? []) {
        assert.ok(!response.body.includes(fragment), `${testCase.url} painted "${fragment}" unexpectedly`);
      }
    });
  }

  test("the router has to be handed the reading the status was decided on", () => {
    // The reason the server above normalizes once and uses that value twice.
    // `matchRoutes()` does not resolve dot segments - a browser has already done
    // that before anything goes on the wire, so the client router never sees the
    // raw form. Hand it `req.url` anyway (a proxy forwarding one, a hand-written
    // client) and the two halves of one response disagree: the package's reading
    // calls the URL a page, while the router the document is rendered with finds
    // only a not-found leaf. That is a status lying about its own body, and it
    // reaches the reader as a 200 whose page is a 404 - after hydration too,
    // because hydration mounts the pathname the browser itself resolved.
    const raw = "/users/other/../%FF";

    assert.equal(getRouteStatus(routes, raw), 200, "the package's reading resolves the dots");
    assert.equal(normalizeRequestTarget(raw), "/users/%FF");

    const rawLeaf = matchRoutes(routes, raw)?.at(-1)?.route;
    assert.ok(rawLeaf, "a generated tree answers every URL, the raw one included");
    assert.ok(
      isNotFoundRoute(rawLeaf),
      "the raw target, fed to the router as it came, reaches a not-found leaf",
    );

    const readLeaf = matchRoutes(routes, normalizeRequestTarget(raw))?.at(-1)?.route;
    assert.ok(readLeaf, "the normalized target must match too");
    assert.ok(
      !isNotFoundRoute(readLeaf),
      "the same URL through the package's reading reaches the page",
    );
  });
});
