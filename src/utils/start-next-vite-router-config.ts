import {
  getViteConfigPath,
  readViteConfig,
  writeViteConfig,
} from "./config-vite";
import { updateAppTsConfig } from "./update-app-ts-config";
import { updateTsConfigJson } from "./update-tsconfig-json";
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

const pm = detectPackageManager();

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

  const srcPath = path.join(projectDir, "src");
  if (fs.existsSync(srcPath)) {
    fs.rmSync(srcPath, { recursive: true, force: true });
  }

  // Update tsconfig.json with path aliases
  updateTsConfigJson(projectDir, src);

  if (!src) {
    // Update tsconfig.app.json
    updateAppTsConfig(projectDir);
  }

  // Create virtual-next-vite-router.d.ts
  createVirtualDTS(projectDir, src);

  // Create main.tsx
  createMainTSX(projectDir, src);

  // THEN setup Tailwind if requested (modifies vite.config after next-vite-router)
  if (tailwindcss) {
    logger.info("Setting up Tailwind CSS...");
    const addDevDepsCmd = pm.addDevDepsCommand([
      "tailwindcss",
      "@tailwindcss/vite",
    ]);
    execSync(addDevDepsCmd, { stdio: "inherit", cwd: projectDir });

    // Add Tailwind to vite.config.ts
    addTailwindToViteConfig(projectDir);
  }

  // Create globals.css
  createGlobalsCss({ projectDir, src, tailwind: tailwindcss });

  // Create example structure
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

  // Add path import if not already present
  if (!viteConfigContent.includes('import { resolve }')) {
    viteConfigContent =
      `import { resolve } from "path";\n` +
      viteConfigContent;
  }

  if (!viteConfigContent.includes("import { nextViteRouter }")) {
    viteConfigContent =
      `import { nextViteRouter } from "next-vite-router/plugin";\n` +
      viteConfigContent;
  }

  // Add resolve config with alias
  const resolveConfig = `  resolve: {
    alias: {
      "@": resolve(__dirname, "./${src ? "src" : "."}"),
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

  const pluginString = `nextViteRouter({ pagesDir: "${src ? "src/app" : "app"}", pageFile: "page.tsx", layoutFile: "layout.tsx", notFoundFile: "not-found.tsx" })`;

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