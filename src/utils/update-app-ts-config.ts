import path from "path";
import fs from "fs";
import { stripJsonComments } from "./strip-json-comments";
import {
  withRouterAlias,
  withRouterInclude,
  type TsConfigDocument,
} from "./tsconfig-merge";

/**
 * Update tsconfig.app.json
 */
export function updateAppTsConfig(projectDir: string, src: boolean) {
  const tsConfigAppPath = path.join(projectDir, "tsconfig.app.json");
  if (!fs.existsSync(tsConfigAppPath)) return;

  const content = fs.readFileSync(tsConfigAppPath, "utf-8");
  const cleanedContent = stripJsonComments(content);
  const tsConfigApp = JSON.parse(cleanedContent) as TsConfigDocument;

  // Two merges rather than two assignments: this file belongs to an application
  // that may already compile other folders and resolve other aliases, and the
  // router's job is to add what it needs, not to decide what the project reads.
  withRouterAlias(tsConfigApp, src);
  withRouterInclude(tsConfigApp, src);

  // A run that changed nothing leaves the file untouched, timestamp included.
  const next = JSON.stringify(tsConfigApp, null, 2);
  if (next === content) return;

  fs.writeFileSync(tsConfigAppPath, next, "utf-8");
}
