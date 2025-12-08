import path from "path";
import fs from "fs";
import { stripJsonComments } from "./strip-json-comments";

/**
 * Update tsconfig.app.json
 */
export function updateAppTsConfig(projectDir: string) {
  const tsConfigAppPath = path.join(projectDir, "tsconfig.app.json");
  if (!fs.existsSync(tsConfigAppPath)) return;

  const content = fs.readFileSync(tsConfigAppPath, "utf-8");
  const cleanedContent = stripJsonComments(content);
  const tsConfigApp = JSON.parse(cleanedContent);

  tsConfigApp.include = [
    "./**/*.ts",
    "./**/*.tsx",
    "virtual-next-vite-router.d.ts",
  ];

  fs.writeFileSync(
    tsConfigAppPath,
    JSON.stringify(tsConfigApp, null, 2),
    "utf-8"
  );
}