import assert from "node:assert/strict";
import fs from "node:fs";
import { PassThrough } from "node:stream";
import React from "react";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { Outlet, useParams } from "react-router-dom";
import { buildRouteTree, treeToRoutes } from "../dist/index.js";
import {
  planResponse,
  prepareRequest,
  renderApp,
  renderResponse,
} from "../dist/ssr.js";
import {
  createRenderOutcome,
  NotFoundSignal,
  RedirectSignal,
  notFound,
  permanentRedirect,
  redirect,
} from "../dist/plugin-runtime.js";

const request = (url = "/") => createRenderOutcome(prepareRequest(url));

describe("SSR request preparation", () => {
  test("normalizes pathname and preserves query and fragment", () => {
    assert.deepEqual(prepareRequest("/users/../search?q=one#results"), {
      pathname: "/search",
      search: "?q=one",
      hash: "#results",
    });
  });

  test("handles absolute request targets", () => {
    assert.deepEqual(prepareRequest("https://example.test/a?x=1#top"), {
      pathname: "/a",
      search: "?x=1",
      hash: "#top",
    });
  });
});

describe("SSR response planning", () => {
  test("plans a normal page with cloned application headers", () => {
    const headers = new Headers({ "x-app": "yes" });
    const plan = planResponse(request(), { headers });
    assert.equal(plan.kind, "page");
    assert.equal(plan.status, 200);
    assert.equal(plan.headers.get("x-app"), "yes");
    headers.set("x-app", "changed");
    assert.equal(plan.headers.get("x-app"), "yes");
  });

  test("plans pre-flight and rendered not-found responses", () => {
    const preflight = planResponse(request("/missing"), { preFlight: 404 });
    assert.equal(preflight.kind, "not-found");
    assert.equal(preflight.pass, 1);
    assert.equal(preflight.headers.get("x-robots-tag"), "noindex");

    const outcome = request("/page");
    outcome.recordSignal({ kind: "not-found", owner: "/shop", reentrant: false }, "page");
    const discovered = planResponse(outcome);
    assert.equal(discovered.status, 404);
    assert.equal(discovered.pass, 2);
    assert.equal(discovered.forceOwner, "/shop");
  });

  test("plans bounded fallback escalation", () => {
    const outcome = request();
    outcome.recordSignal({ kind: "not-found", owner: "/shop", reentrant: false }, "page");
    outcome.recordSignal({ kind: "not-found", owner: "/", reentrant: true }, "fallback");
    const plan = planResponse(outcome, { preFlight: 404 });
    assert.equal(plan.kind, "not-found");
    assert.equal(plan.pass, 3);
    assert.equal(plan.forceOwner, "/");
  });

  test("does not preserve application location on non-redirect responses", () => {
    const headers = new Headers({ location: "/stale", "x-app": "yes" });
    const page = planResponse(request(), { headers });
    assert.equal(page.headers.has("location"), false);

    const notFound = planResponse(request(), { headers, preFlight: 404 });
    assert.equal(notFound.headers.has("location"), false);

    const failure = request();
    failure.recordFailure(new Error("broken"), 1);
    const error = planResponse(failure, { headers });
    assert.equal(error.headers.has("location"), false);
  });

  test("SSR bundle includes React Router route resolution", () => {
    const bundle = fs.readFileSync(new URL("../dist/ssr.js", import.meta.url), "utf8");
    assert.equal(bundle.includes("useRoutes"), true);
  });

  test("resolves only the route branch matching the request", () => {
    function Layout() {
      return React.createElement("main", null, React.createElement(Outlet));
    }
    function Page() {
      return React.createElement("p", null, useParams().id);
    }
    const outcome = request("/users/42");
    const html = renderToStaticMarkup(renderApp([
      {
        path: "/",
        element: React.createElement(Layout),
        children: [{
          path: "users/:id",
          element: React.createElement(Page),
        }],
      },
      {
        path: "/other",
        element: React.createElement("aside", null, "wrong"),
      },
    ], {
      outcome,
      plan: planResponse(outcome),
    }));
    assert.equal(html, "<main><p>42</p></main>");
  });

  test("plans redirects and preserves application cache policy", () => {
    const outcome = request();
    outcome.recordSignal({
      kind: "redirect",
      to: "/login",
      permanent: false,
      replace: true,
    }, "page");
    const plan = planResponse(outcome, {
      headers: new Headers({ "cache-control": "max-age=60" }),
    });
    assert.equal(plan.kind, "redirect");
    assert.equal(plan.status, 307);
    assert.equal(plan.headers.get("location"), "/login");
    assert.equal(plan.headers.get("cache-control"), "max-age=60");
  });

  test("plans ordinary failures as 500 before commit and 200 after commit", () => {
    const before = request();
    before.recordFailure(new Error("broken"), 1);
    assert.equal(planResponse(before).status, 500);

    const after = request();
    after.markCommitted();
    after.recordFailure(new Error("late"), 1);
    const plan = planResponse(after);
    assert.equal(plan.kind, "error");
    assert.equal(plan.status, 200);
    assert.equal(plan.degraded, true);
  });
});

