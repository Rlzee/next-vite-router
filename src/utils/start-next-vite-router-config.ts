import {
  getViteConfigPath,
  readViteConfig,
  writeViteConfig,
} from "./config-vite";
import { updateAppTsConfig } from "./update-app-ts-config";
import { updateTsConfigJson } from "./update-tsconfig-json";
import { updateIndexHtml } from "./update-index-html";
import { createVirtualDTS } from "./create-virtual-dts";
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
};

export function startNextViteRouterConfig({
  projectDir = process.cwd(),
  src,
  tailwindcss,
}: Props) {
  startViteConfig(projectDir, src);

  // Remove only the Vite template files the generated structure replaces, so
  // a scaffolded src/ folder is never wiped wholesale. Without a src folder
  // the generated files live at the root and the scaffolded src/ is unused.
  const srcPath = path.join(projectDir, "src");
  if (src) {
    for (const entry of [
      "App.tsx",
      "App.css",
      "index.css",
      "main.tsx",
      "assets",
    ]) {
      const entryPath = path.join(srcPath, entry);
      if (fs.existsSync(entryPath)) {
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    }
  } else if (fs.existsSync(srcPath)) {
    fs.rmSync(srcPath, { recursive: true, force: true });
  }

  updateTsConfigJson(projectDir, src);
  updateAppTsConfig(projectDir, src);
  createVirtualDTS(projectDir, src);
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
}

/**
 * Configure Vite to add nextViteRouter plugin
 */
export function startViteConfig(projectDir: string, src: boolean) {
  const viteConfigPath = getViteConfigPath(projectDir);
  if (!viteConfigPath) throw new Error("Vite config not found");

  let viteConfigContent = readViteConfig(projectDir);
  if (!viteConfigContent) throw new Error("Vite config empty");

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

  writeViteConfig(projectDir, viteConfigContent);
}