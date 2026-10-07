import fs from "fs";
import path from "path";

/**
 * Path to the Vite config in the project
 */
export function getViteConfigPath(projectDir: string): string | null {
  for (const fileName of [
    "vite.config.ts",
    "vite.config.mts",
    "vite.config.cts",
    "vite.config.js",
    "vite.config.mjs",
    "vite.config.cjs",
  ]) {
    const configPath = path.join(projectDir, fileName);
    if (fs.existsSync(configPath)) return configPath;
  }

  return null;
}

/**
 * Read vite.config content
 */
export function readViteConfig(projectDir: string): string | null {
  const configPath = getViteConfigPath(projectDir);
  if (!configPath) return null;

  return fs.readFileSync(configPath, "utf-8");
}

/**
 * Write vite.config content
 */
export function writeViteConfig(projectDir: string, content: string) {
  const configPath = getViteConfigPath(projectDir);
  if (!configPath) throw new Error("Vite config not found");
  fs.writeFileSync(configPath, content, "utf-8");
}