import path from "path";
import fs from "fs";
import { stripJsonComments } from "./strip-json-comments";

/**
 * Update tsconfig.app.json
 */
export function updateAppTsConfig(projectDir: string, src: boolean) {
  const tsConfigAppPath = path.join(projectDir, "tsconfig.app.json");
  if (!fs.existsSync(tsConfigAppPath)) return;

  const content = fs.readFileSync(tsConfigAppPath, "utf-8");
  const cleanedContent = stripJsonComments(content);
  const tsConfigApp = JSON.parse(cleanedContent);

  // Ensure compilerOptions contains the path aliases
  const aliasPath = src ? "./src/*" : "./*";
  tsConfigApp.compilerOptions = {
    ...tsConfigApp.compilerOptions,
    baseUrl: ".",
    paths: {
      ...tsConfigApp.compilerOptions?.paths,
      "@/*": [aliasPath],
    },
  };

  if (!src) {
    tsConfigApp.include = [
      "./**/*.ts",
      "./**/*.tsx",
      "virtual-next-vite-router.d.ts",
    ];
  } else {
    tsConfigApp.include = ["src"];
  }

  fs.writeFileSync(
    tsConfigAppPath,
    JSON.stringify(tsConfigApp, null, 2),
    "utf-8"
  );
}
