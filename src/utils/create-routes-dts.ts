import fs from "fs";
import path from "path";
import { ROUTE_DECLARATION_FILE_NAME } from "./route-declaration";

/**
 * Create the route declaration file (`routes.d.ts`, named by the shared constant
 * the Vite plugin writes to as well) so `next-vite-router/routes` resolves from
 * the first editor session, before anything has been built.
 * @param projectDir - project directory
 * @param useSrc - if true, the file is placed in src/, otherwise at the root
 */
export function createRoutesDeclaration(projectDir: string, useSrc: boolean) {
  const targetDir = useSrc ? path.join(projectDir, "src") : projectDir;

  if (useSrc && !fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filePath = path.join(targetDir, ROUTE_DECLARATION_FILE_NAME);

  const content = `declare module 'next-vite-router/routes' {
  import type { ReactElement } from 'react';
  import type { LinkProps as ReactRouterLinkProps, RouteObject } from 'react-router-dom';

  export type RoutePath = string;
  // A catch-all value may be the string \`useParams\` reports or the segment array
  // \`useCatchAll()\` returns; \`href\` and \`Link\` join the array form.
  export type RoutePathParams = Record<string, Record<string, string | string[]>>;
  export type RouteParams<P extends RoutePath> = P extends keyof RoutePathParams
    ? RoutePathParams[P]
    : never;

  // Scaffold shape used before the plugin writes the generated declaration:
  // \`RoutePath\` is \`string\`, so any literal still selects its own branch here.
  type HasRouteParams<P extends string> =
    P extends \`\${string}:\${string}\` ? true
    : P extends \`\${string}/*\` ? true
    : false;

  export function href<P extends RoutePath>(
    path: P,
    ...params: HasRouteParams<P> extends true
      ? [params: RouteParams<P>]
      : [params?: RouteParams<P>]
  ): string;

  export type LinkProps = Omit<ReactRouterLinkProps, 'to' | 'href'> & {
    href: RoutePath;
    params?: RouteParams<RoutePath>;
  };

  export function Link(props: LinkProps): ReactElement | null;

  export const generateRoutes: () => RouteObject[];
  export function Router(): ReactElement | null;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export function useCatchAll(name?: string): string[];
  export { useRoutes } from 'react-router-dom';
}
`;

  fs.writeFileSync(filePath, content, "utf-8");

  const gitignorePath = path.join(projectDir, ".gitignore");
  const entry = useSrc
    ? `src/${ROUTE_DECLARATION_FILE_NAME}`
    : ROUTE_DECLARATION_FILE_NAME;
  const currentGitignore = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf-8")
    : "";

  if (!currentGitignore.split(/\r?\n/).includes(entry)) {
    const prefix = currentGitignore && !currentGitignore.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(gitignorePath, `${currentGitignore}${prefix}${entry}\n`, "utf-8");
  }
}
