import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createRouteGenerator } from '../dist/index.js';
import { href, Link, createTypedLink, useCatchAll } from '../dist/plugin-runtime.js';

console.log('✅ createRouteGenerator:', typeof createRouteGenerator);
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

// The navigation helpers must reach both module formats, not just ESM. They
// live in the internal engine entry (kept out of "exports"), so the generated
// routes module can resolve it by path while app code cannot import it.
assert.equal(typeof href, 'function');
assert.equal(typeof Link, 'function');
assert.equal(typeof createTypedLink, 'function');
assert.equal(typeof useCatchAll, 'function');
// The public root entry exposes the route engine and the utils, not the
// navigation helpers - and no configuration surface at all: `configureRouter`
// and `resetRouterConfig` left the package with 4.0.0, `loading.tsx` is the one
// placeholder an application can declare.
const cjsIndex = require('../dist/index.cjs');
assert.equal(typeof cjsIndex.createRouteGenerator, 'function');
assert.equal(cjsIndex.configureRouter, undefined);
assert.equal(cjsIndex.resetRouterConfig, undefined);
const cjsInternal = require('../dist/plugin-runtime.cjs');
assert.equal(typeof cjsInternal.href, 'function');
assert.equal(typeof cjsInternal.Link, 'function');
assert.equal(typeof cjsInternal.createTypedLink, 'function');
assert.equal(typeof cjsInternal.useCatchAll, 'function');

console.log('✅ Package built successfully!');
console.log('✅ Plugin CJS named export is loadable via require');
console.log('✅ href, Link, and useCatchAll are loadable from ESM and CJS');
