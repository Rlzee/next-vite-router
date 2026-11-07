import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8"),
);
const peers = packageJson.peerDependencies;

assert.equal(peers.react, ">=18 <20");
assert.equal(peers["react-dom"], ">=18 <20");
assert.equal(peers["react-router"], ">=6 <8");
assert.equal(peers["react-router-dom"], ">=6 <8");
assert.equal(peers.vite, ">=5 <9");

// An application installs the router one of two ways: `react-router-dom` (every
// supported major - and in v7 that package is only a shim over `react-router`),
// or `react-router` v7+ on its own, which is what React Router's own upgrade
// guide tells a migrated app to do. npm cannot express an either/or peer, so both
// are declared with their ranges and both are marked optional; the plugin picks
// one at config time and refuses the combination it cannot serve (v6 core, no
// shim). Any other peer stays required, because an optional marker there would
// let an install pass that cannot run at all.
const optionalPeers = Object.keys(packageJson.peerDependenciesMeta ?? {});
assert.deepEqual(
  [...optionalPeers].sort(),
  ["react-router", "react-router-dom"],
  "only the two interchangeable router peers may carry peerDependenciesMeta",
);
for (const name of optionalPeers) {
  assert.equal(
    packageJson.peerDependenciesMeta[name].optional,
    true,
    `"${name}" must be an optional peer so the other one can be installed alone`,
  );
  assert.ok(
    peers[name],
    `"${name}" is optional but declares no accepted version range`,
  );
}
for (const name of ["react", "react-dom", "vite"]) {
  assert.equal(
    packageJson.peerDependenciesMeta?.[name],
    undefined,
    `"${name}" is not optional: every install needs it`,
  );
}
// Marking both router peers optional also means no package manager installs one
// on the library's behalf - and pnpm versions disagree about whether an *optional*
// peer is auto-installable at all, which is what left the lockfile recording a
// dependency no manifest ever asked for and every CI job failing on
// `pnpm install --frozen-lockfile`. The workspace therefore pins the router
// packages its own tests resolve, so the lock records them from the manifest
// instead of from a peer-install policy that differs between pnpm releases.
for (const name of ["react-router", "react-router-dom"]) {
  assert.ok(
    packageJson.devDependencies?.[name],
    `"${name}" must be a devDependency: an optional peer is recorded differently by different pnpm versions`,
  );
}

// `engines.node` is a promise about every shipped entry point, and the CLI drags
// in `commander`, which declares its own Node floor. If a runtime dependency asks
// for a newer Node than we promise, the metadata becomes a lie: installers on a
// "supported" Node get an EBADENGINE for the dependency anyway. Compare the floor
// of each installed runtime dependency with the floor we publish.
const manifestRequire = createRequire(import.meta.url);

