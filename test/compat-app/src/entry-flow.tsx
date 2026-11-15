import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { generateRoutes } from "next-vite-router/routes";
import {
  renderResponse,
  type RenderAttempt,
  type RenderEngine,
  type RenderSink,
  type ResponseAdapter,
} from "next-vite-router/ssr";

/**
 * SSR flow-control leg of the compatibility matrix.
 *
 * `entry-server.tsx` proves a normal document paints on every React / Router / Vite
 * combination. This entry adds the two signals that change the response: a
 * `notFound()` that must become a 404 whose body is the folder fallback, and the
 * two redirect helpers that must become 307/308 with `location` and no body. It is
 * a real `renderToPipeableStream` render, not a fake engine, so the pass-2 paint
 * and the signal-through-`onShellError` mapping are exercised on both React majors.
 */

type Collected = {
  status: number;
  headers: Headers;
  body: string;
  failed: { status: number; error: unknown } | null;
};

function collector(): { adapter: ResponseAdapter; state: Collected } {
  const state: Collected = {
    status: 0,
    headers: new Headers(),
    body: "",
    failed: null,
  };

  const adapter: ResponseAdapter = {
    head(status, headers) {
      state.status = status;
      state.headers = headers;
    },
    async send(attempt) {
      await new Promise<void>((resolve, reject) => {
        const sink = new PassThrough();
        sink.setEncoding("utf8");
        sink.on("data", (chunk: string) => { state.body += chunk; });
        sink.on("finish", () => resolve());
        sink.on("error", reject);
        attempt.pipeTo(sink);
      });
    },
    abandon(attempt) {
      attempt.abort();
    },
    fail(status, error) {
      state.failed = { status, error };
    },
  };

  return { adapter, state };
}

/**
 * The Node adaptation of `RenderEngine`: the pipeable stream is returned
 * unconsumed, and each renderer callback is forwarded to the protocol. A signal
 * reported through `onShellError` settles both promises, because the protocol
 * owns the signal rather than treating the callback as a failed shell.
 */
const render: RenderEngine = (element, callbacks) => {
  let resolveShell!: () => void;
  let resolveAll!: () => void;
  const shellReady = new Promise<void>((resolve) => { resolveShell = resolve; });
  const allReady = new Promise<void>((resolve) => { resolveAll = resolve; });

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

  const attempt: RenderAttempt = {
    pipeTo(sink: RenderSink) {
      // The sink is the protocol's minimal shape; Node's pipe wants the full
      // writable contract, which the adapter's `PassThrough` satisfies.
      rendered.pipe(sink as unknown as NodeJS.WritableStream);
    },
    stream: null,
    abort() {
      rendered.abort();
    },
    shellReady,
    allReady,
  };
  return attempt;
};

async function main(): Promise<void> {
  const gone = collector();
  const gonePlan = await renderResponse({
    routes: generateRoutes(),
    url: "/gone",
    adapter: gone.adapter,
    render,
    streaming: false,
  });
  assert.equal(gonePlan.kind, "not-found");
  assert.equal(gonePlan.status, 404);
  assert.equal(gone.state.status, 404, '"/gone" must commit 404');
  assert.equal(gone.state.failed, null, '"/gone" must not be a render failure');
  assert.match(gone.state.body, /nf:gone/, '"/gone" must paint the folder fallback');
  assert.doesNotMatch(gone.state.body, /err:gone/, '"/gone" must not paint error.tsx');
  console.log("✅ notFound() commits 404 and paints the folder fallback");

  const privatePage = collector();
  const privatePlan = await renderResponse({
    routes: generateRoutes(),
    url: "/private",
    adapter: privatePage.adapter,
    render,
    streaming: false,
  });
  assert.equal(privatePlan.kind, "redirect");
  assert.equal(privatePlan.status, 307);
  assert.equal(privatePage.state.status, 307, '"/private" must commit 307');
  assert.equal(privatePage.state.headers.get("location"), "/login");
  assert.equal(privatePage.state.body, "", "a redirect sends no body");
  console.log("✅ redirect() commits 307 with location and no body");

  const permanent = collector();
  const permanentPlan = await renderResponse({
    routes: generateRoutes(),
    url: "/permanent",
    adapter: permanent.adapter,
    render,
    streaming: false,
  });
  assert.equal(permanentPlan.kind, "redirect");
  assert.equal(permanentPlan.status, 308);
  assert.equal(permanent.state.status, 308, '"/permanent" must commit 308');
  assert.equal(permanent.state.headers.get("location"), "/login");
  assert.equal(permanent.state.body, "");
  console.log("✅ permanentRedirect() commits 308 with location and no body");
}

main()
  .then(() => {
    console.log("✅ SSR flow control behaved identically on this combination");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });