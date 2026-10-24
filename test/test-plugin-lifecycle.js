import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nextViteRouter } from "../dist/plugin.js";

const RESOLVED_VIRTUAL_ID = "\u0000next-vite-router/routes";

// Let any macro-task the plugin scheduled (the debounced `setTimeout(..., 0)`
// full reload) run. The plugin's timer is always queued before the test calls
// `tick()`, so its callback fires first, then this resolves.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeProject(pagesDir, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nvr-plugin-"));
  for (const rel of files) {
    const full = path.join(root, ...pagesDir.split("/"), ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "");
  }
  return root;
}

// Builds a throwaway project plus a fake Vite dev server wired exactly the way
// the plugin expects: `configResolved` seeds the pages root and the first
// declaration write, `configureServer` attaches the add/unlink/close watcher
// handlers. Files are touched on the real filesystem before each watcher event
// so `collectPageFiles` re-scans the same state a real editor save would.
function createContext({ pagesDir = "src/app", initialFiles = [] } = {}) {
  const root = makeProject(pagesDir, initialFiles);
  const appRoot = path.join(root, ...pagesDir.split("/"));
  // The declaration is written next to the pages directory: dirname(<pagesRoot>).
  const declarationPath = path.join(root, ...pagesDir.split("/").slice(0, -1), "virtual-next-vite-router.d.ts");

  const plugin = nextViteRouter({ pagesDir });
  plugin.configResolved({ root });

  const state = { reloads: [], errors: [], invalidations: 0 };
  const watcher = new EventEmitter();
  const server = {
    watcher,
    moduleGraph: {
      getModuleById: (id) => (id === RESOLVED_VIRTUAL_ID ? { id } : undefined),
      invalidateModule: () => {
        state.invalidations += 1;
      },
    },
    ws: { send: (payload) => state.reloads.push(payload) },
    config: {
      logger: {
        error: (message) => state.errors.push(String(message)),
        warn: () => {},
      },
    },
  };
  plugin.configureServer(server);

  const touch = (rel) => path.join(appRoot, ...rel.split("/"));
  const add = (rel) => {
    const full = touch(rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "");
    watcher.emit("add", full);
  };
  const unlink = (rel) => {
    const full = touch(rel);
    fs.rmSync(full, { force: true });
    watcher.emit("unlink", full);
  };
  const declaration = () => fs.readFileSync(declarationPath, "utf8");

  return {
    reloads: state.reloads,
    errors: state.errors,
    get invalidations() {
      return state.invalidations;
    },
    add,
    unlink,
    declaration,
    close: () => watcher.emit("close"),
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("vite plugin dev-server lifecycle", () => {
  test("adds a page in an already-existing folder and reloads", async () => {
    const ctx = createContext({ initialFiles: ["page.tsx", "users/page.tsx"] });
    try {
      ctx.add("users/profile/page.tsx");

      // Structural change: the virtual module is invalidated and a single
      // debounced full reload is scheduled.
      assert.equal(ctx.invalidations, 1);
      assert.equal(ctx.reloads.length, 0, "reload is deferred to the next tick");

      await tick();
      assert.equal(ctx.reloads.length, 1);
      assert.deepEqual(ctx.reloads[0], { type: "full-reload", path: "*" });

      // Generated types stay in sync with the new route.
      assert.match(ctx.declaration(), /\| "\/users\/profile"/);
    } finally {
      ctx.dispose();
    }
  });

  test("deletes a page and drops it from the generated types", async () => {
    const ctx = createContext({ initialFiles: ["page.tsx", "users/about/page.tsx"] });
    try {
      assert.match(ctx.declaration(), /\| "\/users\/about"/);

      ctx.unlink("users/about/page.tsx");
      await tick();

      assert.equal(ctx.invalidations, 1);
      assert.equal(ctx.reloads.length, 1);
      assert.doesNotMatch(ctx.declaration(), /\/users\/about/);
    } finally {
      ctx.dispose();
    }
  });

  test("resolves a dynamic-segment rename through its transient conflict", async () => {
    const ctx = createContext({ initialFiles: ["users/[id]/page.tsx"] });
    try {
      assert.match(ctx.declaration(), /\| "\/users\/:id"/);

      // Mid-rename both [id] and [slug] exist and collapse to the same pattern,
      // so the change is rejected: no invalidation, no reload, types unchanged.
      ctx.add("users/[slug]/page.tsx");
      await tick();
      assert.equal(ctx.errors.length, 1);
      assert.match(ctx.errors[0], /Ambiguous route pattern "\/users\/:param"/);
      assert.equal(ctx.invalidations, 0);
      assert.equal(ctx.reloads.length, 0);
      assert.doesNotMatch(ctx.declaration(), /\/users\/:slug/);

      // Completing the rename clears the conflict and rewrites the types.
      ctx.unlink("users/[id]/page.tsx");
      await tick();
      assert.equal(ctx.errors.length, 1, "the completed rename does not add an error");
      assert.equal(ctx.invalidations, 1);
      assert.equal(ctx.reloads.length, 1);

      const decl = ctx.declaration();
      assert.match(decl, /\| "\/users\/:slug"/);
      assert.doesNotMatch(decl, /\/users\/:id/);
    } finally {
      ctx.dispose();
    }
  });

  test("rejects a new route that conflicts with an existing one", async () => {
    const ctx = createContext({ initialFiles: ["about/page.tsx"] });
    try {
      ctx.add("(marketing)/about/page.tsx");
      await tick();

      assert.equal(ctx.errors.length, 1);
      assert.match(ctx.errors[0], /Duplicate route "\/about"/);
      assert.equal(ctx.invalidations, 0);
      assert.equal(ctx.reloads.length, 0);
      assert.doesNotMatch(ctx.declaration(), /marketing/);
    } finally {
      ctx.dispose();
    }
  });

  test("recovers from a conflict without restarting the server", async () => {
    const ctx = createContext({ initialFiles: ["about/page.tsx"] });
    try {
      ctx.add("(marketing)/about/page.tsx"); // conflict
      await tick();
      assert.equal(ctx.errors.length, 1);
      assert.equal(ctx.reloads.length, 0);

      // Removing the offending file clears the conflict on the live watcher.
      ctx.unlink("(marketing)/about/page.tsx");
      await tick();

      assert.equal(ctx.errors.length, 1, "recovery does not log a second error");
      assert.equal(ctx.invalidations, 1);
      assert.equal(ctx.reloads.length, 1);
      assert.match(ctx.declaration(), /\| "\/about"/);
    } finally {
      ctx.dispose();
    }
  });

  test("cancels a pending reload when the server closes and stops watching", async () => {
    const ctx = createContext({ initialFiles: ["page.tsx"] });
    try {
      ctx.add("contact/page.tsx"); // schedules a reload on the next tick
      assert.equal(ctx.invalidations, 1);

      ctx.close(); // shutdown while the reload is still pending
      await tick();

      // cleanup() must have cleared the timer, so no reload is ever sent.
      assert.equal(ctx.reloads.length, 0);

      // Watcher listeners are detached: later structural changes are ignored.
      ctx.add("help/page.tsx");
      await tick();
      assert.equal(ctx.invalidations, 1, "no further invalidation after close");
      assert.equal(ctx.reloads.length, 0);
      assert.doesNotMatch(ctx.declaration(), /\/help/);
    } finally {
      ctx.dispose();
    }
  });
});
