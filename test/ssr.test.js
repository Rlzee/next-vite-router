import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import {
  planResponse,
  prepareRequest,
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

  test("SSR bundle has no react-router-dom dependency", () => {
    const bundle = fs.readFileSync(new URL("../dist/ssr.js", import.meta.url), "utf8");
    assert.equal(bundle.includes("react-router-dom"), false);
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
        return attempt();
      },
    });

    assert.equal(plan.pass, 3);
    assert.equal(renders, 3);
    assert.deepEqual(events, ["abandon", "abandon", "head:404", "send"]);
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
      callbacks.onError(new NotFoundSignal("/" + events.length));
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
