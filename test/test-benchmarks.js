/**
 * Route-generator benchmarks.
 *
 * Run with `pnpm run test:bench` (which passes `--expose-gc` so the memory step can
 * measure instead of guess). Nothing here gates on a wall-clock number that a
 * loaded CI runner could miss: the assertions compare *scaling* - what a page costs
 * at 1 000 pages against what it costs at 100 - because a superlinear walk shows up
 * as a ratio, while an absolute millisecond budget is a coin toss on shared
 * hardware. The timings are printed either way, so a regression is still visible as
 * a number in the log.
 *
 * The shapes measured are the two the package has actually regressed on: the
 * per-folder child walk (an eager descendants pass once doubled the subtree at every
 * nested layout level, growing as 2^depth) and the declaration writer, which walks
 * the real pages directory and sorts every route path it finds.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildRouteTree, createRouteGenerator, treeToRoutes } from "../dist/index.js";
import { nextViteRouter } from "../dist/plugin.js";

const SIZES = [100, 500, 1000];

/** The largest tolerated ratio between per-page cost at 1 000 and at 100 pages. */
const LINEARITY_SLACK = 4;

const loader = () => async () => ({ default: function Page() { return null; } });
const eagerModule = () => ({ default: function Layout() { return null; } });

/**
 * A synthetic but legal route tree of `pageCount` pages, mixed the way a real
 * application is: static folders, a dynamic segment per section, a group, a couple
 * of catch-alls, layouts, one `not-found`, and a `loading`/`error` pair on some
 * sections. Names are zero-padded so ordinal sorting costs the same at every size
 * instead of degenerating on equal prefixes.
 */
function syntheticRecords(pageCount) {
  const sectionCount = Math.max(1, Math.round(pageCount / 50));
  const pages = {};
  const layouts = {};
  const notFounds = {};
  const loadings = {};
  const errors = {};

  layouts["layout.tsx"] = eagerModule();

  for (let s = 0; s < sectionCount; s += 1) {
    const section = `sec${String(s).padStart(4, "0")}`;
    layouts[`${section}/layout.tsx`] = eagerModule();
    notFounds[`${section}/not-found.tsx`] = loader();
    if (s % 5 === 0) {
      loadings[`${section}/loading.tsx`] = eagerModule();
      errors[`${section}/error.tsx`] = eagerModule();
    }
    // A dynamic segment per section, so parameter parsing runs on a realistic
    // share of the tree rather than only on the bulk of static leaves.
    pages[`${section}/item/[id]/page.tsx`] = loader();
    // A route group, which the converter walks as a pathless folder.
    pages[`${section}/(dashboard)/overview/page.tsx`] = loader();
  }

  for (let p = 0; p < pageCount; p += 1) {
    const section = `sec${String(p % sectionCount).padStart(4, "0")}`;
    const leaf = `p${String(p).padStart(5, "0")}`;
    // A required and an optional catch-all every 100 pages: these take the guard
    // index + splat path through the converter, which plain leaves never reach.
    if (p % 100 === 0) {
      pages[`${section}/cap${leaf}/[...slug]/page.tsx`] = loader();
    } else if (p % 100 === 50) {
      pages[`${section}/cap${leaf}/[[...segments]]/page.tsx`] = loader();
    } else {
      pages[`${section}/${leaf}/page.tsx`] = loader();
    }
  }

  return { pages, layouts, notFounds, loadings, errors };
}

/** Best of `runs` timings, in ms: the floor is the stable statistic on shared CI. */
function measure(runs, fn) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function countRoutes(routes) {
  let total = 0;
  for (const route of routes) {
    total += 1;
    if (route.children) total += countRoutes(route.children);
  }
  return total;
}

/**
 * Replace every node's `children` map with a counting getter, so the cost of a
 * walk is measured as visits rather than as milliseconds. Copied from the pattern
 * `routes.test.js` uses to pin the traversal contract: a node enumerated twice is a
 * bug no timing on a quiet machine would catch.
 */
function instrumentChildrenReads(root) {
  const reads = new Map();
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.pop();
    const children = node.children;
    reads.set(node, 0);
    Object.defineProperty(node, "children", {
      configurable: true,
      get() {
        reads.set(node, reads.get(node) + 1);
        return children;
      },
    });
    queue.push(...children.values());
  }
  return reads;
}

function report(label, ms, perPage) {
  console.log(
    `   ${label.padEnd(34)} ${ms.toFixed(1).padStart(8)} ms   (${perPage.toFixed(4)} ms/page)`,
  );
}

// --- breadth: 100 / 500 / 1 000 pages ---------------------------------------------

console.log("✅ Route generator scaling");
const perPageBySize = new Map();
let previousRoutesPerPage = 0;