describe("SSR response orchestration", () => {
  const pageRoutes = [{ path: "*", element: React.createElement("main") }];

  function attempt() {
    return {
      stream: null,
      pipeTo() {},
      abort() {},
      shellReady: Promise.resolve(),
      allReady: Promise.resolve(),
    };
  }

  test("abandons intermediate passes before committing headers or content", async () => {
    const events = [];
    let renders = 0;
    const adapter = {
      head(status) {
        events.push(`head:${status}`);
      },
      send() {
        events.push("send");
      },
      abandon() {
        events.push("abandon");
      },
      fail() {},
    };
    const aborted = [];
    const plan = await renderResponse({
      routes: [],
      url: "/missing",
      adapter,
      render(_element, callbacks) {
        renders += 1;
        if (renders === 1) {
          callbacks.onError(new NotFoundSignal("/shop"));
        } else if (renders === 2) {
          callbacks.onError(new NotFoundSignal("/", true));
        }
        callbacks.onShellReady();
        return {
          ...attempt(),
          abort() {
            aborted.push(renders);
          },
        };
      },
    });

    assert.equal(plan.pass, 3);
    assert.equal(renders, 3);
    assert.deepEqual(events, ["abandon", "abandon", "head:404", "send"]);
    assert.deepEqual(aborted, [1, 2]);
  });

  test("streaming commits after shell without waiting for allReady", async () => {
    let resolveAllReady;
    const allReady = new Promise((resolve) => {
      resolveAllReady = resolve;
    });
    const events = [];
    const result = await renderResponse({
      routes: pageRoutes,
      url: "/",
      adapter: {
        head() {
          events.push("head");
        },
        send() {
          events.push("send");
        },
        abandon() {
          events.push("abandon");
        },
        fail() {},
      },
      render(_element, callbacks) {
        callbacks.onShellReady();
        return { ...attempt(), allReady };
      },
    });

    assert.equal(result.kind, "page");
    assert.deepEqual(events, ["head", "send"]);
    resolveAllReady();
  });

  test("keeps pre-commit signals effective after shell", async () => {
    let sent = 0;
    const result = await renderResponse({
      routes: [],
      url: "/late",
      adapter: {
        head(status) {
          assert.equal(status, 404);
        },
        send() {
          sent += 1;
        },
        abandon() {},
        fail() {},
      },
      render(_element, callbacks) {
        callbacks.onShellReady();
        queueMicrotask(() => callbacks.onError(new NotFoundSignal("/late")));
        return attempt();
      },
    });

    assert.equal(result.kind, "not-found");
    assert.equal(result.status, 404);
    assert.equal(sent, 1);
  });

  test("does not change status after adapter.head commits", async () => {
    let reportLateSignal;
    const result = await renderResponse({
      routes: pageRoutes,
      url: "/committed",
      adapter: {
        head(status) {
          assert.equal(status, 200);
        },
        send() {
          reportLateSignal();
        },
        abandon() {},
        fail() {},
      },
      render(_element, callbacks) {
        callbacks.onShellReady();
        reportLateSignal = () => callbacks.onError(new NotFoundSignal("/committed"));
        return attempt();
      },
    });

    assert.equal(result.kind, "page");
    assert.equal(result.status, 200);
  });

  test("does not consume a Web stream before the adapter sends it", async () => {
    let consumed = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("html"));
        controller.close();
      },
    });
    await renderResponse({
      routes: pageRoutes,
      url: "/web",
      adapter: {
        head() {},
        send(received) {
          assert.equal(received.stream, stream);
          assert.equal(stream.locked, false);
          consumed = true;
        },
        abandon() {},
        fail() {},
      },
      render(_element, callbacks) {
        callbacks.onShellReady();
        return { ...attempt(), stream };
      },
    });
    assert.equal(consumed, true);
    assert.equal(stream.locked, false);
  });

  test("does not send a timed-out shell", async () => {
    let aborted = 0;
    let sent = 0;
    let failed;
    const result = await renderResponse({
      routes: pageRoutes,
      url: "/slow",
      shellTimeoutMs: 1,
      adapter: {
        head() {},
        send() {
          sent += 1;
        },
        abandon() {},
        fail(status, error) {
          failed = { status, error };
        },
      },
      render() {
        return {
          ...attempt(),
          shellReady: new Promise(() => {}),
          abort() {
            aborted += 1;
          },
        };
      },
    });
    assert.equal(result.kind, "error");
    assert.equal(result.status, 500);
    assert.equal(aborted, 1);
    assert.equal(sent, 0);
    assert.equal(failed.status, 500);
  });

  test("does not send after onShellError", async () => {
    let aborted = 0;
    let sent = 0;
    const result = await renderResponse({
      routes: pageRoutes,
      url: "/broken",
      adapter: {
        head() {},
        send() {
          sent += 1;
        },
        abandon() {},
        fail(status) {
          assert.equal(status, 500);
        },
      },
      render(_element, callbacks) {
        const error = new Error("shell failed");
        callbacks.onShellError(error);
        return {
          ...attempt(),
          abort() {
            aborted += 1;
          },
        };
      },
    });
    assert.equal(result.kind, "error");
    assert.equal(result.status, 500);
    assert.equal(aborted, 1);
    assert.equal(sent, 0);
  });

  test("does not send a failed stream reported after onShellReady", async () => {
    let aborted = 0;
    let sent = 0;
    let failed;
    const result = await renderResponse({
      routes: pageRoutes,
      url: "/broken-after-shell",
      adapter: {
        head() { assert.fail("an error plan must not commit normal headers"); },
        send() { sent += 1; },
        abandon() {},
        fail(status, error) { failed = { status, error }; },
      },
      render(_element, callbacks) {
        callbacks.onShellReady();
        callbacks.onError(new Error("render failed after shell ready"));
        return {
          ...attempt(),
          abort() { aborted += 1; },
        };
      },
    });

    assert.equal(result.kind, "error");
    assert.equal(result.status, 500);
    assert.equal(aborted, 1);
    assert.equal(sent, 0);
    assert.equal(failed.status, 500);
  });

  test("aborts when allReady rejects in non-streaming mode", async () => {
    let aborted = 0;
    let sent = 0;
    const result = await renderResponse({
      routes: pageRoutes,
      url: "/prerender",
      streaming: false,
      adapter: {
        head() {},
        send() {
          sent += 1;
        },
        abandon() {},
        fail() {},
      },
      render(_element, callbacks) {
        callbacks.onShellReady();
        return {
          ...attempt(),
          allReady: Promise.reject(new Error("late render failure")),
          abort() {
            aborted += 1;
          },
        };
      },
    });
    assert.equal(result.kind, "error");
    assert.equal(result.status, 500);
    assert.equal(aborted, 1);
    assert.equal(sent, 0);
  });

  test("commits a pre-flight 404 when no page route matches", async () => {
    const result = await renderResponse({
      routes: [],
      url: "/missing",
      adapter: {
        head(status) { assert.equal(status, 404); },
        send() {},
        abandon() {},
        fail() {},
      },
      render(_element, callbacks) {
        callbacks.onShellReady();
        return attempt();
      },
    });

    assert.equal(result.kind, "not-found");
    assert.equal(result.pass, 1);
  });

  test("returns the pass-3 error instead of retaining its reentrant not-found", async () => {
    let renders = 0;
    const result = await renderResponse({
      routes: pageRoutes,
      url: "/fallback",
      adapter: {
        head(status) { assert.equal(status, 500); },
        send() {},
        abandon() {},
        fail() {},
      },
      render(_element, callbacks) {
        renders += 1;
        if (renders === 1) callbacks.onError(new NotFoundSignal("/shop"));
        if (renders === 2) callbacks.onError(new NotFoundSignal("/", true));
        if (renders === 3) callbacks.onError(new Error("pass 3 failed"));
        callbacks.onShellReady();
        return attempt();
      },
    });

    assert.equal(renders, 3);
    assert.equal(result.kind, "error");
    assert.equal(result.pass, 3);
    assert.equal(result.status, 500);
  });

  test("commits a fallback redirect without scheduling pass 3", async () => {
    let renders = 0;
    const result = await renderResponse({
      routes: pageRoutes,
      url: "/fallback",
      adapter: {
        head(status, headers) {
          assert.equal(status, 307);
          assert.equal(headers.get("location"), "/login");
        },
        send() { assert.fail("a redirect must not send a body"); },
        abandon() {},
        fail() {},
      },
      render(_element, callbacks) {
        renders += 1;
        if (renders === 1) callbacks.onError(new NotFoundSignal("/shop"));
        if (renders === 2) callbacks.onError(new RedirectSignal("/login", false, false));
        callbacks.onShellReady();
        return attempt();
      },
    });

    assert.equal(renders, 2);
    assert.equal(result.kind, "redirect");
  });

  test("keeps outcomes isolated across concurrent requests", async () => {
    const events = [];
    const makeAdapter = (name) => ({
      head(status) {
        events.push(`${name}:head:${status}`);
      },
      send() {
        events.push(`${name}:send`);
      },
      abandon() {
        events.push(`${name}:abandon`);
      },
      fail() {},
    });
    const render = async (_element, callbacks) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      callbacks.onError(new NotFoundSignal("/request"));
      callbacks.onShellReady();
      return attempt();
    };

    await Promise.all([
      renderResponse({
        routes: [],
        url: "/one",
        adapter: makeAdapter("one"),
        render,
      }),
      renderResponse({
        routes: [],
        url: "/two",
        adapter: makeAdapter("two"),
        render,
      }),
    ]);

    assert.equal(events.filter((event) => event.endsWith(":head:404")).length, 2);
    assert.equal(events.filter((event) => event.endsWith(":send")).length, 2);
  });
});

