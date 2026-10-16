import fs from "fs";
import path from "path";

/**
 * Update index.html
 */
export function updateIndexHtml(projectDir: string, src: boolean) {
  if (src) return;

  const indexPath = path.join(projectDir, "index.html");
  if (!fs.existsSync(indexPath)) return;

  const content = fs.readFileSync(indexPath, "utf-8");

  // Without a src folder main.tsx is generated at the project root, so the
  // Vite template's entry script must stop pointing into src/.
  const updated = content.replace(
    /(src\s*=\s*["'])\/src\/main\.tsx(["'])/,
    "$1/main.tsx$2"
  );

  if (updated !== content) {
    fs.writeFileSync(indexPath, updated, "utf-8");
  }
}