for (const size of SIZES) {
  const records = syntheticRecords(size);
  // Warm the module and the caches once before the first timed run, so the cost
  // of the first `import` of React is not attributed to the route generator.
  createRouteGenerator(records.pages, records.layouts, records.notFounds)();

  const treeMs = measure(5, () =>
    buildRouteTree({
      pages: records.pages,
      layouts: records.layouts,
      notFounds: records.notFounds,
      loadings: records.loadings,
      errors: records.errors,
    }),
  );
  const tree = buildRouteTree({
    pages: records.pages,
    layouts: records.layouts,
    notFounds: records.notFounds,
    loadings: records.loadings,
    errors: records.errors,
  });
  const convertMs = measure(5, () => treeToRoutes(tree, true));
  const generator = createRouteGenerator(
    records.pages,
    records.layouts,
    records.notFounds,
    undefined,
    undefined,
    records.loadings,
    records.errors,
  );
  const fullMs = measure(5, () => generator());

  const routes = generator();
  const routeCount = countRoutes(routes);
  const perPage = fullMs / size;

  console.log(`   ${size} pages`);
  report("buildRouteTree", treeMs, treeMs / size);
  report("treeToRoutes", convertMs, convertMs / size);
  report("generateRoutes (whole pipeline)", fullMs, perPage);
  console.log(`   emitted ${routeCount} route objects`);

  // The pipeline must not emit more routes per page as the tree grows: the count
  // is the structural half of the linearity claim, and it costs nothing to check.
  const routesPerPage = routeCount / size;
  assert.ok(
    routeCount > 0 && Number.isFinite(routesPerPage),
    `${size} pages emitted no routes`,
  );
  if (previousRoutesPerPage > 0) {
    const drift = Math.abs(routesPerPage - previousRoutesPerPage) / previousRoutesPerPage;
    assert.ok(
      drift < 0.1,
      `routes per page stopped scaling linearly at ${size} pages ` +
        `(${routesPerPage.toFixed(3)} against ${previousRoutesPerPage.toFixed(3)})`,
    );
  }
  previousRoutesPerPage = routesPerPage;

  perPageBySize.set(size, perPage);
}

const small = perPageBySize.get(SIZES[0]);
const large = perPageBySize.get(SIZES[SIZES.length - 1]);
assert.ok(
  large <= small * LINEARITY_SLACK,
  `a page at ${SIZES.at(-1)} pages costs ${large.toFixed(4)} ms against ` +
    `${small.toFixed(4)} ms at ${SIZES[0]} - the whole pipeline went superlinear`,
);
console.log(
  `   per-page cost ratio 1000:100 = ${(large / small).toFixed(2)} (limit ${LINEARITY_SLACK})`,
);

// --- determinism: the same tree twice, byte for byte ------------------------------

const determinismRecords = syntheticRecords(200);
const firstRun = JSON.stringify(
  createRouteGenerator(
    determinismRecords.pages,
    determinismRecords.layouts,
    determinismRecords.notFounds,
  )().map((route) => route.path),
);
const secondRun = JSON.stringify(
  createRouteGenerator(
    determinismRecords.pages,
    determinismRecords.layouts,
    determinismRecords.notFounds,
  )().map((route) => route.path),
);
assert.equal(firstRun, secondRun, "two generators over one tree must emit the same order");
console.log("✅ Emitted order is reproducible across generators");

// --- depth: every node walked exactly once ---------------------------------------

// The historical failure was not breadth but nesting: computing descendants eagerly
// and then walking again inside `createNodeChildren` read the subtree twice per
// level, so cost grew as 2^depth while a flat tree looked perfectly healthy. A
// depth-12 chain is where that shows up, and visits - not time - are the proof.
function nestedRecords(depth) {
  const pages = {};
  const layouts = {};
  let folder = "n0";
  for (let level = 0; level < depth; level += 1) {
    layouts[`${folder}/layout.tsx`] = eagerModule();
    folder = `${folder}/n${level + 1}`;
  }
  pages[`${folder}/page.tsx`] = loader();
  return { pages, layouts };
}

for (const depth of [2, 6, 12]) {
  const records = nestedRecords(depth);
  const tree = buildRouteTree({ pages: records.pages, layouts: records.layouts });
  const reads = instrumentChildrenReads(tree);
  treeToRoutes(tree, true);

  const worst = Math.max(...[...reads.values()]);
  assert.equal(
    worst,
    1,
    `a nested layout tree at depth ${depth} enumerated some folder's children ${worst} times`,
  );
  console.log(`✅ Nested layouts at depth ${depth} walk each folder once`);
}

// --- lazy cache: one component per key, not one per call -------------------------

{
  const records = syntheticRecords(50);
  const generator = createRouteGenerator(records.pages, records.layouts, records.notFounds);
  const leafKeyOf = (routes) => routes[0]?.children?.[0]?.element?.type;
  const a = generator();
  const b = generator();
  assert.equal(
    leafKeyOf(a),
    leafKeyOf(b),
    "a generator must memoize one React.lazy per route key across calls",
  );
  console.log("✅ Repeated generateRoutes() calls reuse the memoized components");
}

// --- declaration generation, against a real pages directory ---------------------

// `configResolved` is what a build or a dev-server restart pays: it walks the
// pages root, parses every folder name into a route path, sorts them, and writes
// `routes.d.ts`. Timing it from the in-memory records would skip the file walk,
// which is the part that grows with the number of files.
console.log("✅ Declaration generation");
const declarationTemp = fs.mkdtempSync(path.join(os.tmpdir(), "nvr-bench-dts-"));
const perFileBySize = new Map();

