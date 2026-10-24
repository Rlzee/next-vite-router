import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createRouteGenerator, configureRouter, href, Link, createTypedLink, useCatchAll } from '../dist/index.js';

console.log('✅ createRouteGenerator:', typeof createRouteGenerator);
console.log('✅ configureRouter:', typeof configureRouter);
console.log('✅ href:', typeof href);
console.log('✅ Link:', typeof Link);

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve('package.json'), 'utf8'),
);

for (const [entry, conditions] of Object.entries(packageJson.exports)) {
  // Conditional exports map to an object of conditions; shorthand entries such
  // as "./package.json" map straight to a file path and carry no conditions.
  if (typeof conditions !== "object") {
    assert.match(
      conditions,
      /^\.\/.+/,
      `${entry} must resolve to a local file path`,
    );
    continue;
  }
  assert.equal(
    Object.keys(conditions.import)[0],
    'types',
    `${entry} import conditions must list types first`,
  );
  assert.equal(
    Object.keys(conditions.require)[0],
    'types',
    `${entry} require conditions must list types first`,
  );
}

assert.equal(
  packageJson.exports['./plugin'].require.default,
  './dist/plugin.cjs',
);
assert.ok(fs.existsSync(path.resolve('dist/plugin.cjs')));
assert.ok(fs.existsSync(path.resolve('dist/plugin.d.cts')));

const require = createRequire(import.meta.url);
const cjsPlugin = require('../dist/plugin.cjs');
assert.equal(typeof cjsPlugin.nextViteRouter, 'function');

// The navigation helpers must reach both module formats, not just ESM.
assert.equal(typeof href, 'function');
assert.equal(typeof Link, 'function');
assert.equal(typeof createTypedLink, 'function');
assert.equal(typeof useCatchAll, 'function');
const cjsIndex = require('../dist/index.cjs');
assert.equal(typeof cjsIndex.href, 'function');
assert.equal(typeof cjsIndex.Link, 'function');
assert.equal(typeof cjsIndex.createTypedLink, 'function');
assert.equal(typeof cjsIndex.useCatchAll, 'function');

console.log('✅ Package built successfully!');
console.log('✅ Plugin CJS named export is loadable via require');
console.log('✅ href, Link, and useCatchAll are loadable from ESM and CJS');
