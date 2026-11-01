import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { projectRelativePath } from "./write-if-missing";

type Props = {
  projectDir: string;
  src: boolean;
  tailwind: boolean;
};

/**
 * First line of a Tailwind stylesheet, and the only Tailwind syntax this scaffold
 * needs. Everything else in the starter project is plain CSS, so the pages read
 * the same whether or not Tailwind was chosen.
 */
const TAILWIND_IMPORT = '@import "tailwindcss";';

/**
 * Stylesheet of the scaffolded pages.
 *
 * Two rules it exists to keep. Colors come from variables that follow
 * `prefers-color-scheme`, so the starter reads correctly on a dark monitor
 * without a `dark` class anyone has to wire up. And nothing here loads a file:
 * the mark in the header is inline SVG, so a scaffold with no `assets/` folder
 * still shows something.
 *
 * Every rule is unlayered on purpose. Tailwind's own reset lives in a `@layer`,
 * and unlayered rules beat layered ones whatever the import order, so these
 * colors survive next to `@import "tailwindcss"`.
 */
const BASE_STYLES = `:root {
  color-scheme: light dark;
  --background: #ffffff;
  --foreground: #16191d;
  --muted: #5a6472;
  --surface: #f4f6f8;
  --border: #dce1e8;
  --accent: #2f6bed;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0f1216;
    --foreground: #e6e9ee;
    --muted: #98a2b3;
    --surface: #171c23;
    --border: #262d38;
    --accent: #7aa2f7;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.6;
  margin: 0;
}

h1 {
  font-size: 2rem;
  line-height: 1.2;
  margin: 0 0 0.75rem;
}

h2 {
  font-size: 1.125rem;
  margin: 0 0 0.5rem;
}

p {
  margin: 0 0 1rem;
}

a {
  color: var(--accent);
}

code {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  padding: 0.1rem 0.35rem;
}

.shell {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  margin: 0 auto;
  max-width: 46rem;
  min-height: 100vh;
  padding: 2.5rem 1.25rem;
}

.masthead {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
}

.brand {
  align-items: center;
  color: inherit;
  display: flex;
  font-weight: 650;
  gap: 0.5rem;
  text-decoration: none;
}

.logo {
  height: 1.5rem;
  width: 1.5rem;
}

.tabs {
  display: flex;
  gap: 1rem;
}

.tabs a {
  color: var(--muted);
  text-decoration: none;
}

.tabs a:hover {
  color: var(--accent);
}

.lede {
  color: var(--muted);
}

.cards {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  list-style: none;
  margin: 0 0 1.5rem;
  padding: 0;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 1rem 1.25rem;
}

.card p {
  margin: 0;
}

.footer {
  color: var(--muted);
  font-size: 0.875rem;
  margin-top: auto;
}
`;

/**
 * Create the starter stylesheet, or leave the project's own alone.
 *
 * Returns the project-relative paths it did not touch, because a stylesheet that
 * already exists belongs to the application: at most one missing line is added to
 * it, and never a rule and never a replacement.
 */
export function createGlobalsCss({ projectDir, src, tailwind }: Props): string[] {
  const cssDir = src ? path.join(projectDir, "src") : projectDir;
  const cssPath = path.join(cssDir, "globals.css");
  const cssName = projectRelativePath(projectDir, cssPath);

  if (!fs.existsSync(cssDir)) {
    fs.mkdirSync(cssDir, { recursive: true });
  }

  if (!fs.existsSync(cssPath)) {
    fs.writeFileSync(
      cssPath,
      tailwind ? `${TAILWIND_IMPORT}\n\n${BASE_STYLES}` : BASE_STYLES,
      "utf-8",
    );
    return [];
  }

  const existing = fs.readFileSync(cssPath, "utf-8");
  // The one edit this makes to a stylesheet it did not write: an import Tailwind
  // cannot work without, prepended so it stays the first rule in the file.
  if (tailwind && !existing.includes(TAILWIND_IMPORT)) {
    fs.writeFileSync(cssPath, `${TAILWIND_IMPORT}\n\n${existing}`, "utf-8");
    logger.info(`Added the Tailwind import to the existing ${cssName}.`);
  }

  return [cssName];
}
