/**
 * Module-format check on a real install.
 *
 * `test-package.js` loads `dist/index.cjs` and `dist/plugin.cjs` by path, which
 * proves the files are valid JavaScript but says nothing about what an application
 * actually resolves: the conditional `exports` map, the `import`/`require`
 * conditions picking `.js` versus `.cjs`, the type files beside them, and the
 * entries that must NOT be reachable. Those are decided by Node from
 * `node_modules/next-vite-router/package.json`, so this file builds exactly that -
 * the published `files` set, installed into a throwaway project - and then runs two
 * consumers inside it: one ESM, one CommonJS.
 *
 * The install is assembled from `package.json`'s own `files` list rather than from a
 * registry round-trip, which is the point: if the published list and the `exports`
 * map ever disagree, a copied entry is missing and this check fails while a network
 * install would have shipped the broken package. The CI matrix legs already install
 * the packed tarball itself, so the packaging step stays covered too.
 *
 * Run with `pnpm run test:modules` after `pnpm run build`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const projectRoot = path.resolve();
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const distDir = path.join(projectRoot, "dist");

if (!fs.existsSync(distDir)) {
  throw new Error(
    "no dist/ to install: run `pnpm run build` before `pnpm run test:modules`",
  );
}

// What a published tarball would contain, straight from the manifest. npm always
// adds `package.json` itself whatever `files` says - and the install layout below
// has to mirror that, or the exports entry a consumer reads to find the map would
// look unpublished.
const PUBLISHED = [...manifest.files, "package.json"];
assert.ok(
  PUBLISHED.includes("dist"),
  "`files` must publish dist/, or nothing in exports resolves",
);

/** Every target the exports map points at has to be inside the published set. */
for (const [specifier, conditions] of Object.entries(manifest.exports)) {
  const targets = typeof conditions === "string"
    ? [conditions]
    : Object.values(conditions).flatMap((block) =>
      typeof block === "string" ? [block] : Object.values(block));
  for (const target of targets) {
    const relative = target.replace(/^\.\//, "");
    assert.ok(
      PUBLISHED.some((entry) => relative === entry || relative.startsWith(`${entry}/`)),
      `exports["${specifier}"] points at ${target}, which \`files\` does not publish`,
    );
    assert.ok(
      fs.existsSync(path.join(projectRoot, relative)),
      `exports["${specifier}"] points at ${target}, which the build did not emit`,
    );
  }
}

// The binary is a separate contract: a path with a leading "./" or a stale name
// installs a command that cannot start.
const binTarget = Object.values(manifest.bin)[0];
assert.ok(
  !binTarget.startsWith("./"),
  `bin target "${binTarget}" must not start with "./" (npm rewrites it inconsistently)`,
);
assert.ok(fs.existsSync(path.join(projectRoot, binTarget)), `bin target is missing: ${binTarget}`);

/**
 * The ESM consumer. It asserts as it loads, so a non-zero exit is a real finding
 * rather than a parsed-shape guess, and it checks *which* file each condition
 * resolved to - a map that silently handed `.cjs` to an ESM app would still load.
 */
const ESM_CONSUMER = `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createRouteGenerator, buildRouteTree, treeToRoutes } from "next-vite-router";
import { nextViteRouter } from "next-vite-router/plugin";

assert.equal(typeof createRouteGenerator, "function");
assert.equal(typeof nextViteRouter, "function");

// Loadable is not the same as functional: build a tree through the installed
// bundle, so an interop or externals mistake in the shipped file fails here. The
// shape is asserted loosely on purpose - the route matrix belongs to
// routes.test.js - but the users folder and the built-in 404 splat have to be
// there.
const tree = buildRouteTree({ pages: { "users/[id]/page.tsx": async () => ({ default: () => null }) } });
const routes = treeToRoutes(tree, true);
const emittedPaths = routes.map((route) => route.path);
assert.ok(emittedPaths.includes("users"), "the installed bundle emitted no users route");
assert.ok(emittedPaths.includes("*"), "the installed bundle emitted no 404 splat");
assert.equal(typeof createRouteGenerator({ "a/page.tsx": async () => ({ default: () => null }) }), "function");

// The ESM condition has to land on the ESM bundle.
assert.match(import.meta.resolve("next-vite-router"), /\\/index\\.js$/);
assert.match(import.meta.resolve("next-vite-router/plugin"), /\\/plugin\\.js$/);

// A CommonJS config file in a non-module project requires this very package:
// both formats have to work from inside one installed copy.
const require = createRequire(import.meta.url);
assert.equal(typeof require("next-vite-router/plugin").nextViteRouter, "function");
// A resolved path uses the platform separator, so match either spelling.
assert.match(require.resolve("next-vite-router"), /[\\\\/]index\\.cjs$/);
assert.match(require.resolve("next-vite-router/plugin"), /[\\\\/]plugin\\.cjs$/);
assert.equal(require("next-vite-router/package.json").name, "next-vite-router");

// The engine entry stays private: the generated routes module imports it by
// resolved file path, and application code must not be able to name it.
await assert.rejects(
  () => import("next-vite-router/plugin-runtime"),
  (error) => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "plugin-runtime must not be importable",
);
// There is no export for the generated module: it exists only inside a project
// that runs the plugin, which aliases the specifier.
await assert.rejects(
  () => import("next-vite-router/routes"),
  (error) => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "next-vite-router/routes must not resolve without the plugin",
);

console.log("esm ok");
`;

/** The CommonJS consumer, for a project with no `"type"` field. */
const CJS_CONSUMER = `
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRouteGenerator, buildRouteTree, treeToRoutes } = require("next-vite-router");
const { nextViteRouter } = require("next-vite-router/plugin");

assert.equal(typeof createRouteGenerator, "function");
assert.equal(typeof nextViteRouter, "function");

const tree = buildRouteTree({ pages: { "blog/[...slug]/page.tsx": async () => ({ default: () => null }) } });
const routes = treeToRoutes(tree, true);
assert.ok(routes.length >= 1, "the CJS bundle built no routes");

assert.match(require.resolve("next-vite-router"), /[\\\\/]index\\.cjs$/);
assert.match(require.resolve("next-vite-router/plugin"), /[\\\\/]plugin\\.cjs$/);

// A TypeScript project with no "type" field reads the .d.cts twins; if the build
// stops copying them the require condition resolves to nothing usable. They are
// checked on disk inside the installed package, because dist/* is not an export.
const installed = require("next-vite-router/package.json");
const packageDir = path.dirname(require.resolve("next-vite-router/package.json"));
for (const [specifier, targets] of Object.entries(installed.exports)) {
  const block = typeof targets === "string" ? null : targets.require;
  if (!block) continue;
  assert.match(
    block.types,
    /\\.d\\.cts$/,
    specifier + ": the require condition must type-check against a .d.cts file",
  );
  assert.ok(
    fs.existsSync(path.join(packageDir, block.types)),
    specifier + ": " + block.types + " is missing from the installed package",
  );
}

assert.throws(
  () => require("next-vite-router/plugin-runtime"),
  (error) => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
);
assert.throws(
  () => require("next-vite-router/routes"),
  (error) => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
);

console.log("cjs ok");
`;

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nvr-modules-"));

/** Lay out `<dir>/node_modules/next-vite-router` from the published file list. */
function install(dir, packageJson) {
  const packageDir = path.join(dir, "node_modules", "next-vite-router");
  fs.mkdirSync(packageDir, { recursive: true });
  for (const entry of PUBLISHED) {
    fs.cpSync(path.join(projectRoot, entry), path.join(packageDir, entry), {
      recursive: true,
      filter: (source) => !/[\\/]\.vite[\\/]?/.test(source),
    });
  }
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(packageJson), "utf8");
  linkPeers(dir);
  return packageDir;
}

