import fs from "fs";
import path from "path";

/**
 * Create virtual-next-vite-router.d.ts file
 * @param projectDir - project directory
 * @param useSrc - if true, the file is placed in src/, otherwise at the root
 */
export function createVirtualDTS(projectDir: string, useSrc: boolean) {
  const targetDir = useSrc ? path.join(projectDir, "src") : projectDir;

  if (useSrc && !fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filePath = path.join(targetDir, "virtual-next-vite-router.d.ts");

  const content = `declare module 'virtual:next-vite-router' {
  import type { ReactElement } from 'react';
  import type { RouteObject } from 'react-router-dom';

  export type RoutePath = string;
  export type RoutePathParams = Record<string, Record<string, string>>;
  export type RouteParams<P extends RoutePath> = P extends keyof RoutePathParams
    ? RoutePathParams[P]
    : never;

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export { Link, useRoutes } from 'react-router-dom';
}
`;

  fs.writeFileSync(filePath, content, "utf-8");

  const gitignorePath = path.join(projectDir, ".gitignore");
  const entry = useSrc
    ? "src/virtual-next-vite-router.d.ts"
    : "virtual-next-vite-router.d.ts";
  const currentGitignore = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf-8")
    : "";

  if (!currentGitignore.split(/\r?\n/).includes(entry)) {
    const prefix = currentGitignore && !currentGitignore.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(gitignorePath, `${currentGitignore}${prefix}${entry}\n`, "utf-8");
  }
}