import fs from "fs";
import path from "path";

/**
 * Path to vite.config.ts or vite.config.js in the project
 */
export function getViteConfigPath(projectDir: string): string | null {
  const tsPath = path.join(projectDir, "vite.config.ts");
  const jsPath = path.join(projectDir, "vite.config.js");

  if (fs.existsSync(tsPath)) return tsPath;
  if (fs.existsSync(jsPath)) return jsPath;

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