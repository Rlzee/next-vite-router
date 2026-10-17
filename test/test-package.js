import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createRouteGenerator, configureRouter } from '../dist/index.js';

console.log('✅ createRouteGenerator:', typeof createRouteGenerator);
console.log('✅ configureRouter:', typeof configureRouter);

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

console.log('✅ Package built successfully!');
console.log('✅ Plugin CJS named export is loadable via require');
