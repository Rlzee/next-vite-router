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
assert.match(cliSource, /react-router-dom@\^6\.0\.0/);
assert.doesNotMatch(cliSource, /react-router-dom@latest/);

console.log("✅ Peer dependency ranges are explicit and bounded");
console.log("✅ CLI installs react-router-dom ^6.0.0");
