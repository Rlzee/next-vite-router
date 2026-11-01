import path from "path";
import pkg from "../../package.json" with { type: "json" };
import type { PackageManager } from "./packageManager";
import { ROUTE_DECLARATION_FILE_NAME } from "./route-declaration";
import { projectRelativePath, writeFileIfMissing } from "./write-if-missing";

type Props = {
  projectDir: string;
  src: boolean;
  tailwind: boolean;
  packageManager: PackageManager;
};

/**
 * Where the guide lives. Taken from the package's own metadata rather than typed
 * out again, so a fork or a moved repository documents itself correctly.
 */
const docsUrl =
  typeof pkg.homepage === "string" ? pkg.homepage : "https://github.com/Rlzee/next-vite-router";

// Markdown quotes code in backticks, and a template literal ends at the first of
// them, so the code spans inside the document below are escaped backticks.

/**
 * The document a project starts with: what to run, which file means what, and
 * which file not to edit. Long enough to answer the first three questions about a
 * route, short enough to be read once.
 */
function readmeContent({
  projectName,
  pages,
  declaration,
  tailwind,
  devCommand,
  buildCommand,
  previewCommand,
}: {
  projectName: string;
  pages: string;
  declaration: string;
  tailwind: boolean;
  devCommand: string;
  buildCommand: string;
  previewCommand: string;
}): string {
  // Built outside the template literal, where a backtick needs no escaping.
  const styles = tailwind
    ? "The first line of the stylesheet imports Tailwind's utilities, so any class\n" +
      "name works in a page. The starter pages use plain CSS classes from the same\n" +
      "file, so they keep their look even if that import moves."
    : "The starter stylesheet is plain CSS, and its colors follow the reader's\n" +
      "`prefers-color-scheme` preference. To add Tailwind later:\n" +
      "`npx next-vite-router configure --tailwind`.";

  return `# ${projectName}

A React app for [Vite](https://vite.dev) whose routes come from its own file tree,
set up with [next-vite-router](${docsUrl}).

## Commands

| Command | What it does |
| --- | --- |
| \`${devCommand}\` | Dev server. Adding, renaming, or deleting a route file updates the routes by itself. |
| \`${buildCommand}\` | Type-check, then build into \`dist/\`. |
| \`${previewCommand}\` | Serve the built \`dist/\` locally. |

## File conventions

Pages live in \`${pages}/\`. A folder names a path segment, a file says what it does,
and a folder in parentheses groups files without adding anything to the URL.

| Path | Route it produces | What it is |
| --- | --- | --- |
| \`page.tsx\` | its folder | The UI: a default-exported component. |
| \`layout.tsx\` | wraps every page below it | Render \`<Outlet />\` where the page belongs. |
| \`loading.tsx\` | - | Placeholder while that folder's page is loading. |
| \`error.tsx\` | - | Error boundary for the subtree; receives \`{ error, reset }\`. |
| \`not-found.tsx\` | the 404 view below its folder | Also the view for a folder with no page of its own. |
| \`[id]/page.tsx\` | \`/:id\` | Dynamic segment; read it with \`useParams()\`. |
| \`[...slug]/page.tsx\` | \`/*\` | Catch-all. \`[[...slug]]\` makes the segment optional. |
| \`(marketing)/page.tsx\` | unchanged | Route group: organize files, keep the URL flat. |

These names are the defaults. \`nextViteRouter({ pagesDir, pageFile, layoutFile,
notFoundFile, loadingFile, errorFile })\` in \`vite.config.ts\` renames them.

## Generated types

\`${declaration}\` is rewritten on every dev and build run. It declares the
\`next-vite-router/routes\` module with exactly the routes this project has, which is
what lets \`Link\` and \`href\` refuse a path no folder provides.

It is a build artifact, already listed in \`.gitignore\`. Never edit it by hand - run
\`${devCommand}\` to refresh it.

## Styles

${styles}

## Documentation

Plugin options, the full convention list, and the API: [${docsUrl}](${docsUrl}).
`;
}

/**
 * Write the project's README.
 *
 * Returns the path when the project already had one and it was left alone. The
 * Vite template ships a README of its own, so `create` deletes that template file
 * first (see `startNextViteRouterConfig`) and this writes into the free slot,
 * while `configure` on a real project keeps whatever the project wrote.
 */
export function createReadme({
  projectDir,
  src,
  tailwind,
  packageManager,
}: Props): string[] {
  const readmePath = path.join(projectDir, "README.md");
  const pagesDir = src ? "src/app" : "app";
  const declarationDir = src ? path.join(projectDir, "src") : projectDir;
  const declaration = projectRelativePath(
    projectDir,
    path.join(declarationDir, ROUTE_DECLARATION_FILE_NAME),
  );

  const wrote = writeFileIfMissing(
    readmePath,
    readmeContent({
      projectName: path.basename(projectDir),
      pages: pagesDir,
      declaration,
      tailwind,
      devCommand: packageManager.scriptCommand("dev"),
      buildCommand: packageManager.scriptCommand("build"),
      previewCommand: packageManager.scriptCommand("preview"),
    }),
  );

  return wrote ? [] : [projectRelativePath(projectDir, readmePath)];
}
