import fs from "fs";
import path from "path";
import { stripJsonComments } from "./strip-json-comments";

/**
 * Update tsconfig.json
 */
export function updateTsConfigJson(projectDir: string, src: boolean) {
  const tsConfigPath = path.join(projectDir, "tsconfig.json");
  
  if (!fs.existsSync(tsConfigPath)) return;

  const content = fs.readFileSync(tsConfigPath, "utf-8");
  const cleanedContent = stripJsonComments(content);
  const tsConfig = JSON.parse(cleanedContent);

  // Update compilerOptions with paths
  if (!tsConfig.compilerOptions) {
    tsConfig.compilerOptions = {};
  }

  tsConfig.compilerOptions.paths = {
    "@/*": [src ? "./src/*" : "./*"],
  };

  fs.writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2), "utf-8");
}