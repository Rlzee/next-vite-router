import fs from "fs";
import path from "path";
import { stripJsonComments } from "./strip-json-comments";
import { withRouterAlias, type TsConfigDocument } from "./tsconfig-merge";

/**
 * Update tsconfig.json
 */
export function updateTsConfigJson(projectDir: string, src: boolean) {
  const tsConfigPath = path.join(projectDir, "tsconfig.json");

  if (!fs.existsSync(tsConfigPath)) return;

  const content = fs.readFileSync(tsConfigPath, "utf-8");
  const cleanedContent = stripJsonComments(content);
  const tsConfig = JSON.parse(cleanedContent) as TsConfigDocument;

  // The project's own aliases stay. This file exists for reasons that are not the
  // router's, and the router is a guest in it.
  withRouterAlias(tsConfig, src);

  // Written again only when the merge changed something, so a second run leaves
  // the file - and its place in the project's diff - exactly where it is.
  const next = JSON.stringify(tsConfig, null, 2);
  if (next === content) return;

  fs.writeFileSync(tsConfigPath, next, "utf-8");
}
