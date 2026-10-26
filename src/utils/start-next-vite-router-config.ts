import {
  getViteConfigPath,
  readViteConfig,
  writeViteConfig,
} from "./config-vite";
import { updateAppTsConfig } from "./update-app-ts-config";
import { updateTsConfigJson } from "./update-tsconfig-json";
import { updateIndexHtml } from "./update-index-html";
import { createRoutesDeclaration } from "./create-routes-dts";
import { createMainTSX } from "./create-main-tsx";
import { createGlobalsCss } from "./create-globals-css";
import { createExampleStructure } from "./create-example-structure";
import path from "path";
import fs from "fs";
import { addTailwindToViteConfig } from "./config-tailwind";
import { execSync } from "child_process";
import { detectPackageManager } from "./packageManager";
import { logger } from "./logger";

type Props = {
  projectDir?: string;
  src: boolean;
  tailwindcss: boolean;
  /**
   * Delete the Vite template files that the generated structure replaces.
   *
   * Defaults to `true`, which is what a scaffold wants: the template files are
   * about to be replaced by equivalent ones. `configure` runs against a project
   * that may hold real work, so it turns the deletion off and reports what is
   * left instead of removing it.
   */
  removeTemplateFiles?: boolean;
};

/**
 * The Vite React template entries the generated structure supersedes. Kept in
 * one place because `configure` has to name them when it leaves them behind.
 */
export const TEMPLATE_ENTRIES = [
  "App.tsx",
  "App.css",
  "index.css",
  "main.tsx",
  "assets",
];

export function startNextViteRouterConfig({
  projectDir = process.cwd(),
  src,
  tailwindcss,
  removeTemplateFiles = true,
}: Props): { pluginAdded: boolean } {
  const pluginAdded = startViteConfig(projectDir, src);

  const srcPath = path.join(projectDir, "src");
  if (removeTemplateFiles) {
    if (src) {
      for (const entry of TEMPLATE_ENTRIES) {
        const entryPath = path.join(srcPath, entry);
        if (fs.existsSync(entryPath)) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        }
      }
    } else if (fs.existsSync(srcPath)) {
      fs.rmSync(srcPath, { recursive: true, force: true });
    }
  }

  updateTsConfigJson(projectDir, src);
  updateAppTsConfig(projectDir, src);
  createRoutesDeclaration(projectDir, src);
  createMainTSX(projectDir, src);
  updateIndexHtml(projectDir, src);
  if (tailwindcss) {
    logger.info("Setting up Tailwind CSS...");
    const pm = detectPackageManager();
    const addDevDepsCmd = pm.addDevDepsCommand([
      "tailwindcss",
      "@tailwindcss/vite",
    ]);
    execSync(addDevDepsCmd, { stdio: "inherit", cwd: projectDir });
    addTailwindToViteConfig(projectDir);
  }
  createGlobalsCss({ projectDir, src, tailwind: tailwindcss });
  createExampleStructure(projectDir, src, tailwindcss);

  return { pluginAdded };
}

/**
 * Configure Vite to add the nextViteRouter plugin.
 *
 * Every change is applied only when it is missing, so running this on a project
 * that is already wired leaves one plugin call instead of appending a second
 * one. Returns whether this call added the plugin, which is what `configure`
 * reports back.
 */
export function startViteConfig(projectDir: string, src: boolean): boolean {
  const viteConfigPath = getViteConfigPath(projectDir);
  if (!viteConfigPath) throw new Error("Vite config not found");

  let viteConfigContent = readViteConfig(projectDir);
  if (!viteConfigContent) throw new Error("Vite config empty");
  const originalContent = viteConfigContent;

  if (!viteConfigContent.includes('import { resolve }')) {
    viteConfigContent =
      `import { resolve } from "path";\n` +
      viteConfigContent;
  }
  if (!viteConfigContent.includes('import { fileURLToPath }')) {
    viteConfigContent =
      `import { fileURLToPath } from "node:url";\n` +
      viteConfigContent;
  }

  if (!viteConfigContent.includes("import { nextViteRouter }")) {
    viteConfigContent =
      `import { nextViteRouter } from "next-vite-router/plugin";\n` +
      viteConfigContent;
  }

  const resolveConfig = `  resolve: {
    alias: {
      "@": resolve(fileURLToPath(new URL("./${src ? "src" : "."}", import.meta.url))),
    },
  },`;

  const defineConfigRegex = /defineConfig\(\s*{/;
  if (!viteConfigContent.includes("resolve:")) {
    viteConfigContent = viteConfigContent.replace(
      defineConfigRegex,
      `defineConfig({\n${resolveConfig}\n`
    );
  }

  const pluginsRegex = /plugins\s*:\s*\[(.*?)\]/s;
  const match = viteConfigContent.match(pluginsRegex);

  // Without a src folder the pages live in a root-level app/ directory, which
  // the plugin only scans when pagesDir points there instead of the default
  // src/app.
  const pluginString = src
    ? "nextViteRouter()"
    : 'nextViteRouter({ pagesDir: "app" })';

  // Detect the call, not the import: `nextViteRouter(` cannot be part of the
  // import statement, and a hand-written config may already call the plugin with
  // its own options. Those options are the user's, so they are left alone rather
  // than overwritten - which also means switching between the src and the
  // no-src layout has to be done by hand, and `configure` says so.
  const alreadyWired = /nextViteRouter\s*\(/.test(viteConfigContent);

  if (!alreadyWired) {
    if (match) {
      const existing = match[1].trim();
      const newPlugins = existing ? `${existing}, ${pluginString}` : pluginString;
      viteConfigContent = viteConfigContent.replace(
        pluginsRegex,
        `plugins: [${newPlugins}]`
      );
    } else {
      viteConfigContent = viteConfigContent.replace(
        /defineConfig\(\s*{/,
        `defineConfig({\n  plugins: [${pluginString}],`
      );
    }
  }

  // Only rewrite the file when something actually changed, so a repeated run
  // leaves the config byte-identical instead of refreshing its timestamp.
  if (viteConfigContent !== originalContent) {
    writeViteConfig(projectDir, viteConfigContent);
  }

  return !alreadyWired;
}