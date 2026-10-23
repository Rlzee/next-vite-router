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
assert.match(mainSource, /import \{ Router \} from 'virtual:next-vite-router'/);
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

console.log("✅ Peer dependency ranges are explicit and bounded");
console.log("✅ CLI installs react-router-dom ^7.0.0");
console.log("✅ CLI uses the current React + TypeScript Vite template");
console.log("✅ CLI generates the Router component bootstrap");
console.log("✅ PREFERRED_PM is validated against the supported managers (a hostile value never reaches a shell)");
