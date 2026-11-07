import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Outlet, useParams } from "react-router-dom";
import {
  planResponse,
  prepareRequest,
  renderApp,
  renderResponse,
} from "../dist/ssr.js";
import {
  createRenderOutcome,
  NotFoundSignal,
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
      routes: [],
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

  test("keeps status 200 for a signal reported after shell", async () => {
    let sent = 0;
    let reportLateSignal;
    const result = await renderResponse({
      routes: [],
      url: "/late",
      adapter: {
        head(status) {
          assert.equal(status, 200);
        },
        send() {
          sent += 1;
        },
        abandon() {},
      },
      render(_element, callbacks) {
        callbacks.onShellReady();
        reportLateSignal = () => callbacks.onError(new NotFoundSignal("/late"));
        return attempt();
      },
    });

    reportLateSignal();
    assert.equal(result.kind, "page");
    assert.equal(result.status, 200);
    assert.equal(sent, 1);
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
      routes: [],
      url: "/web",
      adapter: {
        head() {},
        send(received) {
          assert.equal(received.stream, stream);
          assert.equal(stream.locked, false);
          consumed = true;
        },
        abandon() {},
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
    await assert.rejects(() => renderResponse({
      routes: [],
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
    }));
    assert.equal(aborted, 1);
    assert.equal(sent, 0);
    assert.equal(failed.status, 500);
  });

  test("does not send after onShellError", async () => {
    let aborted = 0;
    let sent = 0;
    await assert.rejects(() => renderResponse({
      routes: [],
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
    }));
    assert.equal(aborted, 1);
    assert.equal(sent, 0);
  });

  test("aborts when allReady rejects in non-streaming mode", async () => {
    let aborted = 0;
    let sent = 0;
    await assert.rejects(() => renderResponse({
      routes: [],
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
    }));
    assert.equal(aborted, 1);
    assert.equal(sent, 0);
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
