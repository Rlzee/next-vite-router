import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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
assert.match(declaration, /\| "\/blog\/\*"/);
assert.match(declaration, /\| "\/docs\/\*"/);
assert.match(declaration, /\| "\/docs"/);
assert.doesNotMatch(declaration, /marketing/);
assert.match(declaration, /id: string;/);
assert.match(declaration, /slug: string;/);
assert.match(declaration, /segments\?: string;/);
assert.match(declaration, /export function Router/);
assert.match(declaration, /export \{ Link, useRoutes \}/);
assert.match(virtualModule, /import \{ Link, useRoutes \} from 'react-router-dom'/);
assert.match(virtualModule, /routes \?\?= generateRoutes\(\)/);
assert.match(virtualModule, /import\.meta\.glob\('\/src\/app\/\*\*\/page\.tsx'\)/);
assert.match(virtualModule, /import\.meta\.glob\('\/src\/app\/\*\*\/not-found\.tsx'\)/);
assert.match(virtualModule, /import\.meta\.glob\('\/src\/app\/\*\*\/layout\.tsx', \{ eager: true \}\)/);

console.log("✅ Route declaration generated");
console.log(`   ${declarationPath}`);
console.log("✅ Static, dynamic, and grouped routes verified");

const customProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-vite-router-"));
const customPagesRoot = path.join(customProjectRoot, "src", "routes");
fs.mkdirSync(path.join(customPagesRoot, "users", "[id]"), { recursive: true });
fs.writeFileSync(path.join(customPagesRoot, "index.tsx"), "");
fs.writeFileSync(path.join(customPagesRoot, "users", "index.tsx"), "");
fs.writeFileSync(path.join(customPagesRoot, "users", "[id]", "index.tsx"), "");
fs.writeFileSync(path.join(customPagesRoot, "layout.tsx"), "");
fs.writeFileSync(path.join(customPagesRoot, "missing.tsx"), "");

try {
  const customPlugin = nextViteRouter({
    pagesDir: "src/routes",
    pageFile: "index.tsx",
    layoutFile: "layout.tsx",
    notFoundFile: "missing.tsx",
  });
  customPlugin.configResolved({ root: customProjectRoot });

  const customDeclaration = fs.readFileSync(
    path.join(customProjectRoot, "src", "virtual-next-vite-router.d.ts"),
    "utf8",
  );
  const customVirtualModule = customPlugin.load("\0virtual:next-vite-router");

  assert.match(customDeclaration, /\| "\/"/);
  assert.match(customDeclaration, /\| "\/users"/);
  assert.match(customDeclaration, /\| "\/users\/:id"/);
  assert.match(
    customVirtualModule,
    /import\.meta\.glob\('\/src\/routes\/\*\*\/index\.tsx'\)/,
  );
  assert.match(
    customVirtualModule,
    /import\.meta\.glob\('\/src\/routes\/\*\*\/missing\.tsx'\)/,
  );
  assert.match(
    customVirtualModule,
    /import\.meta\.glob\('\/src\/routes\/\*\*\/layout\.tsx', \{ eager: true \}\)/,
  );
  console.log("✅ Custom page, layout, not-found, and directory names verified");
} finally {
  fs.rmSync(customProjectRoot, { recursive: true, force: true });
}
