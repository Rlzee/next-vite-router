import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { nextViteRouter } from "../dist/plugin.js";

const projectRoot = path.resolve("test/fixture");
const declarationPath = path.join(projectRoot, "src", "virtual-next-vite-router.d.ts");

const plugin = nextViteRouter({
  pagesDir: "src/app",
});

plugin.configResolved({ root: projectRoot });

const declaration = fs.readFileSync(declarationPath, "utf8");
const virtualModule = plugin.load("\0virtual:next-vite-router");

assert.match(declaration, /export type RoutePath =/);
assert.match(declaration, /\| "\/"/);
assert.match(declaration, /\| "\/users"/);
assert.match(declaration, /\| "\/users\/:id"/);
assert.match(declaration, /\| "\/posts\/:slug"/);
assert.doesNotMatch(declaration, /marketing/);
assert.match(declaration, /id: string;/);
assert.match(declaration, /slug: string;/);
assert.match(declaration, /export function Router/);
assert.match(declaration, /export \{ Link, useRoutes \}/);
assert.match(virtualModule, /import \{ Link, useRoutes \} from 'react-router-dom'/);
assert.match(virtualModule, /return useRoutes\(generateRoutes\(\)\)/);
assert.match(virtualModule, /import\.meta\.glob\('\/src\/app\/\*\*\/page\.tsx'\)/);
assert.match(virtualModule, /import\.meta\.glob\('\/src\/app\/\*\*\/not-found\.tsx'\)/);
assert.match(virtualModule, /import\.meta\.glob\('\/src\/app\/\*\*\/layout\.tsx', \{ eager: true \}\)/);

console.log("✅ Route declaration generated");
console.log(`   ${declarationPath}`);
console.log("✅ Static, dynamic, and grouped routes verified");