try {
  for (const size of SIZES) {
    const root = path.join(declarationTemp, `app-${size}`);
    const records = syntheticRecords(size);
    for (const record of [records.pages, records.layouts, records.notFounds, records.loadings, records.errors]) {
      for (const relative of Object.keys(record)) {
        const target = path.join(root, "src", "app", relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "", "utf8");
      }
    }
    const fileCount = Object.keys(records.pages).length
      + Object.keys(records.layouts).length
      + Object.keys(records.notFounds).length
      + Object.keys(records.loadings).length
      + Object.keys(records.errors).length;

    const ms = measure(3, () => nextViteRouter().configResolved({ root }));
    const declaration = fs.readFileSync(path.join(root, "src", "routes.d.ts"), "utf8");
    const routePaths = [...declaration.matchAll(/^\s+\| "(.+)"$/gm)].length;

    console.log(`   ${size} pages (${fileCount} files)`);
    report("configResolved (decl + write)", ms, ms / fileCount);
    console.log(`   ${declaration.length} bytes, ${routePaths} RoutePath members`);

    assert.ok(
      routePaths >= size,
      `the declaration listed ${routePaths} route paths for ${size} pages`,
    );
    perFileBySize.set(size, ms / fileCount);

    // A second run over an unchanged tree must produce the same bytes: a
    // locale-sensitive or set-ordered writer would churn every developer's diff.
    const before = declaration;
    nextViteRouter().configResolved({ root });
    const after = fs.readFileSync(path.join(root, "src", "routes.d.ts"), "utf8");
    assert.equal(before, after, "the declaration is not reproducible across runs");
  }

  const smallFile = perFileBySize.get(SIZES[0]);
  const largeFile = perFileBySize.get(SIZES.at(-1));
  assert.ok(
    largeFile <= smallFile * LINEARITY_SLACK,
    `declaration generation went superlinear: ${largeFile.toFixed(4)} ms per file at ` +
      `${SIZES.at(-1)} pages against ${smallFile.toFixed(4)} at ${SIZES[0]}`,
  );
  console.log(
    `   per-file cost ratio 1000:100 = ${(largeFile / smallFile).toFixed(2)} (limit ${LINEARITY_SLACK})`,
  );
} finally {
  fs.rmSync(declarationTemp, { recursive: true, force: true });
}

// --- memory across repeated rebuilds --------------------------------------------

// The dev-server rebuild loop, measured the way the claim is actually made: a
// generator per rebuild (which is what a restarted route table builds) and then
// `generator()` calls on one generator (which is what HMR does without a restart).
// Growth is asserted after an explicit GC, so this cannot pass by accident on a
// machine that happens to have collected.
console.log("✅ Memory across repeated rebuilds");
{
  if (typeof global.gc !== "function") {
    throw new Error(
      "run this file with `node --expose-gc` (use `pnpm run test:bench`): the memory step " +
      "compares heaps after an explicit collection, which is meaningless without one",
    );
  }

  const records = syntheticRecords(200);
  const cycles = 120;

  const generatorHeap = () => {
    global.gc();
    return process.memoryUsage().heapUsed;
  };

  // Establish a steady state first: the first rebuild allocates the module graph,
  // the tree classes and the caches, none of which is a leak.
  for (let i = 0; i < 10; i += 1) {
    createRouteGenerator(
      records.pages, records.layouts, records.notFounds,
      undefined, undefined, records.loadings, records.errors,
    )();
  }
  const startHeap = generatorHeap();

  for (let i = 0; i < cycles; i += 1) {
    const generator = createRouteGenerator(
      records.pages, records.layouts, records.notFounds,
      undefined, undefined, records.loadings, records.errors,
    );
    generator();
    generator();
  }

  const endHeap = generatorHeap();
  const growthBytes = endHeap - startHeap;
  const growthMb = growthBytes / (1024 * 1024);
  console.log(
    `   ${cycles} rebuild cycles: heap ${(startHeap / 1048576).toFixed(1)} MB -> ` +
      `${(endHeap / 1048576).toFixed(1)} MB (${growthMb.toFixed(2)} MB growth)`,
  );

  // Nothing in the package keeps a per-rebuild object alive: the lazy cache is
  // owned by the generator, and the router config singleton is gone since 4.0.0.
  // Measured here at about 0.1 MB over 120 cycles of a 200-page tree; a rebuild
  // that actually leaked would keep a whole tree per cycle - megabytes each - so
  // 8 MB is slack for fragmentation while still being a real gate. The
  // watcher/timer half of the contract is pinned in `test-plugin-lifecycle.js`,
  // which closes the server and counts handlers.
  assert.ok(
    growthMb < 8,
    `${cycles} rebuild cycles grew the heap by ${growthMb.toFixed(1)} MB - ` +
      "something survives a generator being thrown away",
  );
  console.log(`✅ Heap growth stayed under 8 MB over ${cycles} cycles`);
}

console.log("\n✅ Benchmarks complete");
