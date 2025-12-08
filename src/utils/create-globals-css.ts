import fs from "fs";
import path from "path";

type Props = {
  projectDir: string;
  src: boolean;
  tailwind: boolean;
};

/**
 * Create or overwrite globals.css with Tailwind imports or default CSS
 */
export function createGlobalsCss({ projectDir, src, tailwind }: Props) {
  const cssDir = src ? path.join(projectDir, "src") : projectDir;
  const cssPath = path.join(cssDir, "globals.css");

  if (!fs.existsSync(cssDir)) {
    fs.mkdirSync(cssDir, { recursive: true });
  }

  let content: string;

  if (tailwind) {
    content = '@import "tailwindcss";\n';
  } else {
    content = `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen",
    "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue",
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html,
body,
#root {
  width: 100%;
  height: 100%;
}
`;
  }

  fs.writeFileSync(cssPath, content, "utf-8");
}