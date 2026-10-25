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
assert.equal(peers["react-router-dom"], ">=6 <8");
assert.equal(peers.vite, ">=5 <9");

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

console.log("✅ Peer dependency ranges are explicit and bounded");
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