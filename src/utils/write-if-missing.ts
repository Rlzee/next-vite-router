import fs from "fs";
import path from "path";

/**
 * Write a generated file only where the project does not already own one.
 *
 * `create` scaffolds a directory it just made, so every path is free and this
 * always writes. `configure` runs inside a project that may hold real work, and a
 * document it replaces is work lost - the README, the starter pages, and the
 * stylesheet therefore go in only where nothing exists yet. Returns `false` when
 * an existing file was left untouched, which is what the caller reports.
 */
export function writeFileIfMissing(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) {
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
}

/**
 * Path as the project sees it, for a message naming a file that stayed as it was.
 *
 * Forward slashes on every platform: the message quotes something the reader
 * types into their editor or terminal, and a backslashed path reads differently
 * depending on the shell they are in.
 */
export function projectRelativePath(projectDir: string, filePath: string): string {
  return path.relative(projectDir, filePath).split(path.sep).join("/");
}
