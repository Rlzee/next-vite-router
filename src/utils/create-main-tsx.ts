import fs from "fs";
import path from "path";

/**
 * Create main.tsx file
 * @param projectDir - project directory
 * @param useSrc - if true, the file is placed in src/, otherwise at the root
 */
export function createMainTSX(projectDir: string, useSrc: boolean) {
  const targetDir = useSrc ? path.join(projectDir, "src") : projectDir;

  if (useSrc && !fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const mainPath = path.join(targetDir, "main.tsx");

  const content = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from "react-router-dom";
import { generateRoutes, useRoutes } from 'virtual:next-vite-router';

const routes = generateRoutes();

function App() {
  const element = useRoutes(routes);
  return element;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
`;

  fs.writeFileSync(mainPath, content, "utf-8");
}