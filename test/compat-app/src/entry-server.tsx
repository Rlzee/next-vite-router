import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createElement as h } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Router, generateRoutes, useRoutes } from "next-vite-router/routes";

/**
 * Render smoke test for the compatibility matrix.
 *
 * `vite build` alone only proves the module the plugin generates *compiles* for a
 * given React / React Router / Vite combination. This entry is bundled with
 * `vite build --ssr` and then executed by `node`, so every combination has to
 * paint the route tree for real: the eager layouts wrapping lazily imported
 * pages, streamed through `renderToPipeableStream`, plus the generated
 * `href` / `Link` / `useParams` / `useCatchAll` behaviour the package promises
 * identically on React Router 6 and 7.
 *
 * Reproduce one combination locally: copy `test/compat-app` somewhere with the
 * `next-vite-router` tarball installed (`pnpm pack`), then
 * `pnpm exec vite build --ssr src/entry-server.tsx --outDir dist-ssr` and
 * `node dist-ssr/entry-server.*`.
 */

/**
 * Both public ways to mount the tree are rendered: the `Router` component the
 * CLI scaffolds, and the lower-level `useRoutes(generateRoutes())` pair for apps
 * that build their own element.
 */
function RoutesApp() {
  const routes = useRoutes(generateRoutes());
  return routes;
}

type RenderCase = {
  url: string;
  /** Which public mount style answers this URL. Defaults to `Router`. */
  via?: "router" | "routes";
  /** Fragments the streamed document must contain. */
  paints: string[];
  /** Fragments it must not contain. */
  skips?: string[];
  /** Fragments that must appear in exactly this order. */
  order?: string[];
};

const RENDER_CASES: RenderCase[] = [
  {
    url: "/",
    paints: [
      'data-layout="root"',
      'data-page="home"',
      // The generated `Link`/`href`: a `:name` param filled verbatim, and a
      // catch-all array percent-encoded per segment, the same on both majors.
      'href="/users/7"',
      'href="/blog/a%20b/c%3Fd"',
      // An optional catch-all resolves to its base path.
      'data-href="/docs"',
    ],
    order: ["[root", "home", "/root]"],
  },
  {
    url: "/help",
    // A route group stays out of the URL while keeping the root layout.
    paints: ['data-layout="root"', 'data-page="help"'],
    order: ["[root", "help", "/root]"],
  },
  {
    url: "/users",
    paints: ['data-layout="root"', 'data-layout="users"', 'data-page="list"'],
    order: ["[root", "[users", "list", "/users]", "/root]"],
  },
  {
    url: "/users/42",
    paints: ['data-page="detail"', "detail:42"],
    order: ["[root", "[users", "detail:42", "/users]", "/root]"],
  },
  {
    url: "/users/42",
    via: "routes",
    // The same tree answered by `useRoutes(generateRoutes())`, so a difference
    // between the two public mount styles cannot hide.
    paints: ['data-page="detail"', "detail:42"],
    order: ["[root", "[users", "detail:42", "/users]", "/root]"],
  },
  {
    url: "/blog/guide/api",
    paints: ['data-page="blog"', "blog{guide|api}"],
  },
  {
    url: "/blog/guide/api/",
    // A trailing slash is dropped by `useCatchAll`, so the page reads the same
    // segments React Router reports as the raw splat `guide/api/`.
    paints: ["blog{guide|api}"],
  },
  {
    url: "/blog",
    // A required catch-all never matches its base URL: the nearest not-found
    // answers, and the page is never invoked with an empty catch-all.
    paints: ['data-not-found="root"'],
    skips: ['data-page="blog"'],
    order: ["[root", "nf:root", "/root]"],
  },
  {
    url: "/docs",
    paints: ['data-page="docs"', "docs{}"],
  },
  {
    url: "/docs/guide/api",
    paints: ['data-page="docs"', "docs{guide|api}"],
  },
  {
    url: "/nowhere",
    paints: ['data-not-found="root"'],
    skips: ['data-page="home"', 'data-page="blog"'],
  },
];

const STREAM_TIMEOUT_MS = 30_000;

/**
 * Stream one render case to a string.
 *
 * `onAllReady` rather than `onShellReady`: the pages arrive through
 * `React.lazy`, so waiting for every boundary to settle makes the assertion
 * about what the request eventually paints instead of its loading shell.
 */
function renderStreamed({ url, via = "router" }: RenderCase): Promise<string> {
  return new Promise((resolve, reject) => {
    const app = via === "routes" ? h(RoutesApp) : h(Router);
    const element = h(MemoryRouter, { initialEntries: [url] }, app);
    let pending: ReturnType<typeof setTimeout> | undefined;

    const fail = (error: unknown) => {
      if (pending) clearTimeout(pending);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const { pipe, abort } = renderToPipeableStream(element, {
      onAllReady() {
        const chunks: string[] = [];
        const sink = new PassThrough();
        sink.setEncoding("utf8");
        sink.on("data", (chunk: string) => chunks.push(chunk));
        sink.on("error", fail);
        sink.on("finish", () => {
          if (pending) clearTimeout(pending);
          resolve(chunks.join(""));
        });
        pipe(sink);
      },
      onError: fail,
      // Deliberately no `onAbort`: React 18 does not accept that option (only
      // React 19 added it), and every abort this file performs has already
      // rejected through `fail`.
    });

    // A boundary that never resolves would leave the promise pending forever,
    // which in CI is a hung job rather than a failed one.
    pending = setTimeout(() => {
      fail(new Error(`Rendering "${url}" did not finish within ${STREAM_TIMEOUT_MS}ms`));
      abort();
    }, STREAM_TIMEOUT_MS);
  });
}

function assertRendered({ url, paints, skips, order }: RenderCase, html: string): void {
  for (const fragment of paints) {
    assert.ok(html.includes(fragment), `"${url}" did not paint "${fragment}"`);
  }
  for (const fragment of skips ?? []) {
    assert.ok(!html.includes(fragment), `"${url}" painted "${fragment}" unexpectedly`);
  }
  if (!order) return;

  const positions = order.map((fragment) => ({ fragment, index: html.indexOf(fragment) }));
  for (const { fragment, index } of positions) {
    assert.notEqual(index, -1, `"${url}" is missing "${fragment}"`);
  }
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1];
    const current = positions[index];
    assert.ok(
      previous.index < current.index,
      `"${url}" expected "${previous.fragment}" before "${current.fragment}"`,
    );
  }
}

/** Identify a case in the log; the same URL is rendered by both mount styles. */
function caseLabel({ url, via = "router" }: RenderCase): string {
  return `${url} [${via === "routes" ? "useRoutes(generateRoutes())" : "Router"}]`;
}

async function main(): Promise<void> {
  for (const renderCase of RENDER_CASES) {
    const label = caseLabel(renderCase);
    let html: string;
    try {
      html = await renderStreamed(renderCase);
    } catch (error) {
      console.error(`❌ ${label} failed to stream`);
      throw error;
    }
    try {
      assertRendered(renderCase, html);
    } catch (error) {
      console.error(`--- streamed html for ${label} ---\n${html}`);
      throw error;
    }
    console.log(`✅ streamed ${label}`);
  }
}

// No top-level await: depending on the Vite version and the application package
// type, this entry is emitted as `.js`, `.mjs`, or `.cjs`, and module-scope
// `await` cannot be bundled into the CommonJS form.
main()
  .then(() => {
    console.log(`✅ ${RENDER_CASES.length} documents streamed and asserted`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