function dependencyManifest(name) {
  let manifestPath;
  try {
    manifestPath = manifestRequire.resolve(`${name}/package.json`);
  } catch {
    // Most packages leave "./package.json" out of their export map, so resolve
    // the entry file and take the manifest sitting next to it.
    manifestPath = path.join(
      path.dirname(manifestRequire.resolve(name)),
      "package.json",
    );
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

// Every `||` alternative (">=20", "^12.20.0 || >=14", ">=14.17.0 <20") is served
// from its first version number upwards, so the lowest such start is the range's
// real floor.
function minimumNode(range) {
  const floors = range
    .split("||")
    .map((alternative) => alternative.match(/\d+(?:\.\d+){0,2}/))
    .filter((match) => match !== null)
    .map((match) => match[0].split(".").map(Number));
  assert.ok(floors.length > 0, `no Node version found in range "${range}"`);
  return floors.reduce((low, current) =>
    compareVersions(current, low) < 0 ? current : low,
  );
}

assert.ok(
  packageJson.engines?.node,
  "package.json must declare an engines.node floor for the shipped CLI",
);
const publishedFloor = minimumNode(packageJson.engines.node);

for (const name of Object.keys(packageJson.dependencies)) {
  const dependencyRange = dependencyManifest(name).engines?.node;
  if (!dependencyRange) continue;
  assert.ok(
    compareVersions(minimumNode(dependencyRange), publishedFloor) <= 0,
    `"${name}" requires Node ${dependencyRange}, above the published ` +
      `engines.node "${packageJson.engines.node}"`,
  );
}

const cliSource = fs.readFileSync(
  path.resolve("src/command/create.ts"),
  "utf8",
);
assert.match(cliSource, /react-router-dom@\^7\.0\.0/);
assert.doesNotMatch(cliSource, /react-router-dom@latest/);
assert.match(cliSource, /React \+ TypeScript \(Recommended\).*react-ts/s);

const mainSource = fs.readFileSync(
  path.resolve("src/utils/create-main-tsx.ts"),
  "utf8",
);
assert.match(mainSource, /import \{ Router \} from 'next-vite-router\/routes'/);
assert.doesNotMatch(mainSource, /generateRoutes, useRoutes/);

const startConfigSource = fs.readFileSync(
  path.resolve("src/utils/start-next-vite-router-config.ts"),
  "utf8",
);
assert.match(startConfigSource, /fileURLToPath\(new URL/);
assert.doesNotMatch(startConfigSource, /resolve\(__dirname/);

// PREFERRED_PM is interpolated into the `--version` probe passed to execSync, so
// it has to be matched against the supported list rather than cast to a name.
// A source regex only pins that `toPmName` is called; the real guarantee is
// behavioral, so we bundle the internal detector (it is not exported from the
// package), stub `execSync` to capture the exact commands it would run, and
// assert a hostile value like `npm && touch /tmp/x` never reaches a shell.
const requireFrom = createRequire(import.meta.url);
const childProcess = requireFrom("node:child_process");

function resolveEsbuildBin() {
  const store = path.resolve("node_modules/.pnpm");
  if (fs.existsSync(store)) {
    const match = fs
      .readdirSync(store)
      .find((entry) => entry.startsWith("esbuild@"));
    if (match) {
      const bin = path.join(store, match, "node_modules/esbuild/bin/esbuild");
      if (fs.existsSync(bin)) return bin;
    }
  }
  const local = path.resolve("node_modules/esbuild/bin/esbuild");
  return fs.existsSync(local) ? local : null;
}

const esbuildBin = resolveEsbuildBin();
assert.ok(esbuildBin, "esbuild must be resolvable to exercise the package-manager probe");

const probeBundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "nvr-pm-probe-"));
const probeBundle = path.join(probeBundleDir, "packageManager.cjs");
const savedUserAgent = process.env.npm_config_user_agent;
const savedPreferredPm = process.env.PREFERRED_PM;
const originalExecSync = childProcess.execSync;
try {
  // Capture esbuild's own output instead of `stdio: "ignore"`: on a clean CI
  // install the bundling step is the one that breaks, and a bare non-zero exit
  // (execFileSync reports `output: [null, null, null]`) hides the real cause.
  execFileSync(
    process.execPath,
    [
      esbuildBin,
      path.resolve("src/utils/packageManager.ts"),
      "--bundle",
      "--platform=node",
      "--format=cjs",
      `--outfile=${probeBundle}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
} catch (error) {
  throw new Error(
    `esbuild failed to bundle src/utils/packageManager.ts (exit ${error.status}).\n` +
    `--- stdout ---\n${error.stdout || ""}\n--- stderr ---\n${error.stderr || ""}`,
    { cause: error },
  );
}

try {
  // Neutralize user-agent precedence so the PREFERRED_PM path is what is tested.
  delete process.env.npm_config_user_agent;

  const probes = [];
  childProcess.execSync = (command) => {
    probes.push(String(command));
    return Buffer.from("0.0.0");
  };
  const { detectPackageManager } = requireFrom(probeBundle);

  const INJECTION = "&& touch /tmp/x";
  process.env.PREFERRED_PM = `npm ${INJECTION}`;
  const hostile = detectPackageManager();

  // The raw env value must never be handed to a shell, and every probe has to be
  // a bare supported-manager `--version` (a leaked value would fail both).
  assert.equal(
    probes.some((command) => command.includes(INJECTION)),
    false,
    `PREFERRED_PM leaked into a shell command: ${JSON.stringify(probes)}`,
  );
  for (const command of probes) {
    assert.match(command, /^(pnpm|bun|yarn|npm) --version$/, `unexpected probe: ${command}`);
  }
  assert.ok(["pnpm", "bun", "yarn", "npm"].includes(hostile.name),
    `detector returned an unsupported name: ${hostile.name}`);

  // A whitelisted value is still honored, proving the gate is a whitelist and not
  // a blanket rejection: `yarn` becomes the first probe and the chosen manager.
  probes.length = 0;
  process.env.PREFERRED_PM = "yarn";
  const preferred = detectPackageManager();
  assert.equal(preferred.name, "yarn");
  assert.equal(probes[0], "yarn --version");
} finally {
  childProcess.execSync = originalExecSync;
  if (savedUserAgent === undefined) delete process.env.npm_config_user_agent;
  else process.env.npm_config_user_agent = savedUserAgent;
  if (savedPreferredPm === undefined) delete process.env.PREFERRED_PM;
  else process.env.PREFERRED_PM = savedPreferredPm;
  fs.rmSync(probeBundleDir, { recursive: true, force: true });
}

// The published peer ranges are a promise, and the compatibility matrix in CI is
// where it is kept: every pinned version has to sit inside its range, and the
// matrix has to exercise both the lowest and the highest major the range allows.
// Reading the pinned versions out of the workflow also proves the job *renders*
// the fixture app instead of only bundling it, which is the difference between
// "this module compiles on Vite 8 / React 19 / Router 7" and "the route tree
// paints there". Narrow a range without updating the matrix, or drop the render
// step, and these assertions say so.
const workflowSource = fs.readFileSync(
  path.resolve(".github/workflows/compatibility.yml"),
  "utf8",
);
const smokeSource = fs.readFileSync(
  path.resolve("test/compat-app/src/entry-server.tsx"),
  "utf8",
);

// A `strategy.matrix` list such as `vite: ["5.4.21", "6.1.0"]`. The `include:`
// rows spell their versions without brackets, so they are not matched here, and
// they only repeat versions the matrix already declares.
function matrixPins(key) {
  const declaration = new RegExp(`^\\s+${key}: \\[([^\\]]*)\\]`, "m").exec(
    workflowSource,
  );
  assert.ok(declaration, `the compatibility matrix must pin "${key}" versions`);
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((pin) => pin[1]);
}

function peerBounds(range) {
  const bounds = /^>=(\d+) <(\d+)$/.exec(range);
  assert.ok(
    bounds,
    `the matrix check expects a peer range of the form ">=N <M", got "${range}"`,
  );
  return { lowest: Number(bounds[1]), highest: Number(bounds[2]) - 1 };
}

const MATRIX_PEER_KEYS = {
  react: "react",
  router: "react-router-dom",
  vite: "vite",
};

for (const [key, peerName] of Object.entries(MATRIX_PEER_KEYS)) {
  const pins = matrixPins(key);
  assert.ok(pins.length > 0, `the compatibility matrix pins no "${peerName}" version`);
  const { lowest, highest } = peerBounds(peers[peerName]);
  const majors = pins.map((pin) => Number(pin.split(".")[0]));
  for (const [index, major] of majors.entries()) {
    assert.ok(
      major >= lowest && major <= highest,
      `"${peerName}" ${pins[index]} is outside the declared peer range "${peers[peerName]}"`,
    );
  }
  assert.ok(
    majors.includes(lowest),
    `the compatibility matrix must test ${peerName} ${lowest}.x, the floor of "${peers[peerName]}"`,
  );
  assert.ok(
    majors.includes(highest),
    `the compatibility matrix must test ${peerName} ${highest}.x, the ceiling of "${peers[peerName]}"`,
  );
}

assert.match(
  workflowSource,
  /cp -R test\/compat-app\/\./,
  "the compatibility job must build the app under test/compat-app",
);
assert.match(
  workflowSource,
  /vite build --ssr src\/entry-server\.tsx/,
  "the compatibility job must bundle the SSR render smoke test",
);
assert.match(
  workflowSource,
  /node "\$entry"/,
  "the compatibility job must run the bundled SSR entry, not only build it",
);
assert.match(
  smokeSource,
  /renderToPipeableStream/,
  "the SSR entry must render through a real stream",
);

// The `react-router`-only leg is what makes the optional peer above a promise
// instead of a wish: the fixture app keeps importing `react-router-dom` (so does
// this package's own `dist`), and on an install that removed the v7 shim the
// plugin has to resolve the router through `react-router` instead.
const workflowLines = workflowSource.split(/\r?\n/);
const routerOnlyStart = workflowLines.findIndex((line) =>
  /^ {2}react-router-only:$/.test(line),
);
assert.ok(
  routerOnlyStart >= 0,
  "the workflow must keep a job that installs react-router without react-router-dom",
);
// A job body runs until the next job key at the same indentation.
const routerOnlyBodyLines = [];
for (const line of workflowLines.slice(routerOnlyStart + 1)) {
  if (/^ {2}\S/.test(line)) break;
  routerOnlyBodyLines.push(line);
}
const routerOnlyBody = routerOnlyBodyLines.join("\n");
assert.match(
  routerOnlyBody,
  /"react-router": "\$\{\{ matrix\.router \}\}"/,
  "the react-router-only job must install the router through the matrix version",
);
assert.doesNotMatch(
  routerOnlyBody,
  /"react-router-dom":/,
  "the react-router-only job must not install the shim it is testing the absence of",
);
assert.match(
  routerOnlyBody,
  /cp -R test\/compat-app\//,
  "the react-router-only job must build the same fixture app",
);
const routerOnlyPins = /router: \[([^\]]*)\]/.exec(routerOnlyBody);
assert.ok(
  routerOnlyPins,
  "the react-router-only job must pin the react-router versions it installs",
);
const routerPeerBounds = peerBounds(peers["react-router"]);
for (const pin of [...routerOnlyPins[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])) {
  const major = Number(pin.split(".")[0]);
  assert.ok(
    major >= routerPeerBounds.lowest && major <= routerPeerBounds.highest,
    `the react-router-only job pins ${pin}, outside the declared range "${peers["react-router"]}"`,
  );
  // `react-router` v6 has no `Link`, so substituting it for the shim is only
  // sound from v7 up - pinning a lower major here would test a refusal.
  assert.ok(
    major >= 7,
    `the react-router-only job pins ${pin}, but only react-router 7.x can stand in for the shim`,
  );
}

console.log("✅ Peer dependency ranges are explicit and bounded");
console.log(
  "✅ The two interchangeable router peers are declared optional, the rest are required",
);
console.log(
  `✅ engines.node ${packageJson.engines.node} covers every runtime dependency floor`,
);
console.log("✅ CLI installs react-router-dom ^7.0.0");
console.log("✅ CLI uses the current React + TypeScript Vite template");
console.log("✅ CLI generates the Router component bootstrap");
console.log("✅ PREFERRED_PM is validated against the supported managers (a hostile value never reaches a shell)");
console.log(
  `✅ The compatibility matrix covers the full peer range of ${Object.values(MATRIX_PEER_KEYS).join(", ")}`,
);
console.log("✅ The compatibility job renders the fixture app, not only builds it");
console.log(
  "✅ The compatibility matrix proves react-router works without react-router-dom",
);