/**
 * Put this package's peers in the consumer's `node_modules`, the way an install
 * would: they are the application's dependencies, and the shipped `dist` imports
 * `react` and `react-router-dom` by bare specifier, so resolving without them
 * fails for a reason that has nothing to do with the exports map under test.
 *
 * Each peer is linked to the directory the repository already resolved it to,
 * rather than copied: Node resolves a symlinked module from its real path, so the
 * peer finds its own dependencies in the workspace layout exactly as it does for
 * the suites, and nothing has to be downloaded.
 */
function linkPeers(dir) {
  const requireFromRepo = createRequire(import.meta.url);
  const type = process.platform === "win32" ? "junction" : "dir";
  const linked = [];

  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    let target;
    try {
      target = path.dirname(requireFromRepo.resolve(`${name}/package.json`));
    } catch {
      // An unresolvable peer is not installed here, so an application that needs
      // it would not have installed this package either; skip it rather than
      // fabricate a directory that a real install would not contain.
      continue;
    }
    const linkPath = path.join(dir, "node_modules", name);
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    if (!fs.existsSync(linkPath)) {
      fs.symlinkSync(target, linkPath, type);
    }
    linked.push(name);
  }

  assert.ok(
    linked.includes("react"),
    "react must be resolvable from the workspace: the shipped dist imports it",
  );
  return linked;
}

/**
 * Delete the throwaway install without ever following a link. The peer entries are
 * junctions into the workspace store, so a recursive delete that treated them as
 * directories would remove real packages: every symlink is unlinked as the file it
 * is before its parent is walked.
 */
function removeTree(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (fs.lstatSync(target).isSymbolicLink()) {
      fs.unlinkSync(target);
    } else if (entry.isDirectory()) {
      removeTree(target);
    } else {
      fs.unlinkSync(target);
    }
  }
  fs.rmdirSync(dir);
}

function run(file, cwd, label) {
  try {
    const stdout = execFileSync(process.execPath, [file], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`✅ ${label}: ${stdout.trim()}`);
  } catch (error) {
    // The consumer's own assertion text is the diagnosis; forwarding it beats
    // execFileSync's `[null, null, null]`.
    console.error(`${label} failed\n${error.stdout ?? ""}${error.stderr ?? ""}`);
    throw error;
  }
}

try {
  const esmDir = path.join(tempRoot, "esm-app");
  const esmPackage = install(esmDir, { name: "consumer-esm", private: true, type: "module" });
  const esmFile = path.join(esmDir, "consumer.mjs");
  fs.writeFileSync(esmFile, ESM_CONSUMER, "utf8");
  run(esmFile, esmDir, "installed ESM entry points");
  assert.ok(
    fs.existsSync(path.join(esmPackage, "dist", "index.d.ts")),
    "the installed copy is missing its ESM declaration file",
  );

  const cjsDir = path.join(tempRoot, "cjs-app");
  install(cjsDir, { name: "consumer-cjs", private: true });
  const cjsFile = path.join(cjsDir, "consumer.cjs");
  fs.writeFileSync(cjsFile, CJS_CONSUMER, "utf8");
  run(cjsFile, cjsDir, "installed CommonJS entry points");

  console.log("✅ Every exports target is inside the published `files` set");
  console.log(`✅ bin installs as ${binTarget}`);
} finally {
  removeTree(tempRoot);
}
