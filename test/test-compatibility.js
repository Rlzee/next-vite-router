import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8"),
);
const peers = packageJson.peerDependencies;

assert.equal(peers.react, ">=18 <20");
assert.equal(peers["react-dom"], ">=18 <20");
assert.equal(peers["react-router-dom"], ">=6 <8");
assert.equal(peers.vite, ">=5 <9");

const cliSource = fs.readFileSync(
  path.resolve("src/command/init.ts"),
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

console.log("✅ Peer dependency ranges are explicit and bounded");
console.log("✅ CLI installs react-router-dom ^7.0.0");
console.log("✅ CLI uses the current React + TypeScript Vite template");
console.log("✅ CLI generates the Router component bootstrap");