describe("SSR flow control with a real React render", () => {
  const component = (name) => function Component() {
    return React.createElement("div", null, name);
  };

  const routesFor = (records) => treeToRoutes(buildRouteTree(records), true);

  function collector() {
    let status = 0;
    let headers = new Headers();
    let body = "";
    let failed = null;
    return {
      head(nextStatus, nextHeaders) {
        status = nextStatus;
        headers = nextHeaders;
      },
      async send(attempt) {
        await new Promise((resolve, reject) => {
          const sink = new PassThrough();
          sink.setEncoding("utf8");
          sink.on("data", (chunk) => { body += chunk; });
          sink.on("finish", resolve);
          sink.on("error", reject);
          attempt.pipeTo(sink);
        });
      },
      abandon(attempt) {
        attempt.abort();
      },
      fail(nextStatus, error) {
        failed = { status: nextStatus, error };
      },
      get status() { return status; },
      get headers() { return headers; },
      get body() { return body; },
      get failed() { return failed; },
    };
  }

  /**
   * The Node engine the package's `RenderEngine` describes: `renderToPipeableStream`
   * buffers until `pipe()`, and the callbacks are forwarded verbatim. A signal in
   * the shell is resolved, not rejected, because the protocol owns it (the same
   * mapping `createAttempt` applies to `onShellError`).
   */
  function nodeEngine(element, callbacks) {
    let pipe;
    let abort;
    let resolveShell;
    let resolveAll;
    const shellReady = new Promise((resolve) => { resolveShell = resolve; });
    const allReady = new Promise((resolve) => { resolveAll = resolve; });
    const rendered = renderToPipeableStream(element, {
      onShellReady() {
        callbacks.onShellReady();
        resolveShell();
      },
      onAllReady() {
        callbacks.onAllReady();
        resolveAll();
      },
      onShellError(error) {
        callbacks.onShellError(error);
        resolveShell();
        resolveAll();
      },
      onError(error) {
        callbacks.onError(error);
      },
    });
    pipe = rendered.pipe;
    abort = rendered.abort;
    return {
      pipeTo(sink) { pipe(sink); },
      stream: null,
      abort() { abort(); },
      shellReady,
      allReady,
    };
  }

  test("a notFound() renders the owning fallback in a second pass", async () => {
    function Gone() {
      notFound();
    }
    const routes = routesFor({
      pages: { "gone/page.tsx": async () => ({ default: Gone }) },
      notFounds: { "gone/not-found.tsx": async () => ({ default: component("GONE-NOT-FOUND") }) },
    });
    const adapter = collector();

    const plan = await renderResponse({
      routes,
      url: "/gone",
      adapter,
      render: nodeEngine,
      streaming: false,
    });

    assert.equal(plan.kind, "not-found");
    assert.equal(plan.status, 404);
    assert.equal(plan.pass, 2);
    assert.equal(adapter.status, 404);
    assert.equal(adapter.failed, null);
    assert.match(adapter.body, /GONE-NOT-FOUND/);
  });

  test("a notFound() without a file fallback renders the built-in 404", async () => {
    function Missing() {
      notFound();
    }
    const routes = routesFor({
      pages: { "missing/page.tsx": async () => ({ default: Missing }) },
    });
    const adapter = collector();

    const plan = await renderResponse({
      routes,
      url: "/missing",
      adapter,
      render: nodeEngine,
      streaming: false,
    });

    assert.equal(plan.kind, "not-found");
    assert.equal(plan.status, 404);
    assert.match(adapter.body, /This page could not be found/);
  });

  test("a redirect signal commits 307 with location and no body", async () => {
    function Private() {
      redirect("/login");
    }
    const routes = routesFor({
      pages: { "private/page.tsx": async () => ({ default: Private }) },
    });
    const adapter = collector();

    const plan = await renderResponse({
      routes,
      url: "/private",
      adapter,
      render: nodeEngine,
      streaming: false,
    });

    assert.equal(plan.kind, "redirect");
    assert.equal(plan.status, 307);
    assert.equal(adapter.status, 307);
    assert.equal(adapter.headers.get("location"), "/login");
    assert.equal(adapter.body, "");
  });

  test("a permanent redirect commits 308", async () => {
    function Old() {
      permanentRedirect("/new", { replace: true });
    }
    const routes = routesFor({
      pages: { "old/page.tsx": async () => ({ default: Old }) },
    });
    const adapter = collector();

    const plan = await renderResponse({
      routes,
      url: "/old",
      adapter,
      render: nodeEngine,
      streaming: false,
    });

    assert.equal(plan.kind, "redirect");
    assert.equal(plan.status, 308);
    assert.equal(adapter.status, 308);
    assert.equal(adapter.headers.get("location"), "/new");
    assert.equal(adapter.body, "");
  });
});